import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../lib/logger.js';

export const sessionRoutes = new Hono();

// Apply auth middleware to all routes
sessionRoutes.use('*', authMiddleware);

// GET /api/sessions - List all sessions (active and historical)
sessionRoutes.get('/', async (c) => {
    const tenantId = c.get('tenantId');
    const page = parseInt(c.req.query('page') ?? '1');
    const pageSize = parseInt(c.req.query('pageSize') ?? '20');
    const status = c.req.query('status'); // active, completed, all
    const customerId = c.req.query('customerId');
    const nasId = c.req.query('nasId');
    const search = c.req.query('search');

    interface SessionWhere {
        customer?: { tenantId: string };
        stopTime?: null | { not: null };
        customerId?: string;
        nasId?: string;
        OR?: Array<{
            username?: { contains: string; mode: 'insensitive' };
            framedIp?: { contains: string };
            sessionId?: { contains: string };
        }>;
    }

    const where: SessionWhere = { customer: { tenantId } };

    if (status === 'active') where.stopTime = null;
    if (status === 'completed') where.stopTime = { not: null };
    if (customerId) where.customerId = customerId;
    if (nasId) where.nasId = nasId;

    if (search) {
        where.OR = [
            { username: { contains: search, mode: 'insensitive' } },
            { framedIp: { contains: search } },
            { sessionId: { contains: search } },
        ];
    }

    const [sessions, total] = await Promise.all([
        prisma.session.findMany({
            where: where as Parameters<typeof prisma.session.findMany>[0]['where'],
            include: {
                customer: { select: { id: true, name: true, username: true } },
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
            const duration = s.stopTime
                ? Math.floor((s.stopTime.getTime() - s.startTime.getTime()) / 1000)
                : Math.floor((Date.now() - s.startTime.getTime()) / 1000);
            return {
                id: s.id,
                sessionId: s.sessionId,
                username: s.username,
                customer: s.customer,
                nas: s.nas,
                framedIp: s.framedIp,
                macAddress: s.macAddress,
                status: s.stopTime ? 'completed' : 'active',
                startTime: s.startTime,
                stopTime: s.stopTime,
                duration: formatUptime(duration),
                durationSeconds: duration,
                bytesIn: s.inputOctets,
                bytesOut: s.outputOctets,
                terminateCause: s.terminateCause,
            };
        }),
        total,
        page,
        pageSize,
    });
});

// GET /api/sessions/stats - Session statistics
sessionRoutes.get('/stats', async (c) => {
    const tenantId = c.get('tenantId');

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // TENANT ISOLATION: All queries must filter by tenant
    const tenantFilter = { customer: { tenantId } };

    const [
        activeSessions,
        pppoeActive,
        hotspotActive,
        todaySessions,
        weekSessions,
        monthSessions,
        byNas,
    ] = await Promise.all([
        prisma.session.count({ where: { stopTime: null, ...tenantFilter } }),
        prisma.session.count({
            where: {
                stopTime: null,
                customer: { tenantId, connectionType: 'PPPOE' },
            },
        }),
        prisma.session.count({
            where: {
                stopTime: null,
                customer: { tenantId, connectionType: 'HOTSPOT' },
            },
        }),
        prisma.session.count({ where: { startTime: { gte: startOfDay }, ...tenantFilter } }),
        prisma.session.count({ where: { startTime: { gte: startOfWeek }, ...tenantFilter } }),
        prisma.session.count({ where: { startTime: { gte: startOfMonth }, ...tenantFilter } }),
        prisma.session.groupBy({
            by: ['nasId'],
            where: { stopTime: null, ...tenantFilter },
            _count: true,
        }),
    ]);

    // Get NAS names for the stats - only for tenant's NAS devices
    const nasIds = byNas.map((n: { nasId: string | null }) => n.nasId).filter((id): id is string => id !== null);
    const nasDevices = await prisma.nAS.findMany({
        where: { id: { in: nasIds }, tenantId },
        select: { id: true, name: true },
    });
    const nasMap = new Map(nasDevices.map((n: { id: string; name: string }) => [n.id, n.name]));

    return c.json({
        total: activeSessions,
        pppoe: pppoeActive,
        hotspot: hotspotActive,
        sessions: {
            today: todaySessions,
            thisWeek: weekSessions,
            thisMonth: monthSessions,
        },
        byNas: byNas.map((n: { nasId: string | null; _count: number }) => ({
            nasId: n.nasId,
            nasName: n.nasId ? nasMap.get(n.nasId) ?? 'Unknown' : 'Unknown',
            count: n._count,
        })),
    });
});

// POST /api/sessions/sync - Sync sessions from RADIUS accounting
sessionRoutes.post('/sync', async (c) => {
    const tenantId = c.get('tenantId');

    // This would typically be called by a background job or webhook
    // to sync active sessions from RADIUS server

    // For now, just return a success message
    logger.info({ tenantId }, 'Session sync triggered');

    return c.json({
        success: true,
        message: 'Session sync initiated',
        timestamp: new Date(),
    });
});

// POST /api/sessions/cleanup - Clean up stale sessions
sessionRoutes.post('/cleanup', async (c) => {
    const tenantId = c.get('tenantId');
    const body = await c.req.json();
    const { maxAgeMinutes = 1440 } = body; // Default 24 hours

    const cutoffTime = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

    // Find and close stale active sessions
    const staleResult = await prisma.session.updateMany({
        where: {
            stopTime: null,
            startTime: { lt: cutoffTime },
            customer: { tenantId },
        },
        data: {
            stopTime: new Date(),
            terminateCause: 'Stale-Session-Cleanup',
        },
    });

    logger.info({ tenantId, cleaned: staleResult.count }, 'Stale sessions cleaned up');

    return c.json({
        success: true,
        cleanedCount: staleResult.count,
        cutoffTime,
    });
});

// GET /api/sessions/:id - Get session details
sessionRoutes.get('/:id', async (c) => {
    const tenantId = c.get('tenantId');
    const sessionId = c.req.param('id');

    const session = await prisma.session.findFirst({
        where: {
            id: sessionId,
            customer: { tenantId },
        },
        include: {
            customer: {
                select: {
                    id: true,
                    name: true,
                    username: true,
                    email: true,
                    phone: true,
                    connectionType: true,
                    package: { select: { name: true } },
                },
            },
            nas: { select: { id: true, name: true, ipAddress: true } },
        },
    });

    if (!session) {
        throw new AppError(404, 'Session not found');
    }

    const duration = session.stopTime
        ? Math.floor((session.stopTime.getTime() - session.startTime.getTime()) / 1000)
        : Math.floor((Date.now() - session.startTime.getTime()) / 1000);

    return c.json({
        id: session.id,
        sessionId: session.sessionId,
        username: session.username,
        customer: session.customer,
        nas: session.nas,
        framedIp: session.framedIp,
        macAddress: session.macAddress,
        status: session.stopTime ? 'completed' : 'active',
        startTime: session.startTime,
        stopTime: session.stopTime,
        duration: formatUptime(duration),
        durationSeconds: duration,
        bytesIn: session.inputOctets,
        bytesOut: session.outputOctets,
        terminateCause: session.terminateCause,
    });
});

// DELETE /api/sessions/:id - Force terminate a session
sessionRoutes.delete('/:id', async (c) => {
    const tenantId = c.get('tenantId');
    const sessionId = c.req.param('id');

    const session = await prisma.session.findFirst({
        where: {
            id: sessionId,
            stopTime: null,
            customer: { tenantId },
        },
    });

    if (!session) {
        throw new AppError(404, 'Active session not found');
    }

    await prisma.session.update({
        where: { id: session.id },
        data: {
            stopTime: new Date(),
            terminateCause: 'Admin-Terminate',
        },
    });

    // TODO: Send CoA disconnect to NAS

    return c.json({ success: true });
});

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
