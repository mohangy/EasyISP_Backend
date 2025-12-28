import type { Context, Next } from 'hono';
import { prisma } from '../lib/prisma.js';
import { AppError } from './errorHandler.js';
import { logger } from '../lib/logger.js';

/**
 * Middleware to check if tenant's trial/subscription is valid
 * Blocks access if trial expired and not activated
 */
export const checkTenantStatus = async (c: Context, next: Next) => {
    const tenantId = c.get('tenantId');

    if (!tenantId) {
        throw new AppError(401, 'Tenant ID required');
    }

    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
            id: true,
            status: true,
            isActivated: true,
            trialEndsAt: true,
            subscriptionEndsAt: true,
        },
    });

    if (!tenant) {
        throw new AppError(404, 'Tenant not found');
    }

    const now = new Date();

    // Check if tenant is suspended or expired
    if (tenant.status === 'SUSPENDED') {
        throw new AppError(403, 'Your account has been suspended. Please contact support.');
    }

    if (tenant.status === 'EXPIRED') {
        throw new AppError(403, 'Your account has expired. Please contact support to reactivate.');
    }

    // If tenant is activated and has a valid subscription, allow access
    if (tenant.isActivated && tenant.subscriptionEndsAt && tenant.subscriptionEndsAt > now) {
        return next();
    }

    // If tenant is activated but no subscription end date, they have unlimited access
    if (tenant.isActivated && !tenant.subscriptionEndsAt) {
        return next();
    }

    // Check trial period for non-activated or trial accounts
    if (tenant.status === 'TRIAL') {
        if (!tenant.trialEndsAt) {
            // No trial end date set, deny access
            throw new AppError(403, 'Trial period not configured. Please contact support.');
        }

        if (tenant.trialEndsAt < now) {
            // Trial has expired
            // Auto-update status to EXPIRED
            await prisma.tenant.update({
                where: { id: tenant.id },
                data: { status: 'EXPIRED' },
            });

            logger.info({ tenantId: tenant.id }, 'Trial expired, tenant status updated to EXPIRED');

            throw new AppError(403, 'Your trial period has expired. Please contact us to activate your account.');
        }

        // Trial is still valid
        return next();
    }

    // If we reach here, account is in an invalid state
    throw new AppError(403, 'Your account is not properly configured. Please contact support.');
};

/**
 * Helper function to check if tenant can authenticate customers (for RADIUS)
 * Returns { allowed: boolean, reason?: string }
 */
export async function checkTenantCanAuthenticate(tenantId: string): Promise<{
    allowed: boolean;
    reason?: string;
}> {
    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
            status: true,
            isActivated: true,
            trialEndsAt: true,
            subscriptionEndsAt: true,
        },
    });

    if (!tenant) {
        return { allowed: false, reason: 'Tenant not found' };
    }

    // Check if suspended or expired
    if (tenant.status === 'SUSPENDED') {
        return { allowed: false, reason: 'Account suspended' };
    }

    if (tenant.status === 'EXPIRED') {
        return { allowed: false, reason: 'Account expired' };
    }

    const now = new Date();

    // If activated with valid subscription, allow
    if (tenant.isActivated && tenant.subscriptionEndsAt && tenant.subscriptionEndsAt > now) {
        return { allowed: true };
    }

    // If activated without subscription end date (lifetime), allow
    if (tenant.isActivated && !tenant.subscriptionEndsAt) {
        return { allowed: true };
    }

    // Check trial
    if (tenant.status === 'TRIAL') {
        if (!tenant.trialEndsAt || tenant.trialEndsAt < now) {
            // Auto-update to expired
            await prisma.tenant.update({
                where: { id: tenantId },
                data: { status: 'EXPIRED' },
            });
            return { allowed: false, reason: 'Trial expired' };
        }

        return { allowed: true };
    }

    return { allowed: false, reason: 'Account not properly configured' };
}
