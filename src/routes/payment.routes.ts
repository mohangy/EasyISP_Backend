import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requirePermission } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../lib/logger.js';
import { createAuditLog } from '../lib/audit.js';

export const paymentRoutes = new Hono();

// ============ AUTHENTICATED PAYMENT ROUTES ============

const authenticatedRoutes = new Hono();
authenticatedRoutes.use('*', authMiddleware);

const manualPaymentSchema = z.object({
    customerId: z.string().uuid(),
    amount: z.number().positive(),
    method: z.enum(['CASH', 'BANK_TRANSFER', 'CARD', 'OTHER']).optional(),
    description: z.string().optional(),
});

// GET /api/payments/electronic - List M-Pesa transactions
authenticatedRoutes.get('/electronic', requirePermission('payments:view_electronic'), async (c) => {
    const tenantId = c.get('tenantId');
    const page = parseInt(c.req.query('page') ?? '1');
    const pageSize = parseInt(c.req.query('pageSize') ?? '20');
    const status = c.req.query('status');
    const search = c.req.query('search');

    interface PaymentWhere {
        tenantId: string;
        method: string;
        status?: string;
        OR?: Array<{
            transactionId?: { contains: string; mode: 'insensitive' };
            phone?: { contains: string };
            account?: { contains: string; mode: 'insensitive' };
        }>;
    }

    const where: PaymentWhere = { tenantId, method: 'MPESA' };

    if (status) {
        where.status = status.toUpperCase();
    }

    if (search) {
        where.OR = [
            { transactionId: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
            { account: { contains: search, mode: 'insensitive' } },
        ];
    }

    const [transactions, total] = await Promise.all([
        prisma.payment.findMany({
            where: where as Parameters<typeof prisma.payment.findMany>[0]['where'],
            include: {
                customer: { select: { id: true, name: true, username: true } },
            },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.payment.count({ where: where as Parameters<typeof prisma.payment.count>[0]['where'] }),
    ]);

    return c.json({
        transactions: transactions.map((t) => ({
            id: t.id,
            transactionId: t.transactionId,
            amount: t.amount,
            phone: t.phone,
            account: t.account,
            status: t.status.toLowerCase(),
            customer: t.customer ? { id: t.customer.id, name: t.customer.name } : null,
            createdAt: t.createdAt,
        })),
        total,
        page,
        pageSize,
    });
});

// GET /api/payments/manual - List manual payments
authenticatedRoutes.get('/manual', requirePermission('payments:view_manual'), async (c) => {
    const tenantId = c.get('tenantId');
    const page = parseInt(c.req.query('page') ?? '1');
    const pageSize = parseInt(c.req.query('pageSize') ?? '20');

    const manualMethods = ['CASH', 'BANK_TRANSFER', 'CARD', 'OTHER'] as ('CASH' | 'BANK_TRANSFER' | 'CARD' | 'OTHER')[];

    const where = {
        tenantId,
        method: { in: manualMethods },
    };

    const [transactions, total] = await Promise.all([
        prisma.payment.findMany({
            where,
            include: {
                customer: { select: { id: true, name: true, username: true } },
            },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.payment.count({ where }),
    ]);

    return c.json({
        transactions: transactions.map((t) => ({
            id: t.id,
            amount: t.amount,
            method: t.method,
            description: t.description,
            customer: t.customer ? { id: t.customer.id, name: t.customer.name } : null,
            createdAt: t.createdAt,
        })),
        total,
        page,
        pageSize,
    });
});

// POST /api/payments/manual - Record manual payment
authenticatedRoutes.post('/manual', requirePermission('payments:view_manual'), async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const body = await c.req.json();
    const data = manualPaymentSchema.parse(body);

    // Verify customer exists
    const customer = await prisma.customer.findFirst({
        where: { id: data.customerId, tenantId, deletedAt: null },
    });

    if (!customer) {
        throw new AppError(404, 'Customer not found');
    }

    // Create payment and update customer wallet
    const [payment] = await prisma.$transaction([
        prisma.payment.create({
            data: {
                amount: data.amount,
                method: data.method ?? 'CASH',
                status: 'COMPLETED',
                description: data.description ?? 'Manual payment',
                customerId: customer.id,
                tenantId,
            },
        }),
        prisma.customer.update({
            where: { id: customer.id },
            data: {
                walletBalance: { increment: data.amount },
                totalSpent: { increment: data.amount },
            },
        }),
    ]);

    // Audit log
    await createAuditLog({
        action: 'PAYMENT_PROCESS',
        targetType: 'Payment',
        targetId: payment.id,
        targetName: customer.username,
        details: `Amount: KES ${data.amount}`,
        user,
    });

    return c.json(
        {
            id: payment.id,
            amount: payment.amount,
            method: payment.method,
            status: payment.status,
        },
        201
    );
});

// DELETE /api/payments/manual - Clear all manual payments (admin only)
authenticatedRoutes.delete('/manual', requirePermission('payments:view_manual'), async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');

    const manualMethods = ['CASH', 'BANK_TRANSFER', 'CARD', 'OTHER'] as ('CASH' | 'BANK_TRANSFER' | 'CARD' | 'OTHER')[];

    // Soft delete by updating status
    const result = await prisma.payment.updateMany({
        where: {
            tenantId,
            method: { in: manualMethods },
        },
        data: { status: 'REFUNDED' }, // Mark as refunded/cleared
    });

    return c.json({
        success: true,
        clearedCount: result.count,
    });
});

// Mount authenticated routes
paymentRoutes.route('/', authenticatedRoutes);

// ============ M-PESA WEBHOOK (No Auth - API Key Based) ============

const mpesaCallbackSchema = z.object({
    Body: z.object({
        stkCallback: z.object({
            MerchantRequestID: z.string(),
            CheckoutRequestID: z.string(),
            ResultCode: z.number(),
            ResultDesc: z.string(),
            CallbackMetadata: z.object({
                Item: z.array(z.object({
                    Name: z.string(),
                    Value: z.union([z.string(), z.number()]).optional(),
                })),
            }).optional(),
        }),
    }),
});

// POST /api/webhooks/mpesa - M-Pesa callback
paymentRoutes.post('/webhooks/mpesa', async (c) => {
    // Verify API key
    const apiKey = c.req.header('X-API-Key') ?? c.req.query('key');
    const expectedKey = process.env['MPESA_WEBHOOK_KEY'];

    if (!expectedKey) {
        logger.error('MPESA_WEBHOOK_KEY not configured');
        return c.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    if (apiKey !== expectedKey) {
        logger.warn({ apiKey }, 'Invalid M-Pesa webhook API key');
        return c.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    try {
        const rawBody = await c.req.json();
        logger.info({ body: rawBody }, 'M-Pesa callback received');

        const callback = mpesaCallbackSchema.parse(rawBody);
        const { stkCallback } = callback.Body;

        if (stkCallback.ResultCode !== 0) {
            logger.info({ resultCode: stkCallback.ResultCode }, 'M-Pesa payment failed');
            return c.json({ ResultCode: 0, ResultDesc: 'Accepted' });
        }

        // Extract callback metadata
        const metadata = stkCallback.CallbackMetadata?.Item ?? [];
        const getMetaValue = (name: string): string | number | undefined => {
            const item = metadata.find((m) => m.Name === name);
            return item?.Value;
        };

        const amount = Number(getMetaValue('Amount')) || 0;
        const mpesaReceiptNumber = String(getMetaValue('MpesaReceiptNumber') ?? '');
        const phone = String(getMetaValue('PhoneNumber') ?? '');

        // Check for duplicate transaction
        const existingPayment = await prisma.payment.findFirst({
            where: { transactionId: mpesaReceiptNumber },
        });

        if (existingPayment) {
            logger.info({ transactionId: mpesaReceiptNumber }, 'Duplicate M-Pesa transaction');
            return c.json({ ResultCode: 0, ResultDesc: 'Accepted' });
        }

        // Find customer by phone or account
        const customer = await prisma.customer.findFirst({
            where: {
                OR: [
                    { phone: { contains: phone.slice(-9) } },
                    { username: phone },
                ],
                deletedAt: null,
            },
            include: { tenant: true },
        });

        if (!customer) {
            logger.warn({ phone }, 'M-Pesa payment received but no customer found');
            // Still record the payment
            await prisma.payment.create({
                data: {
                    amount,
                    method: 'MPESA',
                    status: 'COMPLETED',
                    transactionId: mpesaReceiptNumber,
                    phone,
                    description: 'M-Pesa payment - customer not found',
                    tenantId: process.env['DEFAULT_TENANT_ID'] ?? '',
                },
            });
            return c.json({ ResultCode: 0, ResultDesc: 'Accepted' });
        }

        // Create payment and update customer wallet
        await prisma.$transaction([
            prisma.payment.create({
                data: {
                    amount,
                    method: 'MPESA',
                    status: 'COMPLETED',
                    transactionId: mpesaReceiptNumber,
                    phone,
                    account: customer.username,
                    customerId: customer.id,
                    tenantId: customer.tenantId,
                },
            }),
            prisma.customer.update({
                where: { id: customer.id },
                data: {
                    walletBalance: { increment: amount },
                    totalSpent: { increment: amount },
                },
            }),
        ]);

        logger.info({ customer: customer.username, amount }, 'M-Pesa payment processed successfully');
        return c.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    } catch (error) {
        logger.error({ error }, 'M-Pesa webhook processing error');
        return c.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }
});
