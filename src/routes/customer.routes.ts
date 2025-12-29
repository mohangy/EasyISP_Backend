import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { createAuditLog } from '../lib/audit.js';
import type { ConnectionType, CustomerStatus } from '@prisma/client';

export const customerRoutes = new Hono();

// Apply auth middleware to all routes
customerRoutes.use('*', authMiddleware);

// Validation schemas
const createCustomerSchema = z.object({
    username: z.string().min(3),
    password: z.string().min(4),
    name: z.string().min(2),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    connectionType: z.enum(['PPPOE', 'HOTSPOT', 'DHCP', 'STATIC']),
    packageId: z.string().uuid().optional(),
    nasId: z.string().uuid().optional(),
    expiresAt: z.string().datetime().optional(),
    location: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    apartmentNumber: z.string().optional(),
    houseNumber: z.string().optional(),
});

const updateCustomerSchema = createCustomerSchema.partial();

const rechargeSchema = z.object({
    amount: z.number().positive(),
    description: z.string().optional(),
});

const expirySchema = z.object({
    expiresAt: z.string().datetime(),
});

const packageChangeSchema = z.object({
    packageId: z.string().uuid(),
});

// GET /api/customers
customerRoutes.get('/', async (c) => {
    const tenantId = c.get('tenantId');
    const page = parseInt(c.req.query('page') ?? '1');
    const pageSize = parseInt(c.req.query('pageSize') ?? '20');
    const search = c.req.query('search');
    const status = c.req.query('status') as CustomerStatus | undefined;
    const type = c.req.query('type') as ConnectionType | undefined;

    const where: {
        tenantId: string;
        deletedAt: null;
        status?: CustomerStatus;
        connectionType?: ConnectionType;
        OR?: Array<{ username?: { contains: string; mode: 'insensitive' }; name?: { contains: string; mode: 'insensitive' }; phone?: { contains: string } }>;
    } = { tenantId, deletedAt: null };

    if (status) where.status = status;
    if (type) where.connectionType = type;
    if (search) {
        where.OR = [
            { username: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
        ];
    }

    const [customers, total] = await Promise.all([
        prisma.customer.findMany({
            where,
            include: {
                package: { select: { id: true, name: true, price: true } },
                nas: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.customer.count({ where }),
    ]);

    return c.json({
        customers: customers.map((customer) => ({
            id: customer.id,
            username: customer.username,
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            connectionType: customer.connectionType,
            status: customer.status,
            expiresAt: customer.expiresAt,
            package: customer.package,
            router: customer.nas,
            walletBalance: customer.walletBalance,
            createdAt: customer.createdAt,
        })),
        total,
        page,
        pageSize,
    });
});

// GET /api/customers/:id
customerRoutes.get('/:id', async (c) => {
    const tenantId = c.get('tenantId');
    const customerId = c.req.param('id');

    const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId, deletedAt: null },
        include: {
            package: true,
            nas: { select: { id: true, name: true, ipAddress: true } },
        },
    });

    if (!customer) {
        throw new AppError(404, 'Customer not found');
    }

    return c.json({
        id: customer.id,
        username: customer.username,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        connectionType: customer.connectionType,
        status: customer.status,
        expiresAt: customer.expiresAt,
        location: customer.location,
        latitude: customer.latitude,
        longitude: customer.longitude,
        apartmentNumber: customer.apartmentNumber,
        houseNumber: customer.houseNumber,
        lastIp: customer.lastIp,
        lastMac: customer.lastMac,
        walletBalance: customer.walletBalance,
        totalSpent: customer.totalSpent,
        package: customer.package,
        router: customer.nas,
        createdAt: customer.createdAt,
    });
});

// POST /api/customers
customerRoutes.post('/', async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const body = await c.req.json();
    const data = createCustomerSchema.parse(body);

    // Check username uniqueness within tenant
    const existing = await prisma.customer.findFirst({
        where: { username: data.username, tenantId, deletedAt: null },
    });
    if (existing) {
        throw new AppError(409, 'Username already exists');
    }

    // Set default expiry (30 days from now if not specified)
    const expiresAt = data.expiresAt ? new Date(data.expiresAt) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const customer = await prisma.customer.create({
        data: {
            username: data.username,
            password: data.password, // Plain text for RADIUS (consider hashing strategy)
            name: data.name,
            email: data.email,
            phone: data.phone,
            connectionType: data.connectionType as ConnectionType,
            packageId: data.packageId,
            nasId: data.nasId,
            expiresAt,
            location: data.location,
            latitude: data.latitude,
            longitude: data.longitude,
            apartmentNumber: data.apartmentNumber,
            houseNumber: data.houseNumber,
            tenantId,
        },
        include: {
            package: { select: { name: true } },
        },
    });

    // Audit log
    await createAuditLog({
        action: 'CUSTOMER_CREATE',
        targetType: 'Customer',
        targetId: customer.id,
        targetName: customer.username,
        user,
        ipAddress: c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip'),
    });

    return c.json(customer, 201);
});

