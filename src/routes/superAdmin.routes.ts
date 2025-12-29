import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../lib/logger.js';

export const superAdminRoutes = new Hono();

// Validation schemas
const activateTenantSchema = z.object({
    subscriptionMonths: z.number().min(1).max(120).optional(), // Optional: months of subscription
});

// ============ SUPER ADMIN ONLY ROUTES ============
// These routes are for the SaaS owner to manage all tenants

/**
 * Middleware to ensure user is the SaaS super admin
 * This checks for a special environment variable or specific user ID
 */
const requireSaaSOwner = async (c: any, next: any) => {
    const user = c.get('user');

    if (!user) {
        throw new AppError(401, 'Authentication required');
    }

    // Check if user is SaaS owner (you can customize this logic)
    const saasOwnerEmail = process.env.SAAS_OWNER_EMAIL || 'owner@easyisp.com';

    if (user.email !== saasOwnerEmail) {
        throw new AppError(403, 'Access denied. SaaS owner privileges required.');
    }

    return next();
};

// GET /api/super-admin/tenants - List all tenants with trial/subscription info
superAdminRoutes.get('/tenants', authMiddleware, requireSaaSOwner, async (c) => {
    const tenants = await prisma.tenant.findMany({
        select: {
            id: true,
            name: true,
            businessName: true,
            email: true,
            phone: true,
            status: true,
            isActivated: true,
            trialEndsAt: true,
            subscriptionEndsAt: true,
            createdAt: true,
            _count: {
                select: {
                    users: true,
                    customers: true,
                    routers: true,
                },
            },
        },
        orderBy: { createdAt: 'desc' },
    });

    const now = new Date();

    const tenantsWithStatus = tenants.map(tenant => {
        let subscriptionStatus = 'active';
        let daysRemaining = null;

        if (tenant.status === 'TRIAL' && tenant.trialEndsAt) {
            const msRemaining = tenant.trialEndsAt.getTime() - now.getTime();
            daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
            subscriptionStatus = daysRemaining > 0 ? 'trial' : 'expired';
        } else if (tenant.status === 'EXPIRED') {
            subscriptionStatus = 'expired';
        } else if (tenant.status === 'SUSPENDED') {
            subscriptionStatus = 'suspended';
        } else if (tenant.isActivated && tenant.subscriptionEndsAt) {
            const msRemaining = tenant.subscriptionEndsAt.getTime() - now.getTime();
            daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
            subscriptionStatus = daysRemaining > 0 ? 'subscribed' : 'expired';
        } else if (tenant.isActivated) {
            subscriptionStatus = 'lifetime';
        }

        return {
            ...tenant,
            subscriptionStatus,
            daysRemaining,
        };
    });

    return c.json({ tenants: tenantsWithStatus });
});

// GET /api/super-admin/tenants/:id - Get detailed tenant info
superAdminRoutes.get('/tenants/:id', authMiddleware, requireSaaSOwner, async (c) => {
    const id = c.req.param('id');

    const tenant = await prisma.tenant.findUnique({
        where: { id },
        include: {
            users: {
                select: {
                    id: true,
                    email: true,
                    name: true,
                    role: true,
                    status: true,
                    createdAt: true,
                },
            },
            _count: {
                select: {
                    customers: true,
                    packages: true,
                    routers: true,
                    payments: true,
                },
            },
        },
    });

    if (!tenant) {
        throw new AppError(404, 'Tenant not found');
    }

    return c.json({ tenant });
});

// POST /api/super-admin/tenants/:id/activate - Activate a tenant
superAdminRoutes.post('/tenants/:id/activate', authMiddleware, requireSaaSOwner, async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const { subscriptionMonths } = activateTenantSchema.parse(body);

    const tenant = await prisma.tenant.findUnique({ where: { id } });

    if (!tenant) {
        throw new AppError(404, 'Tenant not found');
    }

    // Calculate subscription end date if specified
    let subscriptionEndsAt = null;
    if (subscriptionMonths) {
        subscriptionEndsAt = new Date();
        subscriptionEndsAt.setMonth(subscriptionEndsAt.getMonth() + subscriptionMonths);
    }

    const updatedTenant = await prisma.tenant.update({
        where: { id },
        data: {
            isActivated: true,
            status: 'ACTIVE',
            subscriptionEndsAt,
        },
    });

    logger.info({ tenantId: id, subscriptionMonths }, 'Tenant activated by SaaS owner');

    return c.json({
        message: 'Tenant activated successfully',
        tenant: updatedTenant,
    });
});

