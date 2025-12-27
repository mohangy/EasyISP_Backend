import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../lib/logger.js';
import { randomUUID } from 'crypto';
export const wizardRoutes = new Hono();
// Apply auth middleware to all routes
wizardRoutes.use('*', authMiddleware);
// In-memory storage for wizard sessions (in production, use Redis)
const wizardSessions = new Map();
// Clean up old sessions periodically (every 10 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of wizardSessions.entries()) {
        if (now - session.createdAt.getTime() > 30 * 60 * 1000) { // 30 minutes
            wizardSessions.delete(token);
        }
    }
}, 10 * 60 * 1000);
const startWizardSchema = z.object({
    name: z.string().min(1),
    ipAddress: z.string().ip(),
    apiUsername: z.string().min(1),
    apiPassword: z.string().min(1),
    apiPort: z.number().optional().default(8728),
    secret: z.string().min(4),
});
const configureRouterSchema = z.object({
    wanInterface: z.string().min(1),
    lanInterface: z.string().min(1),
    hotspotInterface: z.string().optional(),
    radiusEnabled: z.boolean().default(true),
    hotspotEnabled: z.boolean().default(false),
});
// POST /api/wizard/start
wizardRoutes.post('/start', async (c) => {
    const tenantId = c.get('tenantId');
    const body = await c.req.json();
    const data = startWizardSchema.parse(body);
    // Check if router already exists
    const existing = await prisma.nAS.findFirst({
        where: { ipAddress: data.ipAddress, tenantId },
    });
    if (existing) {
        throw new AppError(409, 'Router with this IP already exists');
    }
    // Generate wizard token
    const token = randomUUID();
    // Create wizard session
    wizardSessions.set(token, {
        tenantId,
        status: 'pending',
        message: 'Starting connection...',
        progress: 0,
        createdAt: new Date(),
    });
    // Create router in database with PENDING status
    const nas = await prisma.nAS.create({
        data: {
            name: data.name,
            ipAddress: data.ipAddress,
            secret: data.secret,
            apiUsername: data.apiUsername,
            apiPassword: data.apiPassword,
            apiPort: data.apiPort,
            status: 'PENDING',
            tenantId,
        },
    });
    // Update wizard session with router ID
    wizardSessions.set(token, {
        ...wizardSessions.get(token),
        nasId: nas.id,
        status: 'connecting',
        message: 'Connecting to router...',
        progress: 20,
    });
    // TODO: Implement actual connection test in background
    // Simulate connection (in production, use actual MikroTik API)
    setTimeout(() => {
        const session = wizardSessions.get(token);
        if (session) {
            session.status = 'connected';
            session.message = 'Connected! Ready for configuration.';
            session.progress = 50;
        }
    }, 2000);
    return c.json({
        token,
        routerId: nas.id,
        message: 'Wizard started. Poll for status.',
    });
});
// GET /api/wizard/:token/status
wizardRoutes.get('/:token/status', async (c) => {
    const token = c.req.param('token');
    const session = wizardSessions.get(token);
    if (!session) {
        throw new AppError(404, 'Wizard session not found or expired');
    }
    return c.json({
        status: session.status,
        message: session.message,
        progress: session.progress,
        routerId: session.nasId,
    });
});
// GET /api/wizard/:routerId/interfaces
wizardRoutes.get('/:routerId/interfaces', async (c) => {
    const tenantId = c.get('tenantId');
    const routerId = c.req.param('routerId');
    const nas = await prisma.nAS.findFirst({
        where: { id: routerId, tenantId },
    });
    if (!nas) {
        throw new AppError(404, 'Router not found');
    }
    // TODO: Implement actual MikroTik API call
    // Return mock interfaces for now
    return c.json({
        interfaces: [
            { name: 'ether1', type: 'ethernet', comment: 'WAN', hasIp: true },
            { name: 'ether2', type: 'ethernet', comment: 'LAN', hasIp: true },
            { name: 'ether3', type: 'ethernet', comment: '', hasIp: false },
            { name: 'ether4', type: 'ethernet', comment: '', hasIp: false },
            { name: 'ether5', type: 'ethernet', comment: '', hasIp: false },
            { name: 'wlan1', type: 'wireless', comment: 'Hotspot', hasIp: false },
        ],
    });
});
// POST /api/wizard/:routerId/configure
wizardRoutes.post('/:routerId/configure', async (c) => {
    const tenantId = c.get('tenantId');
    const routerId = c.req.param('routerId');
    const body = await c.req.json();
    const data = configureRouterSchema.parse(body);
    const nas = await prisma.nAS.findFirst({
        where: { id: routerId, tenantId },
    });
    if (!nas) {
        throw new AppError(404, 'Router not found');
    }
    // TODO: Implement actual MikroTik configuration
    // For now, just update status
    await prisma.nAS.update({
        where: { id: routerId },
        data: { status: 'ONLINE' },
    });
    logger.info({ routerId, config: data }, 'Router configured via wizard');
    return c.json({
        success: true,
        message: 'Router configured successfully',
        configuration: {
            wanInterface: data.wanInterface,
            lanInterface: data.lanInterface,
            hotspotInterface: data.hotspotInterface,
            radiusEnabled: data.radiusEnabled,
            hotspotEnabled: data.hotspotEnabled,
        },
    });
});
// GET /api/wizard/:routerId/script
wizardRoutes.get('/:routerId/script', async (c) => {
    const tenantId = c.get('tenantId');
    const routerId = c.req.param('routerId');
    const nas = await prisma.nAS.findFirst({
        where: { id: routerId, tenantId },
    });
    if (!nas) {
        throw new AppError(404, 'Router not found');
    }
    const radiusServer = process.env['RADIUS_SERVER'] ?? '0.0.0.0';
    const radiusPort = process.env['RADIUS_PORT'] ?? '1812';
    const acctPort = process.env['RADIUS_ACCT_PORT'] ?? '1813';
    const script = `
# ===========================================
# EasyISP Auto-Configuration Script
# Router: ${nas.name}
# Generated: ${new Date().toISOString()}
# ===========================================

# RADIUS Configuration
/radius remove [find]
/radius add address=${radiusServer} secret="${nas.secret}" service=hotspot,login,ppp \\
    authentication-port=${radiusPort} accounting-port=${acctPort} timeout=3000ms

# PPPoE Configuration
/ppp aaa set use-radius=yes accounting=yes interim-update=5m

# User AAA
/user aaa set use-radius=yes accounting=yes interim-update=5m

# CoA (Change of Authorization)
/radius incoming set accept=yes port=${nas.coaPort}

# Hotspot Profile (if using hotspot)
/ip hotspot profile set [find default=yes] \\
    use-radius=yes radius-interim-update=5m \\
    login-by=http-chap,mac-cookie,trial \\
    nas-port-type=ethernet

# System Identity
/system identity set name="${nas.name}"

# Logging (optional - for debugging RADIUS)
# /system logging add topics=radius action=memory

:log info "EasyISP RADIUS configuration applied successfully"
`.trim();
    // Return as downloadable script
    c.header('Content-Type', 'text/plain');
    c.header('Content-Disposition', `attachment; filename="${nas.name}-config.rsc"`);
    return c.text(script);
});
// POST /api/wizard/:routerId/auto-configure
wizardRoutes.post('/:routerId/auto-configure', async (c) => {
    const tenantId = c.get('tenantId');
    const routerId = c.req.param('routerId');
    const nas = await prisma.nAS.findFirst({
        where: { id: routerId, tenantId },
    });
    if (!nas) {
        throw new AppError(404, 'Router not found');
    }
    // TODO: Implement actual auto-configuration via MikroTik API
    // This would:
    // 1. Connect via API
    // 2. Run configuration commands
    // 3. Update router status
    // Simulate configuration
    await prisma.nAS.update({
        where: { id: routerId },
        data: {
            status: 'ONLINE',
            lastSeen: new Date(),
        },
    });
    logger.info({ routerId }, 'Auto-configuration completed');
    return c.json({
        success: true,
        message: 'Auto-configuration completed successfully',
        status: 'ONLINE',
    });
});
//# sourceMappingURL=wizard.routes.js.map