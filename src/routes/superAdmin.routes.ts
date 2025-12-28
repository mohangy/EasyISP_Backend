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
    const totalRouters = await prisma.nas.count();

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
