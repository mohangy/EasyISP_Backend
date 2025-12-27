import type { Context, Next } from 'hono';
import { verify } from 'jsonwebtoken';
import { config } from '../lib/config.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from './errorHandler.js';

export interface AuthUser {
    id: string;
    email: string;
    name: string;
    role: string;
    tenantId: string;
    addedPermissions: string[];
    removedPermissions: string[];
}

declare module 'hono' {
    interface ContextVariableMap {
        user: AuthUser;
        tenantId: string;
    }
}

export const authMiddleware = async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new AppError(401, 'Missing or invalid authorization header');
    }

    const token = authHeader.substring(7);

    try {
        const decoded = verify(token, config.jwtSecret) as {
            userId: string;
            tenantId: string;
        };

        // Fetch user from database
        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                tenantId: true,
                addedPermissions: true,
                removedPermissions: true,
                status: true,
            },
        });

        if (!user) {
            throw new AppError(401, 'User not found');
        }

        if (user.status !== 'ACTIVE') {
            throw new AppError(403, 'Account is suspended or inactive');
        }

        // Set user in context
        c.set('user', {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            tenantId: user.tenantId,
            addedPermissions: user.addedPermissions,
            removedPermissions: user.removedPermissions,
        });
        c.set('tenantId', user.tenantId);

        await next();
    } catch (error) {
        if (error instanceof AppError) {
            throw error;
        }
        throw new AppError(401, 'Invalid or expired token');
    }
};

// Permission check middleware factory
export const requirePermission = (permission: string) => {
    return async (c: Context, next: Next) => {
        const user = c.get('user');

        if (!user) {
            throw new AppError(401, 'Authentication required');
        }

        // Super admins have all permissions
        if (user.role === 'SUPER_ADMIN') {
            return next();
        }

        // Check if permission is in removed permissions
        if (user.removedPermissions.includes(permission)) {
            throw new AppError(403, 'Permission denied');
        }

        // Check if permission is in added permissions or default role permissions
        const hasPermission = user.addedPermissions.includes(permission);
        // TODO: Add role-based default permissions check

        if (!hasPermission && user.role !== 'ADMIN') {
            throw new AppError(403, 'Permission denied');
        }

        return next();
    };
};

// Role check middleware factory
export const requireRole = (...roles: string[]) => {
    return async (c: Context, next: Next) => {
        const user = c.get('user');

        if (!user) {
            throw new AppError(401, 'Authentication required');
        }

        if (!roles.includes(user.role)) {
            throw new AppError(403, 'Insufficient role privileges');
        }

        return next();
    };
};
