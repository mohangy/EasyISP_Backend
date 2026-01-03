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

// ==========================================
// ENHANCED WIZARD ENDPOINTS
// ==========================================

import { mikrotikService, type SystemResources, type RouterInterface, type HotspotConfig, type PPPoEConfig } from '../services/mikrotik.service.js';

// GET /api/wizard/:routerId/verify - Verify router is online and API reachable
wizardRoutes.get('/:routerId/verify', async (c) => {
    const tenantId = c.get('tenantId');
    const routerId = c.req.param('routerId');

    const nas = await prisma.nAS.findFirst({
        where: { id: routerId, tenantId },
    });

    if (!nas) {
        throw new AppError(404, 'Router not found');
    }

    // Check if router has valid IP (not 0.0.0.0)
    if (!nas.ipAddress || nas.ipAddress === '0.0.0.0') {
        return c.json({
            online: false,
            apiReachable: false,
            message: 'Router IP not detected. The provision-complete callback may have failed. Please ensure the router has internet access and can reach this server.',
            debug: {
                routerIp: nas.ipAddress,
                hasApiCredentials: !!(nas.apiUsername && nas.apiPassword),
            }
        });
    }

    // Check if router has API credentials
    if (!nas.apiUsername || !nas.apiPassword) {
        return c.json({
            online: false,
            apiReachable: false,
            message: 'Router API credentials not configured. Please run the provision script first.',
            debug: {
                routerIp: nas.ipAddress,
                hasApiCredentials: false,
            }
        });
    }

    try {
        logger.info({ routerId, routerIp: nas.ipAddress, apiPort: nas.apiPort }, 'Attempting to verify router connection');

        // Try to get system resources - this tests the connection
        await mikrotikService.getSystemResources(nas);

        // Update router status
        await prisma.nAS.update({
            where: { id: routerId },
            data: { status: 'ONLINE', lastSeen: new Date() },
        });

        return c.json({
            online: true,
            apiReachable: true,
            message: 'Router is online and API is reachable!',
        });
    } catch (error) {
        const errorMessage = (error as Error).message;
        logger.warn({ routerId, routerIp: nas.ipAddress, apiPort: nas.apiPort, error: errorMessage }, 'Router verification failed');

        return c.json({
            online: false,
            apiReachable: false,
            message: `Cannot reach router API at ${nas.ipAddress}:${nas.apiPort}. Error: ${errorMessage}`,
            debug: {
                routerIp: nas.ipAddress,
                vpnIp: nas.vpnIp,
                apiPort: nas.apiPort,
                hasApiCredentials: true,
                errorDetail: errorMessage,
            }
        });
    }
});

// GET /api/wizard/:routerId/system-info - Get router system resources
wizardRoutes.get('/:routerId/system-info', async (c) => {
    const tenantId = c.get('tenantId');
    const routerId = c.req.param('routerId');

    const nas = await prisma.nAS.findFirst({
        where: { id: routerId, tenantId },
    });

    if (!nas) {
        throw new AppError(404, 'Router not found');
    }

    if (!nas.apiUsername || !nas.apiPassword) {
        throw new AppError(400, 'Router API credentials not configured');
    }

    try {
        const resources = await mikrotikService.getSystemResources(nas);

        // Update router info in database
        await prisma.nAS.update({
            where: { id: routerId },
            data: {
                boardName: resources.boardName,
                routerOsVersion: resources.version,
                cpuLoad: resources.cpuLoad,
                memoryUsage: resources.totalMemory > 0
                    ? ((resources.totalMemory - resources.freeMemory) / resources.totalMemory) * 100
                    : 0,
                memoryTotal: resources.totalMemory,
                uptime: resources.uptime,
                status: 'ONLINE',
                lastSeen: new Date(),
            },
        });

        return c.json(resources);
    } catch (error) {
        logger.error({ routerId, error }, 'Failed to get system info');
        throw new AppError(500, `Failed to get system info: ${(error as Error).message}`);
    }
});

// GET /api/wizard/:routerId/interfaces - Get real interfaces from router
wizardRoutes.get('/:routerId/interfaces', async (c) => {
    const tenantId = c.get('tenantId');
    const routerId = c.req.param('routerId');

    const nas = await prisma.nAS.findFirst({
        where: { id: routerId, tenantId },
    });

    if (!nas) {
        throw new AppError(404, 'Router not found');
    }

    if (!nas.apiUsername || !nas.apiPassword) {
        throw new AppError(400, 'Router API credentials not configured');
    }

    try {
        const interfaces = await mikrotikService.getInterfaces(nas);

        return c.json({
            interfaces,
            wanInterface: interfaces.find((i: RouterInterface) => i.isWan)?.name || null,
        });
    } catch (error) {
        logger.error({ routerId, error }, 'Failed to get interfaces');
        throw new AppError(500, `Failed to get interfaces: ${(error as Error).message}`);
    }
});

