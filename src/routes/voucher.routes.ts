import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { createAuditLog } from '../lib/audit.js';
import { randomBytes } from 'crypto';

export const voucherRoutes = new Hono();

// Apply auth middleware to all routes
voucherRoutes.use('*', authMiddleware);

// Validation schemas
const generateVouchersSchema = z.object({
    packageId: z.string().uuid(),
    quantity: z.number().int().min(1).max(500),
    prefix: z.string().max(10).optional(),
    codeLength: z.number().int().min(6).max(16).optional().default(8),
});

// GET /api/vouchers
voucherRoutes.get('/', async (c) => {
    const tenantId = c.get('tenantId');
    const page = parseInt(c.req.query('page') ?? '1');
    const pageSize = parseInt(c.req.query('pageSize') ?? '20');
    const status = c.req.query('status');
    const packageId = c.req.query('packageId');
    const search = c.req.query('search');

    interface VoucherWhere {
        tenantId: string;
        status?: string;
        packageId?: string;
        code?: { contains: string; mode: 'insensitive' };
    }

    const where: VoucherWhere = { tenantId };

    if (status) where.status = status.toUpperCase();
    if (packageId) where.packageId = packageId;
    if (search) where.code = { contains: search, mode: 'insensitive' };

    const [vouchers, total, stats] = await Promise.all([
        prisma.voucher.findMany({
            where: where as Parameters<typeof prisma.voucher.findMany>[0]['where'],
            include: {
                package: { select: { id: true, name: true, price: true } },
                customer: { select: { id: true, name: true, username: true } },
            },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.voucher.count({ where: where as Parameters<typeof prisma.voucher.count>[0]['where'] }),
        prisma.voucher.groupBy({
            by: ['status'],
            where: { tenantId },
            _count: true,
        }),
    ]);

    // Calculate stats
    const statusCounts: Record<string, number> = {};
    stats.forEach((s) => {
        statusCounts[s.status.toLowerCase()] = s._count;
    });

    return c.json({
        vouchers: vouchers.map((v) => ({
            id: v.id,
            code: v.code,
            status: v.status.toLowerCase(),
            package: v.package,
            usedBy: v.customer ? { id: v.customer.id, name: v.customer.name } : null,
            usedAt: v.usedAt,
            expiresAt: v.expiresAt,
            createdAt: v.createdAt,
        })),
        stats: {
            total,
            available: statusCounts['available'] ?? 0,
            used: statusCounts['used'] ?? 0,
            expired: statusCounts['expired'] ?? 0,
            revoked: statusCounts['revoked'] ?? 0,
        },
        total,
        page,
        pageSize,
    });
});

// POST /api/vouchers - Generate batch
voucherRoutes.post('/', async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const body = await c.req.json();
    const data = generateVouchersSchema.parse(body);

    // Verify package exists
    const pkg = await prisma.package.findFirst({
        where: { id: data.packageId, tenantId },
    });
    if (!pkg) {
        throw new AppError(404, 'Package not found');
    }

    // Generate unique codes
    const codes: string[] = [];
    const existingCodes = new Set<string>();

    // Get existing codes to avoid duplicates
    const existing = await prisma.voucher.findMany({
        where: { tenantId },
        select: { code: true },
    });
    existing.forEach((v) => existingCodes.add(v.code));

    // Generate codes
    const prefix = data.prefix ?? '';
    const codeLength = data.codeLength ?? 8;

    while (codes.length < data.quantity) {
        const randomPart = randomBytes(Math.ceil(codeLength / 2))
            .toString('hex')
            .toUpperCase()
            .slice(0, codeLength);
        const code = `${prefix}${randomPart}`;

        if (!existingCodes.has(code)) {
            codes.push(code);
            existingCodes.add(code);
        }
    }

    // Create vouchers in batch
    await prisma.voucher.createMany({
        data: codes.map((code) => ({
            code,
            packageId: data.packageId,
            tenantId,
            status: 'AVAILABLE',
        })),
    });

    // Audit log
    await createAuditLog({
        action: 'VOUCHER_GENERATE',
        targetType: 'Voucher',
        targetName: `${data.quantity} vouchers`,
        details: `Package: ${pkg.name}`,
        user,
    });

    return c.json(
        {
            success: true,
            count: codes.length,
            codes: codes.slice(0, 50), // Return first 50 codes
            package: { id: pkg.id, name: pkg.name, price: pkg.price },
        },
        201
    );
});

// DELETE /api/vouchers/:id - Revoke voucher
voucherRoutes.delete('/:id', async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const voucherId = c.req.param('id');

    const voucher = await prisma.voucher.findFirst({
        where: { id: voucherId, tenantId },
    });

    if (!voucher) {
        throw new AppError(404, 'Voucher not found');
    }

    if (voucher.status === 'USED') {
        throw new AppError(400, 'Cannot revoke a used voucher');
    }

    await prisma.voucher.update({
        where: { id: voucherId },
        data: { status: 'REVOKED' },
    });

    // Audit log
    await createAuditLog({
        action: 'VOUCHER_DELETE',
        targetType: 'Voucher',
        targetId: voucher.id,
        targetName: voucher.code,
        user,
    });

    return c.json({ success: true });
});

// POST /api/vouchers/redeem - Redeem a voucher (public endpoint for portal)
voucherRoutes.post('/redeem', async (c) => {
    const body = await c.req.json();
    const { code, customerId } = body;

    if (!code) {
        throw new AppError(400, 'Voucher code is required');
    }

    const voucher = await prisma.voucher.findFirst({
        where: { code: code.toUpperCase(), status: 'AVAILABLE' },
        include: { package: true },
    });

    if (!voucher) {
        throw new AppError(404, 'Invalid or unavailable voucher');
    }

    // Check expiry
    if (voucher.expiresAt && voucher.expiresAt < new Date()) {
        await prisma.voucher.update({
            where: { id: voucher.id },
            data: { status: 'EXPIRED' },
        });
        throw new AppError(400, 'Voucher has expired');
    }

    // Update voucher and customer
    const [updatedVoucher] = await prisma.$transaction([
        prisma.voucher.update({
            where: { id: voucher.id },
            data: {
                status: 'USED',
                usedAt: new Date(),
                usedById: customerId,
            },
        }),
        ...(customerId
            ? [
                prisma.customer.update({
                    where: { id: customerId },
                    data: {
                        packageId: voucher.packageId,
                        status: 'ACTIVE',
                        expiresAt: new Date(
                            Date.now() +
                            (voucher.package.sessionTime ?? 30 * 24 * 60) * 60 * 1000
                        ),
                    },
                }),
            ]
            : []),
    ]);

    return c.json({
        success: true,
        package: voucher.package,
        validFor: voucher.package.sessionTime
            ? `${voucher.package.sessionTime} minutes`
            : '30 days',
    });
});
