import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole, requirePermission } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { smsService } from '../services/sms.service.js';
import bcrypt from 'bcryptjs';
const { hash } = bcrypt;

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

// ==================== SMS Configuration Endpoints ====================

// GET /api/tenant/sms-config/providers - List available SMS providers
tenantRoutes.get('/sms-config/providers', async (c) => {
    const providers = smsService.getProviders();
    return c.json({ providers });
});

// GET /api/tenant/sms-config - Get current SMS configuration
tenantRoutes.get('/sms-config', requireRole('ADMIN', 'SUPER_ADMIN'), async (c) => {
    const tenantId = c.get('tenantId');

    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
            smsProvider: true,
            smsApiKey: true,
            smsConfig: true,
            smsSenderId: true,
            smsBalance: true,
        },
    });

    if (!tenant) {
        throw new AppError(404, 'Tenant not found');
    }

    return c.json({
        provider: tenant.smsProvider,
        senderId: tenant.smsSenderId,
        balance: tenant.smsBalance,
        config: tenant.smsConfig || {},
        // Mask API key for security
        hasApiKey: !!tenant.smsApiKey,
    });
});

// PUT /api/tenant/sms-config - Update SMS configuration
const updateSmsConfigSchema = z.object({
    provider: z.enum(['TEXTSMS', 'TALKSASA', 'HOSTPINNACLE', 'CELCOM', 'BYTEWAVE', 'BLESSEDTEXT', 'ADVANTA']),
    senderId: z.string().min(1),
    config: z.record(z.any()), // Provider-specific config
});

tenantRoutes.put('/sms-config', requireRole('ADMIN', 'SUPER_ADMIN'), async (c) => {
    const tenantId = c.get('tenantId');
    const body = await c.req.json();
    const { provider, senderId, config } = updateSmsConfigSchema.parse(body);

    // Extract apiKey from config if present
    const apiKey = config.apikey || config.apiKey || config.apiToken || config.proxyApiKey || null;

    await prisma.tenant.update({
        where: { id: tenantId },
        data: {
            smsProvider: provider,
            smsSenderId: senderId,
            smsApiKey: apiKey,
            smsConfig: config,
        },
    });

    return c.json({
        success: true,
        message: `SMS provider set to ${provider}`,
    });
});

// POST /api/tenant/sms-config/test - Test SMS configuration
tenantRoutes.post('/sms-config/test', requireRole('ADMIN', 'SUPER_ADMIN'), async (c) => {
    const body = await c.req.json();
    const { provider, config } = body;

    if (!provider || !config) {
        throw new AppError(400, 'Provider and config are required');
    }

    const result = await smsService.testConnection(provider, config);
    return c.json(result);
});

// POST /api/tenant/sms-config/send-test - Send test SMS
const sendTestSmsSchema = z.object({
    phone: z.string().min(10),
    message: z.string().min(1).max(160),
});

tenantRoutes.post('/sms-config/send-test', requireRole('ADMIN', 'SUPER_ADMIN'), async (c) => {
    const tenantId = c.get('tenantId');
    const body = await c.req.json();
    const { phone, message } = sendTestSmsSchema.parse(body);

    const result = await smsService.sendSms(tenantId, phone, message);

    if (result.success) {
        return c.json({
            success: true,
            message: 'Test SMS sent successfully',
            messageId: result.messageId,
        });
    } else {
        return c.json({
            success: false,
            message: result.error || 'Failed to send test SMS',
        }, 400);
    }
});

// GET /api/tenant/sms-balance - Get SMS balance
tenantRoutes.get('/sms-balance', async (c) => {
    const tenantId = c.get('tenantId');
    const result = await smsService.getBalance(tenantId);
    return c.json(result);
});
