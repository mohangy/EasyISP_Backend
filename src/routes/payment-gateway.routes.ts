import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { testGateway } from '../services/mpesa.service.js';

const pgRoutes = new Hono();

// Apply auth middleware
pgRoutes.use('*', authMiddleware);

// Schema
const gatewaySchema = z.object({
    type: z.string().default('MPESA_API'),
    subType: z.enum(['PAYBILL', 'BUYGOODS', 'BANK']).default('PAYBILL'),
    name: z.string().optional(),
    shortcode: z.string().min(1), // Till number for BuyGoods, Paybill for others
    storeNumber: z.string().optional(), // Head Office/Store Number for BuyGoods
    accountNumber: z.string().optional(),
    consumerKey: z.string().optional(), // Optional - will use defaults if not provided
    consumerSecret: z.string().optional(), // Optional - will use defaults if not provided
    passkey: z.string().optional(), // Optional - will use defaults if not provided
    env: z.enum(['sandbox', 'production']).default('production'),
    forHotspot: z.boolean().default(false),
    forPppoe: z.boolean().default(false),
});

// LIST
pgRoutes.get('/', requireRole('ADMIN', 'SUPER_ADMIN'), async (c) => {
    const tenantId = c.get('tenantId');
    let gateways = await prisma.paymentGateway.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' }
    });

    // Auto-migrate legacy config if new table is empty
    if (gateways.length === 0) {
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId }
        });

        // Check if legacy config exists
        if (tenant && tenant.mpesaConsumerKey && tenant.mpesaShortcode) {
            const newGw = await prisma.paymentGateway.create({
                data: {
                    tenant: { connect: { id: tenantId } },
                    type: 'MPESA_API',
                    name: 'Migrated Gateway',
                    shortcode: tenant.mpesaShortcode,
                    consumerKey: tenant.mpesaConsumerKey,
                    consumerSecret: tenant.mpesaConsumerSecret,
                    passkey: tenant.mpesaPasskey,
                    env: tenant.mpesaEnv || 'production',
                    isDefault: true,
                    forHotspot: true, // Legacy config applied to all
                    forPppoe: true
                }
            });
            gateways = [newGw];
        }
    }

    return c.json(gateways);
});

// CREATE
pgRoutes.post('/', requireRole('ADMIN', 'SUPER_ADMIN'), async (c) => {
    const tenantId = c.get('tenantId');
    const body = await c.req.json();
    const data = gatewaySchema.parse(body);

    // Check if this is the first gateway -> make default
    const count = await prisma.paymentGateway.count({ where: { tenantId } });
    const isDefault = count === 0;

    const gw = await prisma.paymentGateway.create({
        data: {
            ...data,
            type: data.type,
            shortcode: data.shortcode,
            tenant: { connect: { id: tenantId } },
            isDefault
        }
    });

    return c.json(gw, 201);
});

// UPDATE
pgRoutes.put('/:id', requireRole('ADMIN', 'SUPER_ADMIN'), async (c) => {
    const tenantId = c.get('tenantId');
    const { id } = c.req.param();
    const body = await c.req.json();
    const data = gatewaySchema.partial().parse(body);

    const gw = await prisma.paymentGateway.update({
        where: { id, tenantId }, // ensure ownership
        data
    });
    return c.json(gw);
});

// DELETE
pgRoutes.delete('/:id', requireRole('ADMIN', 'SUPER_ADMIN'), async (c) => {
    const tenantId = c.get('tenantId');
    const { id } = c.req.param();

    await prisma.paymentGateway.delete({
        where: { id, tenantId }
    });

    return c.json({ success: true });
});

// SET DEFAULT
pgRoutes.post('/:id/default', requireRole('ADMIN', 'SUPER_ADMIN'), async (c) => {
    const tenantId = c.get('tenantId');
    const { id } = c.req.param();

    // Transaction to unset others and set this one
    await prisma.$transaction([
        prisma.paymentGateway.updateMany({
            where: { tenantId, isDefault: true },
            data: { isDefault: false }
        }),
        prisma.paymentGateway.update({
            where: { id, tenantId },
            data: { isDefault: true }
        })
    ]);

    return c.json({ success: true });
});

// TEST
pgRoutes.post('/:id/test', requireRole('ADMIN', 'SUPER_ADMIN'), async (c) => {
    const tenantId = c.get('tenantId');
    const { id } = c.req.param();

    // verify ownership
    const exists = await prisma.paymentGateway.count({ where: { id, tenantId } });
    if (!exists) throw new AppError(404, 'Gateway not found');

    const result = await testGateway(id);
    if (!result.success) {
        return c.json(result, 400);
    }
    return c.json(result);
});

export { pgRoutes };
