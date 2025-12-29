import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { createAuditLog } from '../lib/audit.js';
import { logger } from '../lib/logger.js';
import { smsService } from '../services/sms.service.js';

export const smsRoutes = new Hono();

// Apply auth middleware to all routes
smsRoutes.use('*', authMiddleware);

// Validation schemas
const sendSmsSchema = z.object({
    recipients: z.array(z.string()).min(1).or(z.string()),
    message: z.string().min(1).max(160),
    scheduleAt: z.string().datetime().optional(),
});

const updateSettingsSchema = z.object({
    provider: z.string().min(1),
    apiKey: z.string().min(1),
    apiSecret: z.string().optional(),
    senderId: z.string().min(1),
    callbackUrl: z.string().url().optional(),
});

// GET /api/sms - List SMS logs
smsRoutes.get('/', async (c) => {
    const tenantId = c.get('tenantId');
    const page = parseInt(c.req.query('page') ?? '1');
    const pageSize = parseInt(c.req.query('pageSize') ?? '20');
    const status = c.req.query('status');
    const search = c.req.query('search');

    interface SmsWhere {
        tenantId: string;
        status?: string;
        OR?: Array<{
            recipient?: { contains: string };
            message?: { contains: string; mode: 'insensitive' };
        }>;
    }

    const where: SmsWhere = { tenantId };

    if (status) where.status = status.toUpperCase();

    if (search) {
        where.OR = [
            { recipient: { contains: search } },
            { message: { contains: search, mode: 'insensitive' } },
        ];
    }

    const [logs, total, statusStats] = await Promise.all([
        prisma.sMSLog.findMany({
            where: where as Parameters<typeof prisma.sMSLog.findMany>[0]['where'],
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.sMSLog.count({ where: where as Parameters<typeof prisma.sMSLog.count>[0]['where'] }),
        prisma.sMSLog.groupBy({
            by: ['status'],
            where: { tenantId },
            _count: true,
        }),
    ]);

    const stats: Record<string, number> = {};
    statusStats.forEach((s) => {
        stats[s.status.toLowerCase()] = s._count;
    });

    return c.json({
        logs: logs.map((log) => ({
            id: log.id,
            recipient: log.recipient,
            message: log.message,
            status: log.status.toLowerCase(),
            provider: log.provider,
            cost: log.cost,
            initiator: log.initiator,
            createdAt: log.createdAt,
        })),
        stats: {
            total,
            sent: stats['sent'] ?? 0,
            delivered: stats['delivered'] ?? 0,
            failed: stats['failed'] ?? 0,
            pending: stats['pending'] ?? 0,
        },
        total,
        page,
        pageSize,
    });
});

// POST /api/sms - Send SMS
smsRoutes.post('/', async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const body = await c.req.json();
    const data = sendSmsSchema.parse(body);

    // Normalize recipients to array
    const recipients = Array.isArray(data.recipients)
        ? data.recipients
        : [data.recipients];

    // Check if tenant has SMS provider configured
    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { smsProvider: true },
    });

    if (!tenant?.smsProvider) {
        throw new AppError(400, 'SMS provider not configured. Please configure in Settings.');
    }

    // Send SMS via unified service
    const results = await Promise.all(
        recipients.map(async (recipient) => {
            const result = await smsService.sendSms(tenantId, recipient, data.message, 'admin_sent');
            return { recipient, ...result };
        })
    );

    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    // Audit log
    await createAuditLog({
        action: 'SMS_SEND',
        targetType: 'SMS',
        targetName: `${recipients.length} recipients`,
        details: `Message: ${data.message.slice(0, 50)}... | Sent: ${successful.length}, Failed: ${failed.length}`,
        user,
    });

    logger.info({ recipients: recipients.length, sent: successful.length, failed: failed.length, tenantId }, 'SMS send completed');

    return c.json(
        {
            success: true,
            sent: successful.length,
            failed: failed.length,
            results,
        },
        201
    );
});

// GET /api/sms/:id - Get single SMS details
smsRoutes.get('/:id', async (c) => {
    const tenantId = c.get('tenantId');
    const id = c.req.param('id');

    const log = await prisma.sMSLog.findUnique({
        where: { id, tenantId },
    });

    if (!log) {
        throw new AppError(404, 'SMS log not found');
    }

    return c.json({
        id: log.id,
        recipient: log.recipient,
        message: log.message,
        status: log.status.toLowerCase(),
        provider: log.provider,
        cost: log.cost,
        initiator: log.initiator,
        createdAt: log.createdAt,
    });
});

// GET /api/sms/:id/delivery-status - Check real delivery status
smsRoutes.get('/:id/delivery-status', async (c) => {
    const tenantId = c.get('tenantId');
    const id = c.req.param('id');

    const log = await prisma.sMSLog.findUnique({
        where: { id, tenantId },
    });

    if (!log) {
        throw new AppError(404, 'SMS log not found');
    }

    if (!log.providerMessageId) {
        return c.json({ success: false, status: 'Unknown', error: 'No provider ID found' });
    }

    const status = await smsService.getDeliveryStatus(tenantId, log.providerMessageId);
    return c.json(status);
});

// DELETE /api/sms/:id - Delete single SMS log
smsRoutes.delete('/:id', async (c) => {
    const tenantId = c.get('tenantId');
    const id = c.req.param('id');
    const user = c.get('user');

    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
        throw new AppError(403, 'Permission denied');
    }

    try {
        await prisma.sMSLog.delete({
            where: { id, tenantId },
        });
        return c.json({ success: true });
    } catch (e) {
        throw new AppError(404, 'SMS log not found');
    }
});

// DELETE /api/sms - Clear all logs
smsRoutes.delete('/', async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');

    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
        throw new AppError(403, 'Only admins can clear SMS logs');
    }

    const result = await prisma.sMSLog.deleteMany({
        where: { tenantId },
    });

    return c.json({
        success: true,
        clearedCount: result.count,
    });
});

// GET /api/sms/balance - Check SMS credits
smsRoutes.get('/balance', async (c) => {
    const tenantId = c.get('tenantId');

    // Get tenant SMS settings
    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { smsBalance: true, smsProvider: true },
    });

    // TODO: Call actual provider API to get balance
    // For now, return stored/mock balance

    return c.json({
        balance: tenant?.smsBalance ?? 0,
        provider: tenant?.smsProvider ?? 'Not configured',
        currency: 'KES',
    });
});

// PUT /api/sms/settings - Update SMS settings
smsRoutes.put('/settings', async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const body = await c.req.json();
    const data = updateSettingsSchema.parse(body);

    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
        throw new AppError(403, 'Only admins can update SMS settings');
    }

    await prisma.tenant.update({
        where: { id: tenantId },
        data: {
            smsProvider: data.provider,
            smsApiKey: data.apiKey,
            smsSenderId: data.senderId,
        },
    });

    return c.json({
        success: true,
        provider: data.provider,
        senderId: data.senderId,
    });
});
