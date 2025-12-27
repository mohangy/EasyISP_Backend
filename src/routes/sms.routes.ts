import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { createAuditLog } from '../lib/audit.js';
import { logger } from '../lib/logger.js';

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

    // TODO: Implement actual SMS sending via provider
    // For now, just log the messages

    const logs = await prisma.sMSLog.createManyAndReturn({
        data: recipients.map((recipient) => ({
            recipient,
            message: data.message,
            status: 'PENDING',
            provider: 'mock', // Would be actual provider
            tenantId,
        })),
    });

    // Audit log
    await createAuditLog({
        action: 'SMS_SEND',
        targetType: 'SMS',
        targetName: `${recipients.length} recipients`,
        details: `Message: ${data.message.slice(0, 50)}...`,
        user,
    });

    logger.info({ recipients: recipients.length, tenantId }, 'SMS send requested');

    return c.json(
        {
            success: true,
            count: recipients.length,
            messageIds: logs.map((l) => l.id),
        },
        201
    );
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
