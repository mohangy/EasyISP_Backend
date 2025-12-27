import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { hash } from 'bcryptjs';

export const tenantRoutes = new Hono();

// Apply auth middleware to all routes
tenantRoutes.use('*', authMiddleware);

// Validation schemas
const updateSettingsSchema = z.object({
    businessName: z.string().min(2).optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    location: z.string().optional(),
});

const createOperatorSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
    role: z.enum(['ADMIN', 'STAFF', 'CUSTOMER_CARE', 'FIELD_TECH', 'VIEWER']),
});

// GET /api/tenant/me
tenantRoutes.get('/me', async (c) => {
    const tenantId = c.get('tenantId');

    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: {
            _count: {
                select: {
                    customers: { where: { status: 'ACTIVE', deletedAt: null } },
                    users: { where: { status: 'ACTIVE' } },
                },
            },
        },
    });

    if (!tenant) {
        throw new AppError(404, 'Tenant not found');
    }

    return c.json({
        id: tenant.id,
        name: tenant.name,
        businessName: tenant.businessName,
        email: tenant.email,
        phone: tenant.phone,
        location: tenant.location,
        logo: tenant.logo,
        status: tenant.status,
        walletBalance: tenant.walletBalance,
        activeUsers: tenant._count.customers,
        operators: tenant._count.users,
        createdAt: tenant.createdAt,
    });
});

// PUT /api/tenant/settings
tenantRoutes.put('/settings', requireRole('ADMIN', 'SUPER_ADMIN'), async (c) => {
    const tenantId = c.get('tenantId');
    const body = await c.req.json();
    const data = updateSettingsSchema.parse(body);

    const tenant = await prisma.tenant.update({
        where: { id: tenantId },
        data,
    });

    return c.json({
        success: true,
        tenant: {
            id: tenant.id,
            businessName: tenant.businessName,
            email: tenant.email,
            phone: tenant.phone,
            location: tenant.location,
        },
    });
});

// GET /api/tenant/operators
tenantRoutes.get('/operators', async (c) => {
    const tenantId = c.get('tenantId');

    const operators = await prisma.user.findMany({
        where: { tenantId, status: { not: 'DELETED' } },
        select: {
            id: true,
            name: true,
            email: true,
            role: true,
            status: true,
            createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
    });

    return c.json({
        operators,
        total: operators.length,
    });
});

// POST /api/tenant/operators
tenantRoutes.post('/operators', requireRole('ADMIN', 'SUPER_ADMIN'), async (c) => {
    const tenantId = c.get('tenantId');
    const body = await c.req.json();
    const { name, email, password, role } = createOperatorSchema.parse(body);

    // Check if email exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
        throw new AppError(409, 'Email already registered');
    }

    const hashedPassword = await hash(password, 12);

    const operator = await prisma.user.create({
        data: {
            name,
            email,
            password: hashedPassword,
            role,
            tenantId,
        },
        select: {
            id: true,
            name: true,
            email: true,
            role: true,
            status: true,
            createdAt: true,
        },
    });

    return c.json(operator, 201);
});

// GET /api/tenant/operators/:id
tenantRoutes.get('/operators/:id', async (c) => {
    const tenantId = c.get('tenantId');
    const operatorId = c.req.param('id');

    const operator = await prisma.user.findFirst({
        where: { id: operatorId, tenantId },
        select: {
            id: true,
            name: true,
            email: true,
            role: true,
            status: true,
            addedPermissions: true,
            removedPermissions: true,
            createdAt: true,
        },
    });

    if (!operator) {
        throw new AppError(404, 'Operator not found');
    }

    return c.json(operator);
});

// PUT /api/tenant/operators/:id
tenantRoutes.put('/operators/:id', requireRole('ADMIN', 'SUPER_ADMIN'), async (c) => {
    const tenantId = c.get('tenantId');
    const operatorId = c.req.param('id');
    const body = await c.req.json();

    const operator = await prisma.user.findFirst({
        where: { id: operatorId, tenantId },
    });

    if (!operator) {
        throw new AppError(404, 'Operator not found');
    }

    const updated = await prisma.user.update({
        where: { id: operatorId },
        data: {
            name: body.name,
            role: body.role,
            status: body.status,
            addedPermissions: body.addedPermissions,
            removedPermissions: body.removedPermissions,
        },
        select: {
            id: true,
            name: true,
            email: true,
            role: true,
            status: true,
        },
    });

    return c.json(updated);
});

// DELETE /api/tenant/operators/:id
tenantRoutes.delete('/operators/:id', requireRole('ADMIN', 'SUPER_ADMIN'), async (c) => {
    const tenantId = c.get('tenantId');
    const currentUser = c.get('user');
    const operatorId = c.req.param('id');

    if (operatorId === currentUser.id) {
        throw new AppError(400, 'Cannot delete your own account');
    }

    const operator = await prisma.user.findFirst({
        where: { id: operatorId, tenantId },
    });

    if (!operator) {
        throw new AppError(404, 'Operator not found');
    }

    await prisma.user.update({
        where: { id: operatorId },
        data: { status: 'DELETED' },
    });

    return c.json({ success: true });
});

// POST /api/tenant/operators/:id/reset-password
tenantRoutes.post('/operators/:id/reset-password', requireRole('ADMIN', 'SUPER_ADMIN'), async (c) => {
    const tenantId = c.get('tenantId');
    const operatorId = c.req.param('id');

    const operator = await prisma.user.findFirst({
        where: { id: operatorId, tenantId },
    });

    if (!operator) {
        throw new AppError(404, 'Operator not found');
    }

    // Generate temporary password
    const tempPassword = Math.random().toString(36).slice(-8) + 'A1!';
    const hashedPassword = await hash(tempPassword, 12);

    await prisma.user.update({
        where: { id: operatorId },
        data: { password: hashedPassword },
    });

    return c.json({
        temporaryPassword: tempPassword,
        message: 'Password reset successfully. User must change on next login.',
    });
});

// GET /api/tenant/operators/:id/logs
tenantRoutes.get('/operators/:id/logs', async (c) => {
    const tenantId = c.get('tenantId');
    const operatorId = c.req.param('id');
    const page = parseInt(c.req.query('page') ?? '1');
    const pageSize = parseInt(c.req.query('pageSize') ?? '10');

    // Verify operator belongs to tenant
    const operator = await prisma.user.findFirst({
        where: { id: operatorId, tenantId },
    });

    if (!operator) {
        throw new AppError(404, 'Operator not found');
    }

    const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
            where: { userId: operatorId, tenantId },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
            select: {
                id: true,
                action: true,
                targetType: true,
                targetName: true,
                details: true,
                createdAt: true,
            },
        }),
        prisma.auditLog.count({ where: { userId: operatorId, tenantId } }),
    ]);

    return c.json({
        logs: logs.map((log) => ({
            id: log.id,
            action: log.action,
            targetType: log.targetType,
            targetName: log.targetName,
            details: log.details,
            timestamp: log.createdAt,
        })),
        total,
    });
});
