import { Hono } from 'hono';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../lib/logger.js';

export const mikrotikRoutes = new Hono();

// Apply auth middleware to all routes
mikrotikRoutes.use('*', authMiddleware);

// GET /api/mikrotik/:nasId/system-stats
mikrotikRoutes.get('/:nasId/system-stats', async (c) => {
    const tenantId = c.get('tenantId');
    const nasId = c.req.param('nasId');

    const nas = await prisma.nAS.findFirst({
        where: { id: nasId, tenantId },
    });

    if (!nas) {
        throw new AppError(404, 'Router not found');
    }

    // TODO: Implement actual MikroTik API call
    // For now, return stored/mock data
    return c.json({
        id: nas.id,
        name: nas.name,
        boardName: nas.boardName ?? 'Unknown',
        routerOsVersion: nas.routerOsVersion ?? 'Unknown',
        cpuLoad: nas.cpuLoad ?? 0,
        memoryUsage: nas.memoryUsage ?? 0,
        memoryTotal: nas.memoryTotal ?? 0,
        uptime: nas.uptime ?? 'Unknown',
        status: nas.status,
    });
});

// GET /api/mikrotik/:nasId/sessions
mikrotikRoutes.get('/:nasId/sessions', async (c) => {
    const tenantId = c.get('tenantId');
    const nasId = c.req.param('nasId');
    const page = parseInt(c.req.query('page') ?? '1');
    const pageSize = parseInt(c.req.query('pageSize') ?? '20');

    const nas = await prisma.nAS.findFirst({
        where: { id: nasId, tenantId },
    });

    if (!nas) {
        throw new AppError(404, 'Router not found');
    }

    // Get active sessions from database
    const [sessions, total] = await Promise.all([
        prisma.session.findMany({
            where: { nasId, stopTime: null },
            include: {
                customer: { select: { id: true, name: true, username: true } },
            },
            orderBy: { startTime: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.session.count({ where: { nasId, stopTime: null } }),
    ]);

    return c.json({
        sessions: sessions.map((s) => {
            const uptime = Math.floor((Date.now() - s.startTime.getTime()) / 1000);
            return {
                id: s.id,
                sessionId: s.sessionId,
                username: s.username,
                customerId: s.customer?.id,
                customerName: s.customer?.name,
                ipAddress: s.framedIp,
                macAddress: s.macAddress,
                uptime: formatUptime(uptime),
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

// POST /api/mikrotik/:nasId/disconnect
mikrotikRoutes.post('/:nasId/disconnect', async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const nasId = c.req.param('nasId');
    const body = await c.req.json();
    const { sessionId, username } = body;

    const nas = await prisma.nAS.findFirst({
        where: { id: nasId, tenantId },
    });

    if (!nas) {
        throw new AppError(404, 'Router not found');
    }

    // Find the session
    const session = await prisma.session.findFirst({
        where: {
            OR: [
                { sessionId: sessionId },
                { username: username },
            ],
            nasId,
            stopTime: null,
        },
    });

    if (!session) {
        throw new AppError(404, 'Session not found');
    }

    // TODO: Send CoA (Change of Authorization) disconnect to router
    // For now, just update database

    await prisma.session.update({
        where: { id: session.id },
        data: {
            stopTime: new Date(),
            terminateCause: 'Admin-Disconnect',
        },
    });

    logger.info({ sessionId: session.sessionId, nasId }, 'User disconnected');

    return c.json({
        success: true,
        message: 'User disconnected successfully',
        sessionId: session.sessionId,
    });
});

// GET /api/mikrotik/:nasId/interfaces
mikrotikRoutes.get('/:nasId/interfaces', async (c) => {
    const tenantId = c.get('tenantId');
    const nasId = c.req.param('nasId');

    const nas = await prisma.nAS.findFirst({
        where: { id: nasId, tenantId },
    });

    if (!nas) {
        throw new AppError(404, 'Router not found');
    }

    // TODO: Implement actual MikroTik API call to get interfaces
    // For now, return mock data
    return c.json({
        interfaces: [
            { name: 'ether1', type: 'ethernet', running: true, mtu: 1500 },
            { name: 'ether2', type: 'ethernet', running: true, mtu: 1500 },
            { name: 'bridge-lan', type: 'bridge', running: true, mtu: 1500 },
            { name: 'wlan1', type: 'wireless', running: false, mtu: 1500 },
        ],
    });
});

// GET /api/mikrotik/:nasId/queues
mikrotikRoutes.get('/:nasId/queues', async (c) => {
    const tenantId = c.get('tenantId');
    const nasId = c.req.param('nasId');

    const nas = await prisma.nAS.findFirst({
        where: { id: nasId, tenantId },
    });

    if (!nas) {
        throw new AppError(404, 'Router not found');
    }

    // TODO: Implement actual MikroTik API call to get queues
    // For now, return mock data based on active customers
    const customers = await prisma.customer.findMany({
        where: { nasId, status: 'ACTIVE', deletedAt: null },
        include: { package: true },
        take: 50,
    });

    const queues = customers.map((c) => ({
        name: `queue-${c.username}`,
        target: c.lastIp ?? 'dynamic',
        maxLimit: c.package ? `${c.package.downloadSpeed}M/${c.package.uploadSpeed}M` : '0/0',
        burstLimit: c.package?.burstDownload ? `${c.package.burstDownload}M/${c.package.burstUpload}M` : undefined,
        disabled: c.status !== 'ACTIVE',
    }));

    return c.json({ queues });
});

// Helper function to format uptime
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
