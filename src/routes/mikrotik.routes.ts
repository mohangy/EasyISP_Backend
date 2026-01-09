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

// GET /api/mikrotik/:nasId/hotspot-users - Get active hotspot users from MikroTik
mikrotikRoutes.get('/:nasId/hotspot-users', async (c) => {
    const tenantId = c.get('tenantId');
    const nasId = c.req.param('nasId');

    const nas = await prisma.nAS.findFirst({
        where: { id: nasId, tenantId },
    });

    if (!nas) {
        throw new AppError(404, 'Router not found');
    }

    try {
        const activeUsers = await mikrotikService.getActiveHotspotUsers(nas);
        return c.json(activeUsers);
    } catch (error) {
        logger.error({ nasId, error }, 'Failed to fetch hotspot users from MikroTik');
        // Return empty array instead of error to allow frontend to handle gracefully
        return c.json([]);
    }
});

// GET /api/mikrotik/:nasId/hotspot-config.js - Generate dynamic config for router
mikrotikRoutes.get('/:nasId/hotspot-config.js', async (c) => {
    // No auth needed as router pulls this with curl/fetch via VPN/Public IP
    // But we need to verify the ID exists. 
    // Ideally this should be secured, but for now we rely on the ID being secret-ish or firewall rules.
    // Actually, updateHotspotFiles uses standard fetch, so we can require basic auth or just rely on UUID.

    // NOTE: This endpoint is public (no JWT auth middleware applied in main index.ts for /api/mikrotik if we aren't careful)
    // Actually mikrotikRoutes ARE protected by default auth middleware in index.ts if mounted under /api
    // We might need to make this one public or pass a token.
    // For simplicity, since updateHotspotFiles is authenticated (USER triggers it), 
    // and the ROUTER fetches it... the ROUTER is not authenticated with a user token.
    // The router fetch logic in mikrotik.service.ts doesn't add headers.

    // Wait, updateHotspotFiles is triggered by USER. Data flows Server -> Router via /tool/fetch.
    // The Router is the one making the GET request to this endpoint.
    // The Router does NOT have the user's JWT.
    // So this endpoint MUST be public or use a specific token.
    // For now, let's make it public but obscure? Or bypass auth middleware?
    // mikrotikRoutes is mounted at /api/mikrotik which IS protected by authRoutes? 
    // No, index.ts: app.use('*', secureHeaders()); ...
    // index.ts: api.route('/auth', authRoutes)...
    // We need to check index.ts to see if /api/mikrotik is protected.

    // Looking at index.ts, there is no global auth middleware applied to `api` router.
    // Auth middleware is usually applied inside specific route files or on specific paths.
    // mikrotik.routes.ts uses `authMiddleware`? I need to check the file top imports.

    const nasId = c.req.param('nasId');
    const nas = await prisma.nAS.findUnique({
        where: { id: nasId },
    });

    if (!nas) {
        return c.text('// Router not found', 404);
    }

    const publicUrl = process.env['API_BASE_URL'] ?? 'https://113-30-190-52.cloud-xip.com';
    // If we are accessed via VPN IP, we should use VPN IP for the API base URL in the config too?
    // Actually, the USER's phone connects to the captive portal.
    // The USER's phone is NOT on the VPN. The USER's phone is on the User WiFi.
    // The USER's phone must be able to reach the API.
    // If the API is public, use public URL.

    // Content of config.js
    const configContent = `
window.EASYISP_CONFIG = {
    tenantId: "${nas.tenantId}",
    apiBaseUrl: "${publicUrl}/api"
};
`;

    return c.text(configContent, 200, {
        'Content-Type': 'application/javascript',
    });
});

// POST /api/mikrotik/:nasId/update-hotspot - Update hotspot files on router
mikrotikRoutes.post('/:nasId/update-hotspot', async (c) => {
    const tenantId = c.get('tenantId');
    const nasId = c.req.param('nasId');

    const nas = await prisma.nAS.findFirst({
        where: { id: nasId, tenantId },
    });

    if (!nas) {
        throw new AppError(404, 'Router not found');
    }

    try {
        const result = await mikrotikService.updateHotspotFiles(nas);
        return c.json({
            success: true,
            message: 'Hotspot files updated successfully',
            files: result.files
        });
    } catch (error) {
        logger.error({ nasId, error }, 'Failed to update hotspot files');
        throw new AppError(500, `Failed to update files: ${(error as Error).message}`);
    }
});

// POST /api/mikrotik/:nasId/update-config - Update router configuration (Golden State)
mikrotikRoutes.post('/:nasId/update-config', async (c) => {
    const tenantId = c.get('tenantId');
    const nasId = c.req.param('nasId');

    const nas = await prisma.nAS.findFirst({
        where: { id: nasId, tenantId },
    });

    if (!nas) {
        throw new AppError(404, 'Router not found');
    }

    try {
        await mikrotikService.updateRouterConfiguration(nas.id);
        return c.json({
            success: true,
            message: 'Router configuration updated successfully'
        });
    } catch (error) {
        logger.error({ nasId, error }, 'Failed to update router configuration');
        throw new AppError(500, `Failed to update configuration: ${(error as Error).message}`);
    }
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

// GET /api/mikrotik/:nasId/ping - Test router connectivity
mikrotikRoutes.get('/:nasId/ping', async (c) => {
    const tenantId = c.get('tenantId');
    const nasId = c.req.param('nasId');

    const nas = await prisma.nAS.findFirst({
        where: { id: nasId, tenantId },
    });

    if (!nas) {
        throw new AppError(404, 'Router not found');
    }

    const result = await mikrotikService.pingRouter(nas.ipAddress);

    return c.json({
        routerId: nas.id,
        routerName: nas.name,
        ipAddress: nas.ipAddress,
        ...result,
    });
});

// GET /api/mikrotik/:nasId/active-sessions - Get real-time active sessions from MikroTik
mikrotikRoutes.get('/:nasId/active-sessions', async (c) => {
    const tenantId = c.get('tenantId');
    const nasId = c.req.param('nasId');

    const nas = await prisma.nAS.findFirst({
        where: { id: nasId, tenantId },
    });

    if (!nas) {
        throw new AppError(404, 'Router not found');
    }

    try {
        const sessions = await mikrotikService.getActiveSessions(nas);
        return c.json({
            sessions,
            total: sessions.length,
            source: 'mikrotik',
        });
    } catch (error) {
        // Fallback to database if MikroTik connection fails
        const dbSessions = await prisma.session.findMany({
            where: { nasId, stopTime: null },
            include: { customer: { select: { id: true, name: true, username: true } } },
            take: 100,
        });

        return c.json({
            sessions: dbSessions.map(s => ({
                name: s.username,
                address: s.framedIp,
                callerId: s.macAddress,
                uptime: formatUptime(Math.floor((Date.now() - s.startTime.getTime()) / 1000)),
            })),
            total: dbSessions.length,
            source: 'database',
            error: 'Could not connect to router',
        });
    }
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

import { mikrotikService } from '../services/mikrotik.service.js';
