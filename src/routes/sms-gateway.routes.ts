import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { smsService } from '../services/sms.service.js';

export const smsGatewayRoutes = new Hono<{ Variables: { tenantId: string } }>();

// Apply auth middleware
smsGatewayRoutes.use('*', authMiddleware);

const smsGatewaySchema = z.object({
    provider: z.string(),
    name: z.string().optional(),
    apiKey: z.string().optional(),
    username: z.string().optional(),
    senderId: z.string().optional(),
    config: z.record(z.any()).optional(),
    isDefault: z.boolean().optional(),
    forHotspot: z.boolean().optional(),
    forPppoe: z.boolean().optional()
});

// LIST
smsGatewayRoutes.get('/', requireRole('ADMIN', 'SUPER_ADMIN'), async (c) => {
    const tenantId = c.get('tenantId');
    let gateways = await prisma.smsGateway.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' }
    });

    // Auto-migrate legacy config if new table is empty
    if (gateways.length === 0) {
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId }
        });

        // Check if legacy config exists
        if (tenant && tenant.smsProvider) {
            const newGw = await prisma.smsGateway.create({
                data: {
                    tenant: { connect: { id: tenantId } },
                    provider: tenant.smsProvider,
                    name: 'Migrated SMS Gateway',
                    apiKey: tenant.smsApiKey,
                    senderId: tenant.smsSenderId,
                    config: tenant.smsConfig || {},
                    isDefault: true,
                    forHotspot: true,
                    forPppoe: true
                }
            });
            gateways = [newGw];
        }
    }

    return c.json(gateways);
});

// CREATE
smsGatewayRoutes.post('/', requireRole('ADMIN', 'SUPER_ADMIN'), async (c) => {
    const tenantId = c.get('tenantId');
    const body = await c.req.json();
    const data = smsGatewaySchema.parse(body);

    // If default, unset others
    if (data.isDefault) {
        await prisma.smsGateway.updateMany({
            where: { tenantId, isDefault: true },
            data: { isDefault: false }
        });
    }

    const gw = await prisma.smsGateway.create({
        data: {
            tenant: { connect: { id: tenantId } },
            ...data,
            provider: data.provider,
            name: data.name || `${data.provider} Gateway`
        }
    });

    return c.json(gw, 201);
});

// UPDATE
smsGatewayRoutes.put('/:id', requireRole('ADMIN', 'SUPER_ADMIN'), async (c) => {
    const tenantId = c.get('tenantId');
    const id = c.req.param('id');
    const body = await c.req.json();
    const data = smsGatewaySchema.partial().parse(body);

    const gw = await prisma.smsGateway.findFirst({ where: { id, tenantId } });
    if (!gw) return c.json({ error: 'Gateway not found' }, 404);

    if (data.isDefault) {
        await prisma.smsGateway.updateMany({
            where: { tenantId, isDefault: true, id: { not: id } },
            data: { isDefault: false }
        });
    }

    const updated = await prisma.smsGateway.update({
        where: { id },
        data
    });

    return c.json(updated);
});

// DELETE
smsGatewayRoutes.delete('/:id', requireRole('ADMIN', 'SUPER_ADMIN'), async (c) => {
    const tenantId = c.get('tenantId');
    const id = c.req.param('id');

    await prisma.smsGateway.deleteMany({
        where: { id, tenantId } // Ensure ownership
    });

    return c.json({ success: true });
});

// SET DEFAULT
smsGatewayRoutes.post('/:id/default', requireRole('ADMIN', 'SUPER_ADMIN'), async (c) => {
    const tenantId = c.get('tenantId');
    const id = c.req.param('id');

    const gw = await prisma.smsGateway.findFirst({ where: { id, tenantId } });
    if (!gw) return c.json({ error: 'Gateway not found' }, 404);

    await prisma.$transaction([
        prisma.smsGateway.updateMany({
            where: { tenantId, isDefault: true },
            data: { isDefault: false }
        }),
        prisma.smsGateway.update({
            where: { id },
            data: { isDefault: true }
        })
    ]);

    return c.json({ success: true });
});

// TEST CONNECTION
smsGatewayRoutes.post('/:id/test', requireRole('ADMIN', 'SUPER_ADMIN'), async (c) => {
    const tenantId = c.get('tenantId');
    const id = c.req.param('id');

    // Security check: ensure tenant owns gateway
    const gw = await prisma.smsGateway.findFirst({ where: { id, tenantId } });
    if (!gw) return c.json({ error: 'Gateway not found' }, 404);

    const result = await smsService.testGateway(id);
    return c.json(result);
});
