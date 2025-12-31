import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requirePermission } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import type { ConnectionType } from '@prisma/client';

export const packageRoutes = new Hono();

// Apply auth middleware to all routes
packageRoutes.use('*', authMiddleware);

// Validation schemas
const createPackageSchema = z.object({
    name: z.string().min(2),
    type: z.enum(['PPPOE', 'HOTSPOT']),
    price: z.number().positive(),
    downloadSpeed: z.number().positive(),
    uploadSpeed: z.number().positive(),
    burstDownload: z.number().positive().nullable().optional(),
    burstUpload: z.number().positive().nullable().optional(),
    sessionTime: z.number().positive().nullable().optional(), // Minutes (for hotspot)
    dataLimit: z.number().positive().nullable().optional(), // Bytes
    routerIds: z.array(z.string().uuid()).optional(),
    isActive: z.boolean().optional(),
});

const updatePackageSchema = createPackageSchema.partial();

// GET /api/packages
packageRoutes.get('/', requirePermission('packages:view'), async (c) => {
    const tenantId = c.get('tenantId');
    const type = c.req.query('type') as ConnectionType | undefined;
    const active = c.req.query('active');

    const where: {
        tenantId: string;
        type?: ConnectionType;
        isActive?: boolean;
    } = { tenantId };

    if (type) where.type = type;
    if (active !== undefined) where.isActive = active === 'true';

    const packages = await prisma.package.findMany({
        where,
        include: {
            _count: {
                select: {
                    customers: { where: { deletedAt: null } },
                    vouchers: { where: { status: 'AVAILABLE' } },
                },
            },
            routers: {
                include: {
                    nas: { select: { id: true, name: true } },
                },
            },
        },
        orderBy: { name: 'asc' },
    });

    return c.json(
        packages.map((pkg) => ({
            id: pkg.id,
            name: pkg.name,
            type: pkg.type,
            price: pkg.price,
            downloadSpeed: pkg.downloadSpeed,
            uploadSpeed: pkg.uploadSpeed,
            burstDownload: pkg.burstDownload,
            burstUpload: pkg.burstUpload,
            sessionTime: pkg.sessionTime,
            dataLimit: pkg.dataLimit ? pkg.dataLimit.toString() : null,
            isActive: pkg.isActive,
            customerCount: pkg._count.customers,
            voucherCount: pkg._count.vouchers,
            routers: pkg.routers.map((r) => r.nas),
            createdAt: pkg.createdAt,
        }))
    );
});

// GET /api/packages/:id
packageRoutes.get('/:id', requirePermission('packages:details_view'), async (c) => {
    const tenantId = c.get('tenantId');
    const packageId = c.req.param('id');

    const pkg = await prisma.package.findFirst({
        where: { id: packageId, tenantId },
        include: {
            _count: {
                select: {
                    customers: { where: { deletedAt: null } },
                    vouchers: true,
                },
            },
            routers: {
                include: {
                    nas: { select: { id: true, name: true, ipAddress: true } },
                },
            },
        },
    });

    if (!pkg) {
        throw new AppError(404, 'Package not found');
    }

    return c.json({
        id: pkg.id,
        name: pkg.name,
        type: pkg.type,
        price: pkg.price,
        downloadSpeed: pkg.downloadSpeed,
        uploadSpeed: pkg.uploadSpeed,
        burstDownload: pkg.burstDownload,
        burstUpload: pkg.burstUpload,
        sessionTime: pkg.sessionTime,
        dataLimit: pkg.dataLimit ? pkg.dataLimit.toString() : null,
        isActive: pkg.isActive,
        customerCount: pkg._count.customers,
        voucherCount: pkg._count.vouchers,
        routers: pkg.routers.map((r) => r.nas),
        createdAt: pkg.createdAt,
    });
});

// POST /api/packages
packageRoutes.post('/', requirePermission('packages:add_pppoe'), async (c) => {
    const tenantId = c.get('tenantId');
    const body = await c.req.json();
    const data = createPackageSchema.parse(body);

    const pkg = await prisma.package.create({
        data: {
            name: data.name,
            type: data.type as ConnectionType,
            price: data.price,
            downloadSpeed: data.downloadSpeed,
            uploadSpeed: data.uploadSpeed,
            burstDownload: data.burstDownload,
            burstUpload: data.burstUpload,
            sessionTime: data.sessionTime,
            dataLimit: data.dataLimit ? BigInt(data.dataLimit) : undefined,
            isActive: data.isActive ?? true,
            tenantId,
            routers: data.routerIds
                ? {
                    create: data.routerIds.map((nasId) => ({ nasId })),
                }
                : undefined,
        },
        include: {
            routers: {
                include: { nas: { select: { id: true, name: true } } },
            },
        },
    });

    return c.json(
        {
            id: pkg.id,
            name: pkg.name,
            type: pkg.type,
            price: pkg.price,
            downloadSpeed: pkg.downloadSpeed,
            uploadSpeed: pkg.uploadSpeed,
            isActive: pkg.isActive,
            routers: pkg.routers.map((r) => r.nas),
        },
        201
    );
});

