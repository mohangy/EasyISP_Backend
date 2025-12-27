import { Hono } from 'hono';
import { z } from 'zod';
import { hash, compare } from 'bcryptjs';
import { sign } from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { config } from '../lib/config.js';
import { authMiddleware } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

export const authRoutes = new Hono();

// Validation schemas
const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
});

const registerSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
    businessName: z.string().min(2),
    phone: z.string().optional(),
});

const changePasswordSchema = z.object({
    oldPassword: z.string().min(6),
    newPassword: z.string().min(6),
});

// POST /api/auth/login
authRoutes.post('/login', async (c) => {
    const body = await c.req.json();
    const { email, password } = loginSchema.parse(body);

    const user = await prisma.user.findUnique({
        where: { email },
        include: { tenant: true },
    });

    if (!user) {
        throw new AppError(401, 'Invalid email or password');
    }

    const isValidPassword = await compare(password, user.password);
    if (!isValidPassword) {
        throw new AppError(401, 'Invalid email or password');
    }

    if (user.status !== 'ACTIVE') {
        throw new AppError(403, 'Account is suspended or inactive');
    }

    if (user.tenant.status !== 'ACTIVE' && user.tenant.status !== 'TRIAL') {
        throw new AppError(403, 'Tenant account is suspended or expired');
    }

    const token = sign(
        { userId: user.id, tenantId: user.tenantId },
        config.jwtSecret,
        { expiresIn: 60 * 60 * 24 * 7 } // 7 days in seconds
    );

    return c.json({
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            tenantId: user.tenantId,
            addedPermissions: user.addedPermissions,
            removedPermissions: user.removedPermissions,
        },
        token,
    });
});

// POST /api/auth/register
authRoutes.post('/register', async (c) => {
    const body = await c.req.json();
    const { name, email, password, businessName, phone } = registerSchema.parse(body);

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
        throw new AppError(409, 'Email already registered');
    }

    const hashedPassword = await hash(password, 12);

    // Create tenant and admin user in a transaction
    const result = await prisma.$transaction(async (tx) => {
        // Create tenant
        const tenant = await tx.tenant.create({
            data: {
                name: businessName.toLowerCase().replace(/\s+/g, '-'),
                businessName,
                email,
                phone,
                status: 'TRIAL',
            },
        });

        // Create admin user
        const user = await tx.user.create({
            data: {
                email,
                password: hashedPassword,
                name,
                role: 'ADMIN',
                tenantId: tenant.id,
            },
        });

        return { tenant, user };
    });

    const token = sign(
        { userId: result.user.id, tenantId: result.tenant.id },
        config.jwtSecret,
        { expiresIn: 60 * 60 * 24 * 7 } // 7 days in seconds
    );

    return c.json(
        {
            user: {
                id: result.user.id,
                name: result.user.name,
                email: result.user.email,
                role: result.user.role,
                tenantId: result.tenant.id,
            },
            token,
        },
        201
    );
});

// POST /api/auth/logout
authRoutes.post('/logout', authMiddleware, async (c) => {
    // In a stateless JWT setup, logout is handled client-side
    // For token invalidation, you'd add the token to a blacklist
    return c.json({ success: true });
});

// GET /api/auth/me
authRoutes.get('/me', authMiddleware, async (c) => {
    const user = c.get('user');
    return c.json(user);
});

// PUT /api/auth/password
authRoutes.put('/password', authMiddleware, async (c) => {
    const user = c.get('user');
    const body = await c.req.json();
    const { oldPassword, newPassword } = changePasswordSchema.parse(body);

    const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { password: true },
    });

    if (!dbUser) {
        throw new AppError(404, 'User not found');
    }

    const isValidPassword = await compare(oldPassword, dbUser.password);
    if (!isValidPassword) {
        throw new AppError(401, 'Current password is incorrect');
    }

    const hashedPassword = await hash(newPassword, 12);
    await prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
    });

    return c.json({ success: true, message: 'Password updated successfully' });
});
