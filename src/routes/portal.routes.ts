import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../lib/logger.js';

export const portalRoutes = new Hono();

// These routes are mostly public for hotspot portal access

// GET /api/portal/packages - Get available packages for portal
portalRoutes.get('/packages', async (c) => {
    const tenantId = c.req.query('tenantId');

    if (!tenantId) {
        throw new AppError(400, 'Tenant ID required');
    }

    const packages = await prisma.package.findMany({
        where: {
            tenantId,
            status: 'ACTIVE',
            type: 'HOTSPOT',
        },
        select: {
            id: true,
            name: true,
            price: true,
            downloadSpeed: true,
            uploadSpeed: true,
            sessionTime: true,
            dataQuota: true,
            description: true,
        },
        orderBy: { price: 'asc' },
    });

    return c.json({
        packages: packages.map((p) => ({
            id: p.id,
            name: p.name,
            price: p.price,
            speed: `${p.downloadSpeed}/${p.uploadSpeed} Mbps`,
            duration: p.sessionTime ? formatDuration(p.sessionTime) : 'Unlimited',
            data: p.dataQuota ? formatBytes(p.dataQuota) : 'Unlimited',
            description: p.description,
        })),
    });
});

// POST /api/portal/login - Hotspot login
portalRoutes.post('/login', async (c) => {
    const body = await c.req.json();
    const { username, password, nasId, macAddress, ip } = body;

    if (!username || !password) {
        throw new AppError(400, 'Username and password required');
    }

    // Find customer
    const customer = await prisma.customer.findFirst({
        where: {
            OR: [
                { username },
                { phone: username },
            ],
            deletedAt: null,
        },
        include: {
            package: true,
            tenant: { select: { id: true, name: true } },
        },
    });

    if (!customer) {
        throw new AppError(401, 'Invalid credentials');
    }

    // Check if customer is active
    if (customer.status !== 'ACTIVE') {
        throw new AppError(403, `Account ${customer.status.toLowerCase()}`);
    }

    // Check expiry
    if (customer.expiresAt && customer.expiresAt < new Date()) {
        throw new AppError(403, 'Subscription expired');
    }

    // TODO: Verify password (would need password field or RADIUS auth)
    // For now, just check if password matches username or phone (for demo)

    // Create or update session
    const session = await prisma.session.create({
        data: {
            sessionId: `HS-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            username: customer.username,
            customerId: customer.id,
            nasId: nasId ?? undefined,
            framedIp: ip,
            macAddress,
            startTime: new Date(),
        },
    });

    logger.info({ username, sessionId: session.sessionId }, 'Hotspot login successful');

    return c.json({
        success: true,
        sessionId: session.sessionId,
        customer: {
            name: customer.name,
            package: customer.package?.name,
            expiresAt: customer.expiresAt,
        },
        quota: customer.package ? {
            speed: `${customer.package.downloadSpeed}/${customer.package.uploadSpeed} Mbps`,
            data: customer.package.dataQuota ? formatBytes(customer.package.dataQuota) : 'Unlimited',
            time: customer.package.sessionTime ? formatDuration(customer.package.sessionTime) : 'Unlimited',
        } : null,
    });
});

// POST /api/portal/logout - Hotspot logout
portalRoutes.post('/logout', async (c) => {
    const body = await c.req.json();
    const { sessionId, username, macAddress } = body;

    const session = await prisma.session.findFirst({
        where: {
            OR: [
                { sessionId },
                { username },
                { macAddress },
            ],
            stopTime: null,
        },
    });

    if (!session) {
        throw new AppError(404, 'Session not found');
    }

    await prisma.session.update({
        where: { id: session.id },
        data: {
            stopTime: new Date(),
            terminateCause: 'User-Logout',
        },
    });

    return c.json({ success: true });
});

// GET /api/portal/status - Get session status
portalRoutes.get('/status', async (c) => {
    const sessionId = c.req.query('sessionId');
    const macAddress = c.req.query('mac');

    if (!sessionId && !macAddress) {
        throw new AppError(400, 'Session ID or MAC address required');
    }

    const session = await prisma.session.findFirst({
        where: {
            OR: [
                { sessionId: sessionId ?? undefined },
                { macAddress: macAddress ?? undefined },
            ],
            stopTime: null,
        },
        include: {
            customer: {
                include: { package: true },
            },
        },
    });

    if (!session) {
        return c.json({ active: false });
    }

    const uptime = Math.floor((Date.now() - session.startTime.getTime()) / 1000);

    return c.json({
        active: true,
        sessionId: session.sessionId,
        uptime: formatUptime(uptime),
        uptimeSeconds: uptime,
        bytesIn: session.inputOctets,
        bytesOut: session.outputOctets,
        customer: session.customer ? {
            name: session.customer.name,
            package: session.customer.package?.name,
        } : null,
    });
});

// POST /api/portal/voucher - Redeem voucher from portal
portalRoutes.post('/voucher', async (c) => {
    const body = await c.req.json();
    const { code, macAddress, nasId } = body;

    if (!code) {
        throw new AppError(400, 'Voucher code required');
    }

    const voucher = await prisma.voucher.findFirst({
        where: { code: code.toUpperCase(), status: 'AVAILABLE' },
        include: { package: true },
    });

    if (!voucher) {
        throw new AppError(404, 'Invalid or unavailable voucher');
    }

    // Create a temporary customer/session for the voucher
    const username = `V-${code.toUpperCase()}`;

    // Mark voucher as used
    await prisma.voucher.update({
        where: { id: voucher.id },
        data: {
            status: 'USED',
            usedAt: new Date(),
        },
    });

    // Create session
    const session = await prisma.session.create({
        data: {
            sessionId: `VCH-${Date.now()}`,
            username,
            nasId: nasId ?? undefined,
            macAddress,
            startTime: new Date(),
        },
    });

    return c.json({
        success: true,
        sessionId: session.sessionId,
        package: {
            name: voucher.package.name,
            speed: `${voucher.package.downloadSpeed}/${voucher.package.uploadSpeed} Mbps`,
            duration: voucher.package.sessionTime
                ? formatDuration(voucher.package.sessionTime)
                : '30 days',
        },
    });
});

// GET /api/portal/tenant - Get tenant info for branding
portalRoutes.get('/tenant', async (c) => {
    const tenantId = c.req.query('tenantId');
    const nasIp = c.req.query('nasIp');

    let tenant;

    if (tenantId) {
        tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: {
                id: true,
                name: true,
                businessName: true,
                logo: true,
                primaryColor: true,
                phone: true,
                email: true,
            },
        });
    } else if (nasIp) {
        // Find tenant by NAS IP
        const nas = await prisma.nAS.findFirst({
            where: { ipAddress: nasIp },
            include: { tenant: true },
        });
        tenant = nas?.tenant;
    }

    if (!tenant) {
        throw new AppError(404, 'Tenant not found');
    }

    return c.json({
        id: tenant.id,
        name: tenant.businessName ?? tenant.name,
        logo: tenant.logo,
        primaryColor: tenant.primaryColor ?? '#0ea5e9',
        contact: {
            phone: tenant.phone,
            email: tenant.email,
        },
    });
});

// Helper functions
function formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes} min`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)} hours`;
    return `${Math.floor(minutes / 1440)} days`;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatUptime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours}h ${minutes}m ${secs}s`;
}
