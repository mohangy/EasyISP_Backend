/**
 * Wizard Routes Tests
 * Comprehensive tests for Zero-Touch Router Wizard API endpoints
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import {
    mockNas,
    mockTenant,
    mockSystemResources,
    mockInterfaces,
    mockWirelessInterfaces,
    mockFirmwareInfo,
} from './test-utils.js';

// Mock dependencies before importing routes
vi.mock('../lib/prisma.js', () => ({
    prisma: {
        nAS: {
            findFirst: vi.fn(),
            findUnique: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
        },
        tenant: {
            findUnique: vi.fn(),
        },
    },
}));

vi.mock('../services/mikrotik.service.js', () => ({
    mikrotikService: {
        getSystemResources: vi.fn(),
        getInterfaces: vi.fn(),
        getWirelessInterfaces: vi.fn(),
        getSecurityProfiles: vi.fn(),
        configureWireless: vi.fn(),
        configureHotspot: vi.fn(),
        configurePPPoE: vi.fn(),
        configureFirewall: vi.fn(),
        backupConfig: vi.fn(),
        restoreBackup: vi.fn(),
        testConfiguration: vi.fn(),
        getFirmwareInfo: vi.fn(),
        checkFirmwareUpdates: vi.fn(),
        updateFirmware: vi.fn(),
    },
}));

vi.mock('../middleware/auth.js', () => ({
    authMiddleware: vi.fn((c, next) => {
        c.set('tenantId', 'test-tenant-id');
        c.set('userId', 'test-user-id');
        return next();
    }),
}));

vi.mock('../lib/logger.js', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

// Import after mocks are set up
import { prisma } from '../lib/prisma.js';
import { mikrotikService } from '../services/mikrotik.service.js';
import { wizardRoutes } from '../routes/wizard.routes.js';

describe('Wizard Routes', () => {
    let app: Hono;

    beforeEach(() => {
        vi.clearAllMocks();
        app = new Hono();
        app.route('/api/wizard', wizardRoutes);
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    // =============================================
    // POST /api/wizard/start - Start wizard
    // =============================================
    describe('POST /api/wizard/start', () => {
        it('should create a new router and return provision command', async () => {
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(null);
            vi.mocked(prisma.nAS.create).mockResolvedValue({
                ...mockNas,
                id: 'new-router-id',
                status: 'PENDING',
            } as any);

            const res = await app.request('/api/wizard/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'New Router' }),
            });

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.routerId).toBeDefined();
            expect(data.token).toBeDefined();
            expect(data.secret).toBeDefined();
            expect(data.provisionCommand).toContain('/tool fetch');
            expect(data.message).toContain('Copy and paste');
        });

        it('should reject if router name already exists', async () => {
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(mockNas as any);

            const res = await app.request('/api/wizard/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'Test Router' }),
            });

            expect(res.status).toBe(409);
        });

        it('should reject if router name is empty', async () => {
            const res = await app.request('/api/wizard/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: '' }),
            });

            expect(res.status).toBe(400);
        });
    });

    // =============================================
    // GET /api/wizard/:routerId/status
    // =============================================
    describe('GET /api/wizard/:routerId/status', () => {
        it('should return router status', async () => {
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(mockNas as any);

            const res = await app.request('/api/wizard/test-router-id/status');

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.routerId).toBe('test-router-id');
            expect(data.name).toBe('Test Router');
            expect(data.status).toBe('ONLINE');
            expect(data.isProvisioned).toBe(true);
        });

        it('should return 404 for non-existent router', async () => {
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(null);

            const res = await app.request('/api/wizard/non-existent/status');

            expect(res.status).toBe(404);
        });
    });

    // =============================================
    // GET /api/wizard/:routerId/provision-complete
    // =============================================
    describe('GET /api/wizard/:routerId/provision-complete', () => {
        it('should mark router as provisioned with valid key', async () => {
            const pendingNas = { ...mockNas, status: 'PENDING', apiPassword: 'validkey' };
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(pendingNas as any);
            vi.mocked(prisma.nAS.update).mockResolvedValue({ ...pendingNas, status: 'ONLINE' } as any);

            const res = await app.request('/api/wizard/test-router-id/provision-complete?key=validkey', {
                headers: { 'x-forwarded-for': '203.0.113.50' },
            });

            expect(res.status).toBe(200);
            const text = await res.text();
            expect(text).toBe('OK');
            expect(prisma.nAS.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    status: 'ONLINE',
                }),
            }));
        });

        it('should reject invalid key', async () => {
            const pendingNas = { ...mockNas, status: 'PENDING', apiPassword: 'validkey' };
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(pendingNas as any);

            const res = await app.request('/api/wizard/test-router-id/provision-complete?key=invalidkey');

            expect(res.status).toBe(401);
        });

        it('should return 404 for unknown router', async () => {
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(null);

            const res = await app.request('/api/wizard/unknown/provision-complete');

            expect(res.status).toBe(404);
        });
    });

    // =============================================
    // GET /api/wizard/:routerId/verify
    // =============================================
    describe('GET /api/wizard/:routerId/verify', () => {
        it('should verify online router with API', async () => {
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(mockNas as any);
            vi.mocked(mikrotikService.getSystemResources).mockResolvedValue(mockSystemResources);
            vi.mocked(prisma.nAS.update).mockResolvedValue(mockNas as any);

            const res = await app.request('/api/wizard/test-router-id/verify');

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.online).toBe(true);
            expect(data.apiReachable).toBe(true);
        });

        it('should return offline status for router without IP', async () => {
            const noIpNas = { ...mockNas, ipAddress: '0.0.0.0', vpnIp: null };
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(noIpNas as any);

            const res = await app.request('/api/wizard/test-router-id/verify');

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.online).toBe(false);
        });

        it('should return not reachable for router without API credentials', async () => {
            const noApiNas = { ...mockNas, apiUsername: null, apiPassword: null };
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(noApiNas as any);

            const res = await app.request('/api/wizard/test-router-id/verify');

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.online).toBe(false);
            expect(data.message).toContain('credentials');
        });
    });

    // =============================================
    // GET /api/wizard/:routerId/system-info
    // =============================================
    describe('GET /api/wizard/:routerId/system-info', () => {
        it('should return system resources', async () => {
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(mockNas as any);
            vi.mocked(mikrotikService.getSystemResources).mockResolvedValue(mockSystemResources);
            vi.mocked(prisma.nAS.update).mockResolvedValue(mockNas as any);

            const res = await app.request('/api/wizard/test-router-id/system-info');

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.boardName).toBe('RB5009UG+S+');
            expect(data.version).toBe('7.14.1');
            expect(data.cpuLoad).toBe(15);
        });

        it('should return 400 for router without API credentials', async () => {
            const noApiNas = { ...mockNas, apiUsername: null };
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(noApiNas as any);

            const res = await app.request('/api/wizard/test-router-id/system-info');

            expect(res.status).toBe(400);
        });
    });

    // =============================================
    // GET /api/wizard/:routerId/interfaces
    // =============================================
    describe('GET /api/wizard/:routerId/interfaces', () => {
        it('should return interfaces with WAN detection', async () => {
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(mockNas as any);
            vi.mocked(mikrotikService.getInterfaces).mockResolvedValue(mockInterfaces);

            const res = await app.request('/api/wizard/test-router-id/interfaces');

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.interfaces).toHaveLength(3);
            expect(data.wanInterface).toBe('ether1');
        });
    });

    // =============================================
    // POST /api/wizard/:routerId/configure
    // =============================================
    describe('POST /api/wizard/:routerId/configure', () => {
        it('should configure hotspot services', async () => {
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(mockNas as any);
            vi.mocked(mikrotikService.backupConfig).mockResolvedValue('backup-123');
            vi.mocked(mikrotikService.configureFirewall).mockResolvedValue(true);
            vi.mocked(mikrotikService.configureHotspot).mockResolvedValue(true);
            vi.mocked(mikrotikService.testConfiguration).mockResolvedValue({ hotspot: true, pppoe: false, radius: true });

            const res = await app.request('/api/wizard/test-router-id/configure', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    serviceType: 'hotspot',
                    wanInterface: 'ether1',
                    createBackup: true,
                    configureFirewall: true,
                    hotspotConfig: {
                        interfaces: ['wlan1'],
                        gatewayIp: '10.5.50.1',
                        poolStart: '10.5.50.2',
                        poolEnd: '10.5.50.254',
                    },
                }),
            });

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.success).toBe(true);
            expect(data.results).toContain('Backup created: backup-123');
        });

        it('should configure PPPoE services', async () => {
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(mockNas as any);
            vi.mocked(mikrotikService.backupConfig).mockResolvedValue('backup-456');
            vi.mocked(mikrotikService.configurePPPoE).mockResolvedValue(true);
            vi.mocked(mikrotikService.testConfiguration).mockResolvedValue({ hotspot: false, pppoe: true, radius: true });

            const res = await app.request('/api/wizard/test-router-id/configure', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    serviceType: 'pppoe',
                    createBackup: true,
                    pppoeConfig: {
                        interfaces: ['ether2'],
                        serviceName: 'easyisp-pppoe',
                    },
                }),
            });

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.success).toBe(true);
        });

        it('should configure both services', async () => {
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(mockNas as any);
            vi.mocked(mikrotikService.backupConfig).mockResolvedValue('backup-789');
            vi.mocked(mikrotikService.configureFirewall).mockResolvedValue(true);
            vi.mocked(mikrotikService.configureHotspot).mockResolvedValue(true);
            vi.mocked(mikrotikService.configurePPPoE).mockResolvedValue(true);
            vi.mocked(mikrotikService.testConfiguration).mockResolvedValue({ hotspot: true, pppoe: true, radius: true });

            const res = await app.request('/api/wizard/test-router-id/configure', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    serviceType: 'both',
                    wanInterface: 'ether1',
                    createBackup: true,
                    configureFirewall: true,
                    hotspotConfig: { interfaces: ['wlan1'] },
                    pppoeConfig: { interfaces: ['ether2'] },
                }),
            });

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.success).toBe(true);
            expect(data.testResult.hotspot).toBe(true);
            expect(data.testResult.pppoe).toBe(true);
        });
    });

    // =============================================
    // GET /api/wizard/:routerId/wireless
    // =============================================
    describe('GET /api/wizard/:routerId/wireless', () => {
        it('should return wireless interfaces', async () => {
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(mockNas as any);
            vi.mocked(mikrotikService.getWirelessInterfaces).mockResolvedValue(mockWirelessInterfaces);
            vi.mocked(mikrotikService.getSecurityProfiles).mockResolvedValue([
                { name: 'default', mode: 'none', authentication: '' },
            ]);

            const res = await app.request('/api/wizard/test-router-id/wireless');

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.hasWireless).toBe(true);
            expect(data.interfaces).toHaveLength(2);
            expect(data.securityProfiles).toBeDefined();
        });

        it('should indicate no wireless for wired routers', async () => {
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(mockNas as any);
            vi.mocked(mikrotikService.getWirelessInterfaces).mockResolvedValue([]);
            vi.mocked(mikrotikService.getSecurityProfiles).mockResolvedValue([]);

            const res = await app.request('/api/wizard/test-router-id/wireless');

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.hasWireless).toBe(false);
        });
    });

    // =============================================
    // POST /api/wizard/:routerId/configure-wireless
    // =============================================
    describe('POST /api/wizard/:routerId/configure-wireless', () => {
        it('should configure wireless with WPA2', async () => {
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(mockNas as any);
            vi.mocked(mikrotikService.configureWireless).mockResolvedValue(true);

            const res = await app.request('/api/wizard/test-router-id/configure-wireless', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    interfaceName: 'wlan1',
                    ssid: 'MyNetwork',
                    band: '2ghz-b/g/n',
                    securityMode: 'wpa2-psk',
                    passphrase: 'mysecurepassword',
                }),
            });

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.success).toBe(true);
        });

        it('should reject if passphrase missing for WPA', async () => {
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(mockNas as any);

            const res = await app.request('/api/wizard/test-router-id/configure-wireless', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    interfaceName: 'wlan1',
                    ssid: 'MyNetwork',
                    securityMode: 'wpa2-psk',
                    // Missing passphrase
                }),
            });

            expect(res.status).toBe(400);
        });

        it('should allow open network without passphrase', async () => {
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(mockNas as any);
            vi.mocked(mikrotikService.configureWireless).mockResolvedValue(true);

            const res = await app.request('/api/wizard/test-router-id/configure-wireless', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    interfaceName: 'wlan1',
                    ssid: 'OpenNetwork',
                    securityMode: 'none',
                }),
            });

            expect(res.status).toBe(200);
        });
    });

    // =============================================
    // GET /api/wizard/:routerId/firmware
    // =============================================
    describe('GET /api/wizard/:routerId/firmware', () => {
        it('should return firmware information', async () => {
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(mockNas as any);
            vi.mocked(mikrotikService.getFirmwareInfo).mockResolvedValue(mockFirmwareInfo);

            const res = await app.request('/api/wizard/test-router-id/firmware');

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.currentVersion).toBe('7.14.1');
            expect(data.updateAvailable).toBe(true);
            expect(data.packages).toHaveLength(2);
        });
    });

    // =============================================
    // POST /api/wizard/:routerId/firmware/check
    // =============================================
    describe('POST /api/wizard/:routerId/firmware/check', () => {
        it('should check for updates', async () => {
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(mockNas as any);
            vi.mocked(mikrotikService.checkFirmwareUpdates).mockResolvedValue({
                available: true,
                currentVersion: '7.14.1',
                latestVersion: '7.15',
            });

            const res = await app.request('/api/wizard/test-router-id/firmware/check', {
                method: 'POST',
            });

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.available).toBe(true);
            expect(data.latestVersion).toBe('7.15');
        });
    });

    // =============================================
    // POST /api/wizard/:routerId/firmware/update
    // =============================================
    describe('POST /api/wizard/:routerId/firmware/update', () => {
        it('should trigger firmware update', async () => {
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(mockNas as any);
            vi.mocked(mikrotikService.updateFirmware).mockResolvedValue({
                success: true,
                message: 'Update installed, router is rebooting',
            });
            vi.mocked(prisma.nAS.update).mockResolvedValue({ ...mockNas, status: 'RESTARTING' } as any);

            const res = await app.request('/api/wizard/test-router-id/firmware/update', {
                method: 'POST',
            });

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.success).toBe(true);
        });
    });

    // =============================================
    // GET /api/wizard/:routerId/resume
    // =============================================
    describe('GET /api/wizard/:routerId/resume', () => {
        it('should return resume state for pending router', async () => {
            const pendingNas = { ...mockNas, status: 'PENDING', ipAddress: '0.0.0.0', apiUsername: null };
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(pendingNas as any);

            const res = await app.request('/api/wizard/test-router-id/resume');

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.currentStep).toBe('script');
            expect(data.canResume).toBe(true);
            expect(data.provisionCommand).toBeDefined();
        });

        it('should return resume state for online router', async () => {
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(mockNas as any);

            const res = await app.request('/api/wizard/test-router-id/resume');

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.currentStep).toBe('info');
            expect(data.canResume).toBe(true);
        });
    });

    // =============================================
    // DELETE /api/wizard/:routerId
    // =============================================
    describe('DELETE /api/wizard/:routerId', () => {
        it('should delete pending router', async () => {
            const pendingNas = { ...mockNas, status: 'PENDING' };
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(pendingNas as any);
            vi.mocked(prisma.nAS.delete).mockResolvedValue(pendingNas as any);

            const res = await app.request('/api/wizard/test-router-id', {
                method: 'DELETE',
            });

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.success).toBe(true);
        });

        it('should reject deletion of online router', async () => {
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(mockNas as any);

            const res = await app.request('/api/wizard/test-router-id', {
                method: 'DELETE',
            });

            expect(res.status).toBe(400);
        });
    });

    // =============================================
    // GET /api/wizard/:routerId/test
    // =============================================
    describe('GET /api/wizard/:routerId/test', () => {
        it('should test router configuration', async () => {
            vi.mocked(prisma.nAS.findFirst).mockResolvedValue(mockNas as any);
            vi.mocked(mikrotikService.testConfiguration).mockResolvedValue({
                hotspot: true,
                pppoe: true,
                radius: true,
            });

            const res = await app.request('/api/wizard/test-router-id/test');

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.hotspot).toBe(true);
            expect(data.pppoe).toBe(true);
            expect(data.radius).toBe(true);
        });
    });
});
