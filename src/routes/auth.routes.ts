import { Hono } from 'hono';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { promises as fs } from 'fs';
import path from 'path';
const { hash, compare } = bcrypt;
const { sign } = jwt;
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

    // Check tenant status
    if (user.tenant.status === 'SUSPENDED') {
        throw new AppError(403, 'Your company account has been suspended. Please contact support.');
    }

    if (user.tenant.status === 'EXPIRED') {
        throw new AppError(403, 'Your company account has expired. Please contact us to renew your subscription.');
    }

    // Check trial expiration for trial accounts
    if (user.tenant.status === 'TRIAL') {
        const now = new Date();

        if (user.tenant.trialEndsAt && user.tenant.trialEndsAt < now) {
            // Trial has expired
            // Auto-update tenant status to EXPIRED
            await prisma.tenant.update({
                where: { id: user.tenant.id },
                data: { status: 'EXPIRED' },
            });

            throw new AppError(403, 'Your trial period has expired. Please contact us to activate your account.');
        }
    }

    // Additional check: if activated, verify subscription hasn't expired
    if (user.tenant.isActivated && user.tenant.subscriptionEndsAt) {
        const now = new Date();
        if (user.tenant.subscriptionEndsAt < now) {
            // Subscription expired
            await prisma.tenant.update({
                where: { id: user.tenant.id },
                data: { status: 'EXPIRED' },
            });

            throw new AppError(403, 'Your subscription has expired. Please renew to continue using our services.');
        }
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
        // Calculate trial end date (7 days from now)
        const trialEndsAt = new Date();
        trialEndsAt.setDate(trialEndsAt.getDate() + 7);

        // Create tenant with 7-day trial
        const tenant = await tx.tenant.create({
            data: {
                name: businessName.toLowerCase().replace(/\s+/g, '-'),
                businessName,
                email,
                phone,
                status: 'TRIAL',
                isActivated: false,           // Requires SaaS owner activation
                trialEndsAt: trialEndsAt,     // 7 days from registration
            },
        });

        // Create super admin user with all permissions
        const user = await tx.user.create({
            data: {
                email,
                password: hashedPassword,
                name,
                role: 'SUPER_ADMIN', // Super admin role
                status: 'ACTIVE',
                tenantId: tenant.id,
                // Super admin has all permissions by default (empty arrays mean no restrictions)
                addedPermissions: [],
                removedPermissions: [],
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
                addedPermissions: result.user.addedPermissions,
                removedPermissions: result.user.removedPermissions,
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

// Helper to ensure upload dir exists
const ensureUploadDir = async () => {
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    try {
        await fs.access(uploadDir);
    } catch {
        await fs.mkdir(uploadDir, { recursive: true });
    }
    return uploadDir;
};

// POST /api/auth/profile-picture
authRoutes.post('/profile-picture', authMiddleware, async (c) => {
    const user = c.get('user');
    const body = await c.req.parseBody();
    const file = body['profilePicture'];

    if (!file) {
        throw new AppError(400, "No file uploaded");
    }

    const uploadDir = await ensureUploadDir();
    let fileName = '';
    let buffer: Buffer;

    if (file instanceof File) {
        fileName = `${user.id}-${Date.now()}${path.extname(file.name)}`;
        buffer = Buffer.from(await file.arrayBuffer());
    } else {
        throw new AppError(400, "Invalid file format");
    }

    const filePath = path.join(uploadDir, fileName);
    await fs.writeFile(filePath, buffer);

    const fileUrl = `/uploads/${fileName}`;

    const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: { profilePicture: fileUrl },
        include: { tenant: true }
    });

    return c.json({
        user: {
            id: updatedUser.id,
            name: updatedUser.name,
            email: updatedUser.email,
            role: updatedUser.role,
            tenantId: updatedUser.tenantId,
            addedPermissions: updatedUser.addedPermissions,
            removedPermissions: updatedUser.removedPermissions,
            profilePicture: updatedUser.profilePicture
        }
    });
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
