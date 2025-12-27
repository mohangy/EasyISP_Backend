import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../lib/logger.js';

export const radiusRoutes = new Hono();

// Apply auth middleware to all routes except CoA endpoints
const authenticatedRoutes = new Hono();
authenticatedRoutes.use('*', authMiddleware);

// GET /api/radius/status - Get RADIUS server status
authenticatedRoutes.get('/status', async (c) => {
    const tenantId = c.get('tenantId');

    // Get active sessions count - FILTERED BY TENANT
    const [activeSessions, totalToday, totalMonth] = await Promise.all([
        prisma.session.count({
            where: { stopTime: null, customer: { tenantId } },
        }),
        prisma.session.count({
            where: {
                customer: { tenantId },
                startTime: {
                    gte: new Date(new Date().setHours(0, 0, 0, 0)),
                },
            },
        }),
        prisma.session.count({
            where: {
                customer: { tenantId },
                startTime: {
                    gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
                },
            },
        }),
    ]);

    return c.json({
        status: 'running',
        version: '1.0.0',
        uptime: process.uptime(),
        activeSessions,
        stats: {
            today: totalToday,
            thisMonth: totalMonth,
        },
        ports: {
            auth: parseInt(process.env['RADIUS_PORT'] ?? '1812'),
            acct: parseInt(process.env['RADIUS_ACCT_PORT'] ?? '1813'),
        },
    });
});