// PUT /api/customers/:id
customerRoutes.put('/:id', async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const customerId = c.req.param('id');
    const body = await c.req.json();
    const data = updateCustomerSchema.parse(body);

    const existing = await prisma.customer.findFirst({
        where: { id: customerId, tenantId, deletedAt: null },
    });

    if (!existing) {
        throw new AppError(404, 'Customer not found');
    }

    // Check username uniqueness if changed
    if (data.username && data.username !== existing.username) {
        const usernameExists = await prisma.customer.findFirst({
            where: { username: data.username, tenantId, deletedAt: null, id: { not: customerId } },
        });
        if (usernameExists) {
            throw new AppError(409, 'Username already exists');
        }
    }

    const customer = await prisma.customer.update({
        where: { id: customerId },
        data: {
            ...data,
            expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
        },
    });

    // Audit log
    await createAuditLog({
        action: 'CUSTOMER_UPDATE',
        targetType: 'Customer',
        targetId: customer.id,
        targetName: customer.username,
        user,
    });

    return c.json(customer);
});

// DELETE /api/customers/:id
customerRoutes.delete('/:id', async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const customerId = c.req.param('id');

    const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId, deletedAt: null },
    });

    if (!customer) {
        throw new AppError(404, 'Customer not found');
    }

    // Soft delete
    await prisma.customer.update({
        where: { id: customerId },
        data: { deletedAt: new Date() },
    });

    // Audit log
    await createAuditLog({
        action: 'CUSTOMER_DELETE',
        targetType: 'Customer',
        targetId: customer.id,
        targetName: customer.username,
        user,
    });

    return c.json({ success: true });
});

// GET /api/customers/:id/live-status
customerRoutes.get('/:id/live-status', async (c) => {
    const tenantId = c.get('tenantId');
    const customerId = c.req.param('id');

    const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId, deletedAt: null },
    });

    if (!customer) {
        throw new AppError(404, 'Customer not found');
    }

    // Check for active session
    const activeSession = await prisma.session.findFirst({
        where: {
            customerId,
            stopTime: null,
        },
        orderBy: { startTime: 'desc' },
    });

    if (activeSession) {
        const uptimeSeconds = Math.floor((Date.now() - activeSession.startTime.getTime()) / 1000);
        const hours = Math.floor(uptimeSeconds / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        const seconds = uptimeSeconds % 60;

        return c.json({
            id: customer.id,
            isOnline: true,
            sessionUptime: `${hours}h ${minutes}m ${seconds}s`,
            ipAddress: activeSession.framedIp,
            macAddress: activeSession.macAddress,
        });
    }

    // Calculate last seen
    const lastSession = await prisma.session.findFirst({
        where: { customerId },
        orderBy: { stopTime: 'desc' },
    });

    let lastSeenAgo = 'Never';
    if (lastSession?.stopTime) {
        const diffMs = Date.now() - lastSession.stopTime.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 60) lastSeenAgo = `${diffMins}m ago`;
        else if (diffMins < 1440) lastSeenAgo = `${Math.floor(diffMins / 60)}h ago`;
        else lastSeenAgo = `${Math.floor(diffMins / 1440)}d ago`;
    }

    return c.json({
        id: customer.id,
        isOnline: false,
        lastSeenAgo,
    });
});

// POST /api/customers/:id/mac-reset
customerRoutes.post('/:id/mac-reset', async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const customerId = c.req.param('id');

    const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId, deletedAt: null },
    });

    if (!customer) {
        throw new AppError(404, 'Customer not found');
    }

    await prisma.customer.update({
        where: { id: customerId },
        data: { lastMac: null },
    });

    // Audit log
    await createAuditLog({
        action: 'MAC_RESET',
        targetType: 'Customer',
        targetId: customer.id,
        targetName: customer.username,
        user,
    });

    return c.json({ success: true, message: 'MAC address reset successfully' });
});

// POST /api/customers/:id/disconnect
customerRoutes.post('/:id/disconnect', async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const customerId = c.req.param('id');

    const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId, deletedAt: null },
        include: { nas: true },
    });

    if (!customer) {
        throw new AppError(404, 'Customer not found');
    }

    // TODO: Send CoA disconnect to RADIUS/MikroTik
    // For now, just close active sessions in database
    await prisma.session.updateMany({
        where: { customerId, stopTime: null },
        data: { stopTime: new Date(), terminateCause: 'Admin-Disconnect' },
    });

    // Audit log
    await createAuditLog({
        action: 'CUSTOMER_DISCONNECT',
        targetType: 'Customer',
        targetId: customer.id,
        targetName: customer.username,
        user,
    });

    return c.json({ success: true, message: 'Customer disconnected' });
});

