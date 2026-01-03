import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../lib/logger.js';
import { randomBytes } from 'crypto';
import { encryptToken } from './provision.routes.js';

export const wizardRoutes = new Hono();

// Apply auth middleware to all routes EXCEPT provision-complete callback
wizardRoutes.use('*', async (c, next) => {
    // Allow provision-complete callback without auth (router calls this)
    if (c.req.path.endsWith('/provision-complete')) {
        return next();
    }
    return authMiddleware(c, next);
});

// Simple schema - only router name required
const startWizardSchema = z.object({
    name: z.string().min(1, 'Router name is required'),
});

// Generate a secure random secret
function generateSecret(): string {
    return randomBytes(16).toString('hex');
}

// POST /api/wizard/start - Start router provisioning
wizardRoutes.post('/start', async (c) => {
    const tenantId = c.get('tenantId');
    const body = await c.req.json();
    const data = startWizardSchema.parse(body);

    // Check if router with same name already exists
    const existing = await prisma.nAS.findFirst({
        where: { name: data.name, tenantId },
    });
    if (existing) {
        throw new AppError(409, 'Router with this name already exists');
    }

    // Auto-generate RADIUS secret
    const secret = generateSecret();

    // Create router in database with PENDING status
    // IP address will be updated when router calls back
    const nas = await prisma.nAS.create({
        data: {
            name: data.name,
            ipAddress: '0.0.0.0', // Will be updated on first connection
            secret,
            coaPort: 3799,
            status: 'PENDING',
            tenantId,
        },
    });

    // Generate encrypted provision token
    const token = encryptToken({
        routerId: nas.id,
        tenantId,
        secret,
    });

    // Build provision command
    const baseUrl = process.env['API_BASE_URL'] ?? 'https://113-30-190-52.cloud-xip.com';
    const provisionCommand = `/tool fetch mode=https url="${baseUrl}/provision/${token}" dst-path=easyisp.rsc; :delay 2s; /import easyisp.rsc;`;

    logger.info({ routerId: nas.id, routerName: nas.name }, 'Router provisioning started');

    return c.json({
        routerId: nas.id,
        token,
        secret,
        provisionCommand,
        message: 'Copy and paste the provision command into your MikroTik terminal.',
    });
});

// GET /api/wizard/:routerId/status - Get router provision status
wizardRoutes.get('/:routerId/status', async (c) => {
    const tenantId = c.get('tenantId');
    const routerId = c.req.param('routerId');

    const nas = await prisma.nAS.findFirst({
        where: { id: routerId, tenantId },
    });

    if (!nas) {
        throw new AppError(404, 'Router not found');
    }

    return c.json({
        routerId: nas.id,
        name: nas.name,
        status: nas.status,
        ipAddress: nas.ipAddress,
        lastSeen: nas.lastSeen,
        isProvisioned: nas.status === 'ONLINE',
    });
});

// GET /api/wizard/:routerId/provision-complete - Callback when router completes provisioning
// NO AUTH - router calls this directly after running the script
wizardRoutes.get('/:routerId/provision-complete', async (c) => {
    const routerId = c.req.param('routerId');

    // Get the router's IP from the request
    const forwardedFor = c.req.header('x-forwarded-for');
    const realIp = c.req.header('x-real-ip');
    const routerIp = forwardedFor?.split(',')[0]?.trim() || realIp || 'unknown';

    const nas = await prisma.nAS.findFirst({
        where: { id: routerId },
    });

    if (!nas) {
        logger.warn({ routerId }, 'Provision complete called for unknown router');
        return c.text('Router not found', 404);
    }

    // Update router status to ONLINE
    await prisma.nAS.update({
        where: { id: routerId },
        data: {
            status: 'ONLINE',
            ipAddress: routerIp !== 'unknown' ? routerIp : nas.ipAddress,
            lastSeen: new Date(),
        },
    });

    logger.info({ routerId, routerName: nas.name, routerIp }, 'Router provisioning completed');

    return c.text('OK');
});

// GET /api/wizard/:routerId/script - Get provision script (for manual download)
wizardRoutes.get('/:routerId/script', async (c) => {
    const tenantId = c.get('tenantId');
    const routerId = c.req.param('routerId');

    const nas = await prisma.nAS.findFirst({
        where: { id: routerId, tenantId },
    });

    if (!nas) {
        throw new AppError(404, 'Router not found');
    }

    // Generate new token for this router
    const token = encryptToken({
        routerId: nas.id,
        tenantId,
        secret: nas.secret,
    });

    const baseUrl = process.env['API_BASE_URL'] ?? 'https://113-30-190-52.cloud-xip.com';
    const provisionCommand = `/tool fetch mode=https url="${baseUrl}/provision/${token}" dst-path=easyisp.rsc; :delay 2s; /import easyisp.rsc;`;

    return c.json({
        routerId: nas.id,
        routerName: nas.name,
        secret: nas.secret,
        provisionCommand,
    });
});