// PUT /api/packages/:id
packageRoutes.put('/:id', requirePermission('packages:edit'), async (c) => {
    const tenantId = c.get('tenantId');
    const packageId = c.req.param('id');
    const body = await c.req.json();
    const data = updatePackageSchema.parse(body);

    const existing = await prisma.package.findFirst({
        where: { id: packageId, tenantId },
    });

    if (!existing) {
        throw new AppError(404, 'Package not found');
    }

    // Handle router associations separately
    if (data.routerIds !== undefined) {
        // Remove existing associations
        await prisma.packageRouter.deleteMany({ where: { packageId } });
        // Add new ones
        if (data.routerIds.length > 0) {
            await prisma.packageRouter.createMany({
                data: data.routerIds.map((nasId) => ({ packageId, nasId })),
            });
        }
    }

    // Prevent disabling if active customers exist
    if (data.isActive === false && existing.isActive) {
        const activeUsers = await prisma.customer.count({
            where: {
                packageId,
                deletedAt: null
            }
        });

        if (activeUsers > 0) {
            throw new AppError(400, `Cannot disable package: ${activeUsers} customers are still assigned to it. Please migrate them first.`);
        }
    }

    const pkg = await prisma.package.update({
        where: { id: packageId },
        data: {
            name: data.name,
            type: data.type as ConnectionType | undefined,
            price: data.price,
            downloadSpeed: data.downloadSpeed,
            uploadSpeed: data.uploadSpeed,
            burstDownload: data.burstDownload,
            burstUpload: data.burstUpload,
            sessionTime: data.sessionTime,
            dataLimit: data.dataLimit ? BigInt(data.dataLimit) : undefined,
            isActive: data.isActive,
        },
        include: {
            routers: {
                include: { nas: { select: { id: true, name: true } } },
            },
        },
    });

    return c.json({
        id: pkg.id,
        name: pkg.name,
        type: pkg.type,
        price: pkg.price,
        downloadSpeed: pkg.downloadSpeed,
        uploadSpeed: pkg.uploadSpeed,
        isActive: pkg.isActive,
        routers: pkg.routers.map((r) => r.nas),
    });
});

// DELETE /api/packages/:id
packageRoutes.delete('/:id', requirePermission('packages:delete'), async (c) => {
    const tenantId = c.get('tenantId');
    const packageId = c.req.param('id');

    const pkg = await prisma.package.findFirst({
        where: { id: packageId, tenantId },
        include: { _count: { select: { customers: true } } },
    });

    if (!pkg) {
        throw new AppError(404, 'Package not found');
    }

    if (pkg._count.customers > 0) {
        throw new AppError(400, 'Cannot delete package with active customers');
    }

    // Delete router associations first
    await prisma.packageRouter.deleteMany({ where: { packageId } });
    // Delete package
    await prisma.package.delete({ where: { id: packageId } });

    return c.json({ success: true });
});

// GET /api/packages/:id/stats
packageRoutes.get('/:id/stats', requirePermission('packages:details_view'), async (c) => {
    const tenantId = c.get('tenantId');
    const packageId = c.req.param('id');

    const pkg = await prisma.package.findFirst({
        where: { id: packageId, tenantId },
    });

    if (!pkg) {
        throw new AppError(404, 'Package not found');
    }

    const [totalClients, activeClients, expiredClients] = await Promise.all([
        prisma.customer.count({
            where: { packageId, tenantId, deletedAt: null },
        }),
        prisma.customer.count({
            where: { packageId, tenantId, status: 'ACTIVE', deletedAt: null },
        }),
        prisma.customer.count({
            where: { packageId, tenantId, status: 'EXPIRED', deletedAt: null },
        }),
    ]);

    // Calculate total revenue from this package
    const revenue = await prisma.payment.aggregate({
        where: {
            tenantId,
            status: 'COMPLETED',
            customer: { packageId },
        },
        _sum: { amount: true },
    });

    return c.json({
        totalClients,
        activeClients,
        expiredClients,
        suspendedClients: totalClients - activeClients - expiredClients,
        revenue: revenue._sum.amount ?? 0,
    });
});

// GET /api/packages/:id/router-revenue
packageRoutes.get('/:id/router-revenue', requirePermission('packages:details_view'), async (c) => {
    const tenantId = c.get('tenantId');
    const packageId = c.req.param('id');

    const pkg = await prisma.package.findFirst({
        where: { id: packageId, tenantId },
        include: {
            routers: {
                include: { nas: { select: { id: true, name: true } } },
            },
        },
    });

    if (!pkg) {
        throw new AppError(404, 'Package not found');
    }

    // Get revenue breakdown by router
    const revenueByRouter = await Promise.all(
        pkg.routers.map(async (router) => {
            const revenue = await prisma.payment.aggregate({
                where: {
                    tenantId,
                    status: 'COMPLETED',
                    customer: {
                        packageId,
                        nasId: router.nasId,
                    },
                },
                _sum: { amount: true },
            });

            return {
                routerId: router.nas.id,
                routerName: router.nas.name,
                revenue: revenue._sum.amount ?? 0,
            };
        })
    );

    return c.json(revenueByRouter);
});