// POST /api/customers/:id/recharge
customerRoutes.post('/:id/recharge', async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const customerId = c.req.param('id');
    const body = await c.req.json();
    const { amount, description } = rechargeSchema.parse(body);

    const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId, deletedAt: null },
    });

    if (!customer) {
        throw new AppError(404, 'Customer not found');
    }

    // Update wallet and create payment record
    const [updatedCustomer, payment] = await prisma.$transaction([
        prisma.customer.update({
            where: { id: customerId },
            data: {
                walletBalance: { increment: amount },
                totalSpent: { increment: amount },
            },
        }),
        prisma.payment.create({
            data: {
                amount,
                method: 'CASH',
                status: 'COMPLETED',
                description: description ?? 'Manual recharge',
                customerId,
                tenantId,
            },
        }),
    ]);

    // Audit log
    await createAuditLog({
        action: 'MANUAL_RECHARGE',
        targetType: 'Customer',
        targetId: customer.id,
        targetName: customer.username,
        details: `Amount: KES ${amount}`,
        user,
    });

    return c.json({
        success: true,
        newBalance: updatedCustomer.walletBalance,
        paymentId: payment.id,
    });
});

// PUT /api/customers/:id/expiry
customerRoutes.put('/:id/expiry', async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const customerId = c.req.param('id');
    const body = await c.req.json();
    const { expiresAt } = expirySchema.parse(body);

    const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId, deletedAt: null },
    });

    if (!customer) {
        throw new AppError(404, 'Customer not found');
    }

    await prisma.customer.update({
        where: { id: customerId },
        data: { expiresAt: new Date(expiresAt) },
    });

    // Audit log
    await createAuditLog({
        action: 'EXPIRY_UPDATE',
        targetType: 'Customer',
        targetId: customer.id,
        targetName: customer.username,
        details: `New expiry: ${expiresAt}`,
        user,
    });

    return c.json({ success: true, expiresAt });
});

// PUT /api/customers/:id/package
customerRoutes.put('/:id/package', async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const customerId = c.req.param('id');
    const body = await c.req.json();
    const { packageId } = packageChangeSchema.parse(body);

    const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId, deletedAt: null },
        include: { package: { select: { name: true } } },
    });

    if (!customer) {
        throw new AppError(404, 'Customer not found');
    }

    // Verify package exists and belongs to tenant
    const newPackage = await prisma.package.findFirst({
        where: { id: packageId, tenantId },
    });

    if (!newPackage) {
        throw new AppError(404, 'Package not found');
    }

    await prisma.customer.update({
        where: { id: customerId },
        data: { packageId },
    });

    // Audit log
    await createAuditLog({
        action: 'PACKAGE_CHANGE',
        targetType: 'Customer',
        targetId: customer.id,
        targetName: customer.username,
        details: `${customer.package?.name ?? 'None'} → ${newPackage.name}`,
        user,
    });

    return c.json({ success: true, package: newPackage });
});

// POST /api/customers/:id/suspend
customerRoutes.post('/:id/suspend', async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const customerId = c.req.param('id');

    const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId, deletedAt: null },
    });

    if (!customer) {
        throw new AppError(404, 'Customer not found');
    }

    await prisma.customer.update({
        where: { id: customerId },
        data: { status: 'SUSPENDED' },
    });

    // Audit log
    await createAuditLog({
        action: 'CUSTOMER_SUSPEND',
        targetType: 'Customer',
        targetId: customer.id,
        targetName: customer.username,
        user,
    });

    return c.json({ success: true, message: 'Customer suspended' });
});

// POST /api/customers/:id/activate
customerRoutes.post('/:id/activate', async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const customerId = c.req.param('id');

    const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId, deletedAt: null },
    });

    if (!customer) {
        throw new AppError(404, 'Customer not found');
    }

    await prisma.customer.update({
        where: { id: customerId },
        data: { status: 'ACTIVE' },
    });

    // Audit log
    await createAuditLog({
        action: 'CUSTOMER_ACTIVATE',
        targetType: 'Customer',
        targetId: customer.id,
        targetName: customer.username,
        user,
    });

    return c.json({ success: true, message: 'Customer activated' });
});

// GET /api/customers/:id/transactions - Get customer transactions/payment history
customerRoutes.get('/:id/transactions', async (c) => {
    const tenantId = c.get('tenantId');
    const customerId = c.req.param('id');

    const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId, deletedAt: null },
    });

    if (!customer) {
        throw new AppError(404, 'Customer not found');
    }

    // Get all payments for this customer
    const payments = await prisma.payment.findMany({
        where: { customerId, tenantId },
        orderBy: { createdAt: 'desc' },
        take: 100,
    });

    // Format response for frontend
    const mpesaTransactions = payments
        .filter(p => p.method === 'MPESA')
        .map(p => ({
            id: p.id,
            trxDate: p.createdAt.toISOString(),
            trxCode: p.transactionId || p.id.slice(0, 10).toUpperCase(),
            paybill: '888880', // Could be from tenant settings
            amount: p.amount,
            phone: p.phone || customer.phone || '',
        }));

    const manualTransactions = payments
        .filter(p => p.method !== 'MPESA')
        .map(p => ({
            id: p.id,
            yourRef: p.transactionId || p.description || 'Manual Recharge',
            amount: p.amount,
            trxDate: p.createdAt.toISOString(),
        }));

    return c.json({
        mpesaTransactions,
        manualTransactions,
    });
});