// POST /api/super-admin/tenants/:id/suspend - Suspend a tenant
superAdminRoutes.post('/tenants/:id/suspend', authMiddleware, requireSaaSOwner, async (c) => {
    const id = c.req.param('id');

    const updatedTenant = await prisma.tenant.update({
        where: { id },
        data: { status: 'SUSPENDED' },
    });

    logger.warn({ tenantId: id }, 'Tenant suspended by SaaS owner');

    return c.json({
        message: 'Tenant suspended successfully',
        tenant: updatedTenant,
    });
});

// POST /api/super-admin/tenants/:id/reactivate - Reactivate a suspended tenant
superAdminRoutes.post('/tenants/:id/reactivate', authMiddleware, requireSaaSOwner, async (c) => {
    const id = c.req.param('id');

    const tenant = await prisma.tenant.findUnique({ where: { id } });

    if (!tenant) {
        throw new AppError(404, 'Tenant not found');
    }

    // Determine new status based on activation and trial/subscription
    let newStatus: 'ACTIVE' | 'TRIAL' = 'ACTIVE';
    if (!tenant.isActivated && tenant.trialEndsAt) {
        const now = new Date();
        if (tenant.trialEndsAt > now) {
            newStatus = 'TRIAL';
        }
    }

    const updatedTenant = await prisma.tenant.update({
        where: { id },
        data: { status: newStatus },
    });

    logger.info({ tenantId: id }, 'Tenant reactivated by SaaS owner');

    return c.json({
        message: 'Tenant reactivated successfully',
        tenant: updatedTenant,
    });
});

// POST /api/super-admin/tenants/:id/extend-trial - Extend trial period
superAdminRoutes.post('/tenants/:id/extend-trial', authMiddleware, requireSaaSOwner, async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const { days } = z.object({ days: z.number().min(1).max(365) }).parse(body);

    const tenant = await prisma.tenant.findUnique({ where: { id } });

    if (!tenant) {
        throw new AppError(404, 'Tenant not found');
    }

    // Calculate new trial end date
    const newTrialEnd = tenant.trialEndsAt ? new Date(tenant.trialEndsAt) : new Date();
    newTrialEnd.setDate(newTrialEnd.getDate() + days);

    const updatedTenant = await prisma.tenant.update({
        where: { id },
        data: {
            trialEndsAt: newTrialEnd,
            status: 'TRIAL',
        },
    });

    logger.info({ tenantId: id, extensionDays: days }, 'Trial period extended by SaaS owner');

    return c.json({
        message: `Trial extended by ${days} days`,
        tenant: updatedTenant,
    });
});

// GET /api/super-admin/stats - Get overall SaaS statistics
superAdminRoutes.get('/stats', authMiddleware, requireSaaSOwner, async (c) => {
    const now = new Date();

    const [totalTenants, activeTenants, trialTenants, expiredTenants, suspendedTenants] = await Promise.all([
        prisma.tenant.count(),
        prisma.tenant.count({ where: { status: 'ACTIVE', isActivated: true } }),
        prisma.tenant.count({
            where: {
                status: 'TRIAL',
                trialEndsAt: { gt: now },
            },
        }),
        prisma.tenant.count({ where: { status: 'EXPIRED' } }),
        prisma.tenant.count({ where: { status: 'SUSPENDED' } }),
    ]);

    const totalCustomers = await prisma.customer.count();
    const totalUsers = await prisma.user.count();
    const totalRouters = await prisma.nAS.count();

    return c.json({
        stats: {
            tenants: {
                total: totalTenants,
                active: activeTenants,
                trial: trialTenants,
                expired: expiredTenants,
                suspended: suspendedTenants,
            },
            totalCustomers,
            totalUsers,
            totalRouters,
        },
    });
});

// POST /api/super-admin/tenants/:id/extend-subscription - Extend subscription period
superAdminRoutes.post('/tenants/:id/extend-subscription', authMiddleware, requireSaaSOwner, async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();

    // Accept either months or a specific date
    const schema = z.object({
        months: z.number().min(1).max(120).optional(),
        subscriptionEndsAt: z.string().datetime().optional(),
    }).refine(data => data.months || data.subscriptionEndsAt, {
        message: "Either months or subscriptionEndsAt must be provided"
    });

    const { months, subscriptionEndsAt } = schema.parse(body);

    const tenant = await prisma.tenant.findUnique({ where: { id } });

    if (!tenant) {
        throw new AppError(404, 'Tenant not found');
    }

    // Calculate new subscription end date
    let newEndDate: Date;
    if (subscriptionEndsAt) {
        newEndDate = new Date(subscriptionEndsAt);
    } else {
        const currentEnd = tenant.subscriptionEndsAt ? new Date(tenant.subscriptionEndsAt) : new Date();
        currentEnd.setMonth(currentEnd.getMonth() + months!);
        newEndDate = currentEnd;
    }

    const updatedTenant = await prisma.tenant.update({
        where: { id },
        data: {
            subscriptionEndsAt: newEndDate,
            status: 'ACTIVE',
            isActivated: true,
        },
    });

    logger.info({ tenantId: id, newEndDate }, 'Subscription extended by SaaS owner');

    return c.json({
        message: `Subscription extended until ${newEndDate.toLocaleDateString()}`,
        tenant: updatedTenant,
    });
});