// Service configuration schema
const configureServicesSchema = z.object({
    serviceType: z.enum(['hotspot', 'pppoe', 'both']),
    wanInterface: z.string().optional(),
    hotspotConfig: z.object({
        interfaces: z.array(z.string()).min(1),
        gatewayIp: z.string().default('10.5.50.1'),
        poolStart: z.string().default('10.5.50.2'),
        poolEnd: z.string().default('10.5.50.254'),
        dnsServers: z.array(z.string()).default(['8.8.8.8', '1.1.1.1']),
    }).optional(),
    pppoeConfig: z.object({
        interfaces: z.array(z.string()).min(1),
        serviceName: z.string().default('easyisp-pppoe'),
        localAddress: z.string().default('10.10.10.1'),
        poolStart: z.string().default('10.10.10.2'),
        poolEnd: z.string().default('10.10.10.254'),
    }).optional(),
    createBackup: z.boolean().default(true),
    configureFirewall: z.boolean().default(true),
});

// POST /api/wizard/:routerId/configure - Apply service configuration
wizardRoutes.post('/:routerId/configure', async (c) => {
    const tenantId = c.get('tenantId');
    const routerId = c.req.param('routerId');
    const body = await c.req.json();
    const config = configureServicesSchema.parse(body);

    const nas = await prisma.nAS.findFirst({
        where: { id: routerId, tenantId },
    });

    if (!nas) {
        throw new AppError(404, 'Router not found');
    }

    if (!nas.apiUsername || !nas.apiPassword) {
        throw new AppError(400, 'Router API credentials not configured');
    }

    const radiusServer = process.env['RADIUS_SERVER'] ?? '113.30.190.52';
    const results: string[] = [];

    try {
        // 1. Create backup if requested
        if (config.createBackup) {
            const backupName = await mikrotikService.backupConfig(nas);
            results.push(`Backup created: ${backupName}`);
        }

        // 2. Configure firewall if requested
        if (config.configureFirewall && config.wanInterface) {
            await mikrotikService.configureFirewall(nas, config.wanInterface);
            results.push('Firewall NAT configured');
        }

        // 3. Configure Hotspot if selected
        if ((config.serviceType === 'hotspot' || config.serviceType === 'both') && config.hotspotConfig) {
            const hotspotConf: HotspotConfig = {
                interfaces: config.hotspotConfig.interfaces,
                gatewayIp: config.hotspotConfig.gatewayIp ?? '10.5.50.1',
                poolStart: config.hotspotConfig.poolStart ?? '10.5.50.2',
                poolEnd: config.hotspotConfig.poolEnd ?? '10.5.50.254',
                dnsServers: config.hotspotConfig.dnsServers ?? ['8.8.8.8', '1.1.1.1'],
            };
            await mikrotikService.configureHotspot(
                nas,
                hotspotConf,
                radiusServer,
                nas.secret
            );
            results.push(`Hotspot configured on: ${config.hotspotConfig.interfaces.join(', ')}`);
        }

        // 4. Configure PPPoE if selected
        if ((config.serviceType === 'pppoe' || config.serviceType === 'both') && config.pppoeConfig) {
            const pppoeConf: PPPoEConfig = {
                interfaces: config.pppoeConfig.interfaces,
                serviceName: config.pppoeConfig.serviceName ?? 'easyisp-pppoe',
                localAddress: config.pppoeConfig.localAddress ?? '10.10.10.1',
                poolStart: config.pppoeConfig.poolStart ?? '10.10.10.2',
                poolEnd: config.pppoeConfig.poolEnd ?? '10.10.10.254',
            };
            await mikrotikService.configurePPPoE(nas, pppoeConf);
            results.push(`PPPoE configured on: ${config.pppoeConfig.interfaces.join(', ')}`);
        }

        // 5. Test configuration
        const testResult = await mikrotikService.testConfiguration(nas);

        logger.info({ routerId, config, testResult }, 'Router services configured');

        return c.json({
            success: true,
            message: 'Configuration applied successfully',
            results,
            testResult,
        });
    } catch (error) {
        logger.error({ routerId, error }, 'Failed to configure services');
        throw new AppError(500, `Failed to configure services: ${(error as Error).message}`);
    }
});

// GET /api/wizard/:routerId/test - Test current configuration
wizardRoutes.get('/:routerId/test', async (c) => {
    const tenantId = c.get('tenantId');
    const routerId = c.req.param('routerId');

    const nas = await prisma.nAS.findFirst({
        where: { id: routerId, tenantId },
    });

    if (!nas) {
        throw new AppError(404, 'Router not found');
    }

    if (!nas.apiUsername || !nas.apiPassword) {
        throw new AppError(400, 'Router API credentials not configured');
    }

    try {
        const testResult = await mikrotikService.testConfiguration(nas);
        return c.json(testResult);
    } catch (error) {
        logger.error({ routerId, error }, 'Failed to test configuration');
        throw new AppError(500, `Failed to test: ${(error as Error).message}`);
    }
});
