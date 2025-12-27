import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { createAuditLog } from '../lib/audit.js';
export const nasRoutes = new Hono();
// Apply auth middleware to all routes
nasRoutes.use('*', authMiddleware);
// Validation schemas
const createNasSchema = z.object({
    name: z.string().min(1),
    ipAddress: z.string().ip(),
    secret: z.string().min(4),
    coaPort: z.number().optional().default(3799),
    apiUsername: z.string().optional(),
    apiPassword: z.string().optional(),
    apiPort: z.number().optional().default(8728),
});
const updateNasSchema = createNasSchema.partial();
// GET /api/nas
nasRoutes.get('/', async (c) => {
    const tenantId = c.get('tenantId');
    const page = parseInt(c.req.query('page') ?? '1');
    const pageSize = parseInt(c.req.query('pageSize') ?? '10');
    const search = c.req.query('search');
    const status = c.req.query('status');
    const where = { tenantId };
    if (status)
        where.status = status.toUpperCase();
    if (search) {
        where.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { ipAddress: { contains: search } },
        ];
    }
    const [routers, total] = await Promise.all([
        prisma.nAS.findMany({
            where: where,
            include: {
                _count: {
                    select: { customers: { where: { deletedAt: null } } },
                },
            },
            orderBy: { name: 'asc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.nAS.count({ where: where }),
    ]);
    return c.json({
        routers: routers.map((nas) => ({
            id: nas.id,
            name: nas.name,
            boardName: nas.boardName,
            ipAddress: nas.ipAddress,
            status: nas.status,
            cpuLoad: nas.cpuLoad,
            memoryUsage: nas.memoryUsage,
            memoryTotal: nas.memoryTotal,
            uptime: nas.uptime,
            routerOsVersion: nas.routerOsVersion,
            customerCount: nas._count.customers,
            lastSeen: nas.lastSeen,
            createdAt: nas.createdAt,
        })),
        total,
        page,
        pageSize,
    });
});
// GET /api/nas/:id
nasRoutes.get('/:id', async (c) => {
    const tenantId = c.get('tenantId');
    const nasId = c.req.param('id');
    const nas = await prisma.nAS.findFirst({
        where: { id: nasId, tenantId },
        include: {
            _count: {
                select: { customers: { where: { deletedAt: null } } },
            },
        },
    });
    if (!nas) {
        throw new AppError(404, 'Router not found');
    }
    return c.json({
        id: nas.id,
        name: nas.name,
        boardName: nas.boardName,
        ipAddress: nas.ipAddress,
        secret: '********', // Hide secret
        coaPort: nas.coaPort,
        apiUsername: nas.apiUsername,
        apiPort: nas.apiPort,
        status: nas.status,
        cpuLoad: nas.cpuLoad,
        memoryUsage: nas.memoryUsage,
        memoryTotal: nas.memoryTotal,
        uptime: nas.uptime,
        routerOsVersion: nas.routerOsVersion,
        customerCount: nas._count.customers,
        lastSeen: nas.lastSeen,
        createdAt: nas.createdAt,
    });
});
// POST /api/nas
nasRoutes.post('/', async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const body = await c.req.json();
    const data = createNasSchema.parse(body);
    // Check for duplicate IP
    const existing = await prisma.nAS.findFirst({
        where: { ipAddress: data.ipAddress, tenantId },
    });
    if (existing) {
        throw new AppError(409, 'Router with this IP already exists');
    }
    const nas = await prisma.nAS.create({
        data: {
            name: data.name,
            ipAddress: data.ipAddress,
            secret: data.secret,
            coaPort: data.coaPort ?? 3799,
            apiUsername: data.apiUsername,
            apiPassword: data.apiPassword,
            apiPort: data.apiPort ?? 8728,
            tenantId,
        },
    });
    // Audit log
    await createAuditLog({
        action: 'ROUTER_CREATE',
        targetType: 'NAS',
        targetId: nas.id,
        targetName: nas.name,
        user,
    });
    return c.json({
        id: nas.id,
        name: nas.name,
        ipAddress: nas.ipAddress,
        status: nas.status,
    }, 201);
});
// PUT /api/nas/:id
nasRoutes.put('/:id', async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const nasId = c.req.param('id');
    const body = await c.req.json();
    const data = updateNasSchema.parse(body);
    const existing = await prisma.nAS.findFirst({
        where: { id: nasId, tenantId },
    });
    if (!existing) {
        throw new AppError(404, 'Router not found');
    }
    // Check for duplicate IP if changing
    if (data.ipAddress && data.ipAddress !== existing.ipAddress) {
        const ipExists = await prisma.nAS.findFirst({
            where: { ipAddress: data.ipAddress, tenantId, id: { not: nasId } },
        });
        if (ipExists) {
            throw new AppError(409, 'Router with this IP already exists');
        }
    }
    const nas = await prisma.nAS.update({
        where: { id: nasId },
        data,
    });
    // Audit log
    await createAuditLog({
        action: 'ROUTER_UPDATE',
        targetType: 'NAS',
        targetId: nas.id,
        targetName: nas.name,
        user,
    });
    return c.json({
        id: nas.id,
        name: nas.name,
        ipAddress: nas.ipAddress,
        status: nas.status,
    });
});
// DELETE /api/nas/:id
nasRoutes.delete('/:id', async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const nasId = c.req.param('id');
    const nas = await prisma.nAS.findFirst({
        where: { id: nasId, tenantId },
        include: { _count: { select: { customers: true } } },
    });
    if (!nas) {
        throw new AppError(404, 'Router not found');
    }
    if (nas._count.customers > 0) {
        throw new AppError(400, 'Cannot delete router with active customers');
    }
    // Delete package associations first
    await prisma.packageRouter.deleteMany({ where: { nasId } });
    // Delete router
    await prisma.nAS.delete({ where: { id: nasId } });
    // Audit log
    await createAuditLog({
        action: 'ROUTER_DELETE',
        targetType: 'NAS',
        targetId: nas.id,
        targetName: nas.name,
        user,
    });
    return c.json({ success: true });
});
// POST /api/nas/:id/test
nasRoutes.post('/:id/test', async (c) => {
    const tenantId = c.get('tenantId');
    const nasId = c.req.param('id');
    const nas = await prisma.nAS.findFirst({
        where: { id: nasId, tenantId },
    });
    if (!nas) {
        throw new AppError(404, 'Router not found');
    }
    // TODO: Implement actual connection test to MikroTik API
    // For now, return mock result
    const isReachable = true; // Would be actual ping/API test
    if (isReachable) {
        await prisma.nAS.update({
            where: { id: nasId },
            data: {
                status: 'ONLINE',
                lastSeen: new Date(),
            },
        });
    }
    return c.json({
        success: isReachable,
        message: isReachable ? 'Connection successful' : 'Connection failed',
        status: isReachable ? 'ONLINE' : 'OFFLINE',
    });
});
// GET /api/nas/:id/live-status
nasRoutes.get('/:id/live-status', async (c) => {
    const tenantId = c.get('tenantId');
    const nasId = c.req.param('id');
    const nas = await prisma.nAS.findFirst({
        where: { id: nasId, tenantId },
    });
    if (!nas) {
        throw new AppError(404, 'Router not found');
    }
    // Get active session count for this router
    const activeSessions = await prisma.session.count({
        where: { nasId, stopTime: null },
    });
    // TODO: Implement actual MikroTik API call for live stats
    // For now, return stored values
    return c.json({
        id: nas.id,
        name: nas.name,
        status: nas.status,
        cpuLoad: nas.cpuLoad ?? 0,
        memoryUsage: nas.memoryUsage ?? 0,
        memoryTotal: nas.memoryTotal ?? 0,
        uptime: nas.uptime ?? 'Unknown',
        activeSessions,
        lastSeen: nas.lastSeen,
    });
});
// GET /api/nas/:id/config
nasRoutes.get('/:id/config', async (c) => {
    const tenantId = c.get('tenantId');
    const nasId = c.req.param('id');
    const nas = await prisma.nAS.findFirst({
        where: { id: nasId, tenantId },
    });
    if (!nas) {
        throw new AppError(404, 'Router not found');
    }
    // Generate RADIUS configuration script for MikroTik
    const radiusServer = process.env['RADIUS_SERVER'] ?? '0.0.0.0';
    const radiusPort = process.env['RADIUS_PORT'] ?? '1812';
    const acctPort = process.env['RADIUS_ACCT_PORT'] ?? '1813';
    const configScript = `
# EasyISP RADIUS Configuration for ${nas.name}
# Generated: ${new Date().toISOString()}

/radius
add address=${radiusServer} secret="${nas.secret}" service=hotspot,login,ppp authentication-port=${radiusPort} accounting-port=${acctPort} timeout=3000ms

/ppp aaa
set use-radius=yes accounting=yes interim-update=5m

/user aaa
set use-radius=yes accounting=yes interim-update=5m

# Hotspot Configuration (if applicable)
/ip hotspot profile
set [ find default=yes ] use-radius=yes radius-interim-update=5m

# CoA Settings
/radius incoming
set accept=yes port=${nas.coaPort}
`.trim();
    return c.json({
        routerId: nas.id,
        routerName: nas.name,
        script: configScript,
    });
});
//# sourceMappingURL=nas.routes.js.map