// POST /api/super-admin/tenants/:id/add-balance - Add wallet balance
superAdminRoutes.post('/tenants/:id/add-balance', authMiddleware, requireSaaSOwner, async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const { amount, type } = z.object({
        amount: z.number().min(0),
        type: z.enum(['wallet', 'sms'])
    }).parse(body);

    const tenant = await prisma.tenant.findUnique({ where: { id } });

    if (!tenant) {
        throw new AppError(404, 'Tenant not found');
    }

    const updateData = type === 'wallet'
        ? { walletBalance: tenant.walletBalance + amount }
        : { smsBalance: tenant.smsBalance + amount };

    const updatedTenant = await prisma.tenant.update({
        where: { id },
        data: updateData,
    });

    logger.info({ tenantId: id, amount, type }, 'Balance added by SaaS owner');

    return c.json({
        message: `Added ${amount} to ${type} balance`,
        tenant: updatedTenant,
    });
});

// PUT /api/super-admin/tenants/:id/settings - Update tenant settings
superAdminRoutes.put('/tenants/:id/settings', authMiddleware, requireSaaSOwner, async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();

    const settingsSchema = z.object({
        businessName: z.string().min(1).optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        location: z.string().optional(),
        logo: z.string().optional(),
        primaryColor: z.string().optional(),
        // SMS Settings
        smsProvider: z.string().optional(),
        smsApiKey: z.string().optional(),
        smsSenderId: z.string().optional(),
    });

    const validatedData = settingsSchema.parse(body);

    const tenant = await prisma.tenant.findUnique({ where: { id } });

    if (!tenant) {
        throw new AppError(404, 'Tenant not found');
    }

    const updatedTenant = await prisma.tenant.update({
        where: { id },
        data: validatedData,
    });

    logger.info({ tenantId: id }, 'Tenant settings updated by SaaS owner');

    return c.json({
        message: 'Settings updated successfully',
        tenant: updatedTenant,
    });
});

// DELETE /api/super-admin/tenants/:id - Delete tenant and all related data
superAdminRoutes.delete('/tenants/:id', authMiddleware, requireSaaSOwner, async (c) => {
    const id = c.req.param('id');

    const tenant = await prisma.tenant.findUnique({
        where: { id },
        include: { _count: { select: { customers: true, users: true } } }
    });

    if (!tenant) {
        throw new AppError(404, 'Tenant not found');
    }

    // Delete all related data in a transaction
    await prisma.$transaction(async (tx) => {
        // Delete in order of dependencies
        await tx.auditLog.deleteMany({ where: { tenantId: id } });
        await tx.sMSLog.deleteMany({ where: { tenantId: id } });
        await tx.vPNPeer.deleteMany({ where: { tenantId: id } });
        await tx.voucher.deleteMany({ where: { tenantId: id } });
        await tx.payment.deleteMany({ where: { tenantId: id } });
        await tx.expense.deleteMany({ where: { tenantId: id } });
        await tx.invoice.deleteMany({ where: { tenantId: id } });
        await tx.chartOfAccount.deleteMany({ where: { tenantId: id } });
        await tx.customer.deleteMany({ where: { tenantId: id } });
        await tx.package.deleteMany({ where: { tenantId: id } });
        await tx.nAS.deleteMany({ where: { tenantId: id } });
        await tx.user.deleteMany({ where: { tenantId: id } });
        await tx.tenant.delete({ where: { id } });
    });

    logger.warn({ tenantId: id, businessName: tenant.businessName }, 'Tenant deleted by SaaS owner');

    return c.json({
        message: 'Tenant and all related data deleted successfully',
    });
});

// POST /api/super-admin/tenants/:id/reset-user-password - Reset a user's password
superAdminRoutes.post('/tenants/:id/reset-user-password', authMiddleware, requireSaaSOwner, async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const { userId, newPassword } = z.object({
        userId: z.string().uuid(),
        newPassword: z.string().min(6),
    }).parse(body);

    const bcryptModule = await import('bcryptjs');
    const bcrypt = bcryptModule.default || bcryptModule;

    const user = await prisma.user.findFirst({
        where: { id: userId, tenantId: id },
    });

    if (!user) {
        throw new AppError(404, 'User not found');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword },
    });

    logger.info({ tenantId: id, userId }, 'User password reset by SaaS owner');

    return c.json({
        message: 'Password reset successfully',
    });
});