// GET /api/radius/sessions - Get active sessions
authenticatedRoutes.get('/sessions', async (c) => {
    const tenantId = c.get('tenantId');
    const page = parseInt(c.req.query('page') ?? '1');
    const pageSize = parseInt(c.req.query('pageSize') ?? '20');
    const nasId = c.req.query('nasId');
    const search = c.req.query('search');

    interface SessionWhere {
        stopTime: null;
        customer?: { tenantId: string };
        nasId?: string;
        OR?: Array<{
            username?: { contains: string; mode: 'insensitive' };
            framedIp?: { contains: string };
        }>;
    }

    const where: SessionWhere = { stopTime: null };

    // Filter by tenant through customer relationship
    where.customer = { tenantId };

    if (nasId) where.nasId = nasId;

    if (search) {
        where.OR = [
            { username: { contains: search, mode: 'insensitive' } },
            { framedIp: { contains: search } },
        ];
    }

    const [sessions, total] = await Promise.all([
        prisma.session.findMany({
            where: where as Parameters<typeof prisma.session.findMany>[0]['where'],
            include: {
                customer: { select: { id: true, name: true } },
                nas: { select: { id: true, name: true, ipAddress: true } },
            },
            orderBy: { startTime: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.session.count({ where: where as Parameters<typeof prisma.session.count>[0]['where'] }),
    ]);

    return c.json({
        sessions: sessions.map((s) => {
            const uptime = Math.floor((Date.now() - s.startTime.getTime()) / 1000);
            return {
                id: s.id,
                sessionId: s.sessionId,
                username: s.username,
                customer: s.customer,
                nas: s.nas,
                framedIp: s.framedIp,
                macAddress: s.macAddress,
                uptime: formatUptime(uptime),
                uptimeSeconds: uptime,
                bytesIn: s.inputOctets,
                bytesOut: s.outputOctets,
                startTime: s.startTime,
            };
        }),
        total,
        page,
        pageSize,
    });
});

// POST /api/radius/disconnect - Disconnect a session
authenticatedRoutes.post('/disconnect', async (c) => {
    const tenantId = c.get('tenantId');
    const body = await c.req.json();
    const { sessionId, username } = body;

    if (!sessionId && !username) {
        throw new AppError(400, 'Session ID or username required');
    }

    // TENANT ISOLATION: Only allow disconnect of sessions belonging to tenant's customers
    const session = await prisma.session.findFirst({
        where: {
            customer: { tenantId },
            OR: [
                { sessionId },
                { username },
            ],
            stopTime: null,
        },
        include: { nas: true, customer: true },
    });

    if (!session) {
        throw new AppError(404, 'Active session not found');
    }

    // TODO: Send CoA (Change of Authorization) disconnect request to NAS
    // This would use RADIUS protocol to send disconnect message

    // Update session in database
    await prisma.session.update({
        where: { id: session.id },
        data: {
            stopTime: new Date(),
            terminateCause: 'Admin-Disconnect',
        },
    });

    logger.info({ sessionId: session.sessionId, tenantId }, 'Session disconnected via RADIUS API');

    return c.json({
        success: true,
        message: 'Session disconnected',
        sessionId: session.sessionId,
    });
});

// GET /api/radius/accounting - Get accounting records
authenticatedRoutes.get('/accounting', async (c) => {
    const tenantId = c.get('tenantId');
    const page = parseInt(c.req.query('page') ?? '1');
    const pageSize = parseInt(c.req.query('pageSize') ?? '20');
    const startDate = c.req.query('startDate');
    const endDate = c.req.query('endDate');

    interface AcctWhere {
        customer?: { tenantId: string };
        startTime?: { gte?: Date; lte?: Date };
    }

    const where: AcctWhere = { customer: { tenantId } };

    if (startDate || endDate) {
        where.startTime = {};
        if (startDate) where.startTime.gte = new Date(startDate);
        if (endDate) where.startTime.lte = new Date(endDate);
    }

    const [records, total, summary] = await Promise.all([
        prisma.session.findMany({
            where: where as Parameters<typeof prisma.session.findMany>[0]['where'],
            include: {
                customer: { select: { id: true, name: true, username: true } },
                nas: { select: { id: true, name: true } },
            },
            orderBy: { startTime: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.session.count({ where: where as Parameters<typeof prisma.session.count>[0]['where'] }),
        prisma.session.aggregate({
            where: where as Parameters<typeof prisma.session.aggregate>[0]['where'],
            _sum: {
                inputOctets: true,
                outputOctets: true,
            },
        }),
    ]);

    return c.json({
        records: records.map((r) => ({
            id: r.id,
            sessionId: r.sessionId,
            username: r.username,
            customer: r.customer,
            nas: r.nas,
            startTime: r.startTime,
            stopTime: r.stopTime,
            sessionTime: r.stopTime
                ? Math.floor((r.stopTime.getTime() - r.startTime.getTime()) / 1000)
                : null,
            bytesIn: r.inputOctets,
            bytesOut: r.outputOctets,
            terminateCause: r.terminateCause,
        })),
        summary: {
            totalBytesIn: summary._sum.inputOctets ?? 0,
            totalBytesOut: summary._sum.outputOctets ?? 0,
            totalRecords: total,
        },
        total,
        page,
        pageSize,
    });
});

// GET /api/radius/stats - Get RADIUS statistics
authenticatedRoutes.get('/stats', async (c) => {
    const tenantId = c.get('tenantId');

    const now = new Date();
    const startOfDay = new Date(now.setHours(0, 0, 0, 0));
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // TENANT ISOLATION: All queries filter by tenant
    const tenantFilter = { customer: { tenantId } };

    const [
        activeSessions,
        todaySessions,
        weekSessions,
        monthSessions,
        byNas,
    ] = await Promise.all([
        prisma.session.count({ where: { stopTime: null, ...tenantFilter } }),
        prisma.session.count({ where: { startTime: { gte: startOfDay }, ...tenantFilter } }),
        prisma.session.count({ where: { startTime: { gte: startOfWeek }, ...tenantFilter } }),
        prisma.session.count({ where: { startTime: { gte: startOfMonth }, ...tenantFilter } }),
        prisma.session.groupBy({
            by: ['nasId'],
            where: { stopTime: null, ...tenantFilter },
            _count: true,
        }),
    ]);

    return c.json({
        activeSessions,
        sessions: {
            today: todaySessions,
            thisWeek: weekSessions,
            thisMonth: monthSessions,
        },
        byNas: byNas.map((n) => ({
            nasId: n.nasId,
            count: n._count,
        })),
    });
});

// Mount authenticated routes
radiusRoutes.route('/', authenticatedRoutes);

// Helper function
function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

    return parts.join(' ');
}
