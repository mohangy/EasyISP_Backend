/**
 * MikroTik Service Tests
 * Unit tests for MikroTik RouterOS API service methods
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    mockNas,
    mockSystemResources,
    mockInterfaces,
    mockWirelessInterfaces,
    mockFirmwareInfo,
} from './test-utils.js';

// Mock RouterOS client
const mockApiWrite = vi.fn();
const mockApiClose = vi.fn();
const mockApiConnect = vi.fn();

vi.mock('routeros-client', () => ({
    RouterOSAPI: vi.fn().mockImplementation(() => ({
        connect: mockApiConnect.mockResolvedValue(undefined),
        write: mockApiWrite,
        close: mockApiClose,
    })),
}));

vi.mock('../lib/logger.js', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

// Import after mocks
import { MikroTikService } from '../services/mikrotik.service.js';

describe('MikroTikService', () => {
    let service: MikroTikService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new MikroTikService();
    });

    afterEach(async () => {
        await service.closeAll();
        vi.resetAllMocks();
    });

    // =============================================
    // Connection Management
    // =============================================
    describe('Connection Management', () => {
        it('should establish connection to router', async () => {
            mockApiWrite.mockResolvedValue([{}]);

            const resources = await service.getSystemResources(mockNas);
            expect(mockApiConnect).toHaveBeenCalled();
        });

        it('should reuse existing connection', async () => {
            mockApiWrite.mockResolvedValue([{}]);

            await service.getSystemResources(mockNas);
            await service.getSystemResources(mockNas);

            // Should only connect once
            expect(mockApiConnect).toHaveBeenCalledTimes(1);
        });

        it('should close all connections on cleanup', async () => {
            mockApiWrite.mockResolvedValue([{}]);
            await service.getSystemResources(mockNas);

            await service.closeAll();

            expect(mockApiClose).toHaveBeenCalled();
        });

        it('should use VPN IP if available', async () => {
            const nasWithVpn = { ...mockNas, vpnIp: '10.10.0.5' };
            mockApiWrite.mockResolvedValue([{}]);

            await service.getSystemResources(nasWithVpn);

            // The service should prefer vpnIp
            expect(mockApiConnect).toHaveBeenCalled();
        });
    });

    // =============================================
    // System Resources
    // =============================================
    describe('getSystemResources', () => {
        it('should return formatted system resources', async () => {
            mockApiWrite.mockImplementation(async (command: string) => {
                if (command === '/system/resource/print') {
                    return [{
                        uptime: '3d12h30m',
                        version: '7.14.1',
                        'build-time': '2025-12-01 12:00:00',
                        'free-memory': '268435456',
                        'total-memory': '536870912',
                        cpu: 'ARM',
                        'cpu-count': '4',
                        'cpu-frequency': '1200',
                        'cpu-load': '15',
                        'free-hdd-space': '67108864',
                        'total-hdd-space': '134217728',
                        'architecture-name': 'arm64',
                        'board-name': 'RB5009UG+S+',
                        platform: 'MikroTik',
                    }];
                }
                if (command === '/system/identity/print') {
                    return [{ name: 'Test Router' }];
                }
                if (command === '/system/routerboard/print') {
                    return [{ 'factory-software': '7.12', model: 'RB5009UG+S+' }];
                }
                return [];
            });

            const resources = await service.getSystemResources(mockNas);

            expect(resources.version).toBe('7.14.1');
            expect(resources.boardName).toBe('RB5009UG+S+');
            expect(resources.cpuLoad).toBe(15);
            expect(resources.freeMemory).toBe(268435456);
            expect(resources.totalMemory).toBe(536870912);
        });

        it('should handle missing routerboard info', async () => {
            mockApiWrite.mockImplementation(async (command: string) => {
                if (command === '/system/resource/print') {
                    return [{ version: '7.14.1', 'board-name': 'CHR' }];
                }
                if (command === '/system/identity/print') {
                    return [{ name: 'CHR Router' }];
                }
                if (command === '/system/routerboard/print') {
                    throw new Error('No routerboard');
                }
                return [];
            });

            const resources = await service.getSystemResources(mockNas);
            expect(resources.boardName).toBe('CHR');
        });
    });

    // =============================================
    // Interface Discovery
    // =============================================
    describe('getInterfaces', () => {
        it('should return interfaces with WAN detection', async () => {
            mockApiWrite.mockImplementation(async (command: string) => {
                if (command === '/interface/print') {
                    return [
                        { '.id': '*1', name: 'ether1', type: 'ether', 'mac-address': '00:11:22:33:44:55', running: 'true', disabled: 'false' },
                        { '.id': '*2', name: 'ether2', type: 'ether', 'mac-address': '00:11:22:33:44:56', running: 'true', disabled: 'false' },
                    ];
                }
                if (command === '/ip/route/print') {
                    return [{ interface: 'ether1', 'dst-address': '0.0.0.0/0' }];
                }
                return [];
            });

            const interfaces = await service.getInterfaces(mockNas);

            expect(interfaces).toHaveLength(2);
            expect(interfaces[0].name).toBe('ether1');
            expect(interfaces[0].isWan).toBe(true);
            expect(interfaces[1].isWan).toBe(false);
        });

        it('should handle disabled interfaces', async () => {
            mockApiWrite.mockImplementation(async (command: string) => {
                if (command === '/interface/print') {
                    return [
                        { '.id': '*1', name: 'ether1', disabled: 'true' },
                        { '.id': '*2', name: 'ether2', disabled: 'false' },
                    ];
                }
                return [];
            });

            const interfaces = await service.getInterfaces(mockNas);
            expect(interfaces[0].disabled).toBe(true);
            expect(interfaces[1].disabled).toBe(false);
        });
    });

    // =============================================
    // Wireless Configuration
    // =============================================
    describe('getWirelessInterfaces', () => {
        it('should return wireless interfaces', async () => {
            mockApiWrite.mockResolvedValue([
                { '.id': '*A1', name: 'wlan1', ssid: 'TestNet', band: '2ghz-b/g/n', frequency: '2437', running: 'true' },
            ]);

            const wireless = await service.getWirelessInterfaces(mockNas);

            expect(wireless).toHaveLength(1);
            expect(wireless[0].name).toBe('wlan1');
            expect(wireless[0].ssid).toBe('TestNet');
        });

        it('should return empty array for wired-only routers', async () => {
            mockApiWrite.mockResolvedValue([]);

            const wireless = await service.getWirelessInterfaces(mockNas);
            expect(wireless).toHaveLength(0);
        });
    });

    describe('configureWireless', () => {
        it('should configure wireless with WPA2', async () => {
            mockApiWrite.mockImplementation(async (command: string) => {
                if (command === '/interface/wireless/print') {
                    return [{ '.id': '*A1', name: 'wlan1' }];
                }
                if (command === '/interface/wireless/security-profiles/print') {
                    return [];
                }
                return [];
            });

            const result = await service.configureWireless(mockNas, {
                interfaceName: 'wlan1',
                ssid: 'NewNetwork',
                securityMode: 'wpa2-psk',
                passphrase: 'securepassword',
            });

            expect(result).toBe(true);
            expect(mockApiWrite).toHaveBeenCalledWith(
                '/interface/wireless/set',
                expect.arrayContaining([expect.stringContaining('ssid=NewNetwork')])
            );
        });

        it('should return false for non-existent interface', async () => {
            mockApiWrite.mockResolvedValue([]);

            const result = await service.configureWireless(mockNas, {
                interfaceName: 'nonexistent',
                ssid: 'Test',
            });

            expect(result).toBe(false);
        });
    });

    // =============================================
    // Firmware Management
    // =============================================
    describe('getFirmwareInfo', () => {
        it('should return firmware information', async () => {
            mockApiWrite.mockImplementation(async (command: string) => {
                if (command === '/system/resource/print') {
                    return [{ version: '7.14.1' }];
                }
                if (command === '/system/package/print') {
                    return [
                        { name: 'routeros', version: '7.14.1', 'build-time': '2025-12-01' },
                        { name: 'system', version: '7.14.1', 'build-time': '2025-12-01' },
                    ];
                }
                if (command === '/system/package/update/print') {
                    return [{ 'latest-version': '7.15', status: 'New version is available', channel: 'stable' }];
                }
                return [];
            });

            const info = await service.getFirmwareInfo(mockNas);

            expect(info.currentVersion).toBe('7.14.1');
            expect(info.latestVersion).toBe('7.15');
            expect(info.updateAvailable).toBe(true);
            expect(info.packages).toHaveLength(2);
        });

        it('should handle no updates available', async () => {
            mockApiWrite.mockImplementation(async (command: string) => {
                if (command === '/system/resource/print') {
                    return [{ version: '7.15' }];
                }
                if (command === '/system/package/print') {
                    return [{ name: 'routeros', version: '7.15' }];
                }
                if (command === '/system/package/update/print') {
                    return [{ 'latest-version': '7.15', status: 'System is already up to date' }];
                }
                return [];
            });

            const info = await service.getFirmwareInfo(mockNas);
            expect(info.updateAvailable).toBe(false);
        });
    });

    describe('checkFirmwareUpdates', () => {
        it('should trigger update check and return result', async () => {
            mockApiWrite.mockImplementation(async (command: string) => {
                if (command === '/system/package/update/check-for-updates') {
                    return [];
                }
                if (command === '/system/package/update/print') {
                    return [{ 'latest-version': '7.15', status: 'New version is available' }];
                }
                if (command === '/system/resource/print') {
                    return [{ version: '7.14.1' }];
                }
                return [];
            });

            const result = await service.checkFirmwareUpdates(mockNas);

            expect(result.available).toBe(true);
            expect(result.currentVersion).toBe('7.14.1');
            expect(result.latestVersion).toBe('7.15');
        });
    });

    describe('updateFirmware', () => {
        it('should download and install update', async () => {
            let downloadCalled = false;
            mockApiWrite.mockImplementation(async (command: string) => {
                if (command === '/system/package/update/print') {
                    return [{
                        status: downloadCalled ? 'Downloaded, please reboot to upgrade' : 'New version is available',
                        'latest-version': '7.15',
                    }];
                }
                if (command === '/system/package/update/download') {
                    downloadCalled = true;
                    return [];
                }
                if (command === '/system/package/update/install') {
                    throw new Error('Socket closed'); // Expected during reboot
                }
                return [];
            });

            const result = await service.updateFirmware(mockNas);

            expect(result.success).toBe(true);
            expect(result.message).toContain('rebooting');
        });

        it('should return false if no update available', async () => {
            mockApiWrite.mockResolvedValue([{ status: 'System is already up to date' }]);

            const result = await service.updateFirmware(mockNas);

            expect(result.success).toBe(false);
            expect(result.message).toContain('No update');
        });
    });

    // =============================================
    // Backup/Restore
    // =============================================
    describe('backupConfig', () => {
        it('should create backup and return name', async () => {
            mockApiWrite.mockResolvedValue([]);

            const backupName = await service.backupConfig(mockNas);

            expect(backupName).toContain('easyisp-backup-');
            expect(mockApiWrite).toHaveBeenCalledWith(
                '/system/backup/save',
                expect.arrayContaining([expect.stringContaining('name=')])
            );
        });
    });

    describe('restoreBackup', () => {
        it('should restore backup (router reboots)', async () => {
            mockApiWrite.mockRejectedValue(new Error('Socket closed'));

            const result = await service.restoreBackup(mockNas, 'easyisp-backup-123');

            // Should return true even with connection error (expected during reboot)
            expect(result).toBe(true);
        });
    });

    // =============================================
    // Hotspot Configuration
    // =============================================
    describe('configureHotspot', () => {
        it('should configure complete hotspot setup', async () => {
            mockApiWrite.mockResolvedValue([]);

            const result = await service.configureHotspot(
                mockNas,
                {
                    interfaces: ['ether2'],
                    gatewayIp: '10.5.50.1',
                    poolStart: '10.5.50.2',
                    poolEnd: '10.5.50.254',
                    dnsServers: ['8.8.8.8', '1.1.1.1'],
                },
                '10.10.0.1',
                'radiussecret'
            );

            expect(result).toBe(true);
            // Verify key commands were called
            expect(mockApiWrite).toHaveBeenCalledWith('/ip/pool/add', expect.any(Array));
            expect(mockApiWrite).toHaveBeenCalledWith('/ip/address/add', expect.any(Array));
        });

        it('should create bridge for multiple interfaces', async () => {
            mockApiWrite.mockResolvedValue([]);

            await service.configureHotspot(
                mockNas,
                {
                    interfaces: ['ether2', 'ether3'],
                    gatewayIp: '10.5.50.1',
                    poolStart: '10.5.50.2',
                    poolEnd: '10.5.50.254',
                    dnsServers: ['8.8.8.8'],
                },
                '10.10.0.1',
                'radiussecret'
            );

            expect(mockApiWrite).toHaveBeenCalledWith('/interface/bridge/add', expect.any(Array));
        });
    });

    // =============================================
    // PPPoE Configuration
    // =============================================
    describe('configurePPPoE', () => {
        it('should configure complete PPPoE setup', async () => {
            mockApiWrite.mockResolvedValue([]);

            const result = await service.configurePPPoE(mockNas, {
                interfaces: ['ether2'],
                serviceName: 'easyisp-pppoe',
                poolStart: '10.10.1.2',
                poolEnd: '10.10.1.254',
                localAddress: '10.10.1.1',
            });

            expect(result).toBe(true);
            expect(mockApiWrite).toHaveBeenCalledWith('/ip/pool/add', expect.any(Array));
            expect(mockApiWrite).toHaveBeenCalledWith('/ppp/profile/add', expect.any(Array));
            expect(mockApiWrite).toHaveBeenCalledWith('/interface/pppoe-server/server/add', expect.any(Array));
        });
    });

    // =============================================
    // Test Configuration
    // =============================================
    describe('testConfiguration', () => {
        it('should check all services', async () => {
            mockApiWrite.mockImplementation(async (command: string) => {
                if (command === '/ip/hotspot/print') return [{ name: 'hotspot1' }];
                if (command === '/interface/pppoe-server/server/print') return [{ name: 'pppoe1' }];
                if (command === '/radius/print') return [{ address: '10.10.0.1' }];
                return [];
            });

            const result = await service.testConfiguration(mockNas);

            expect(result.hotspot).toBe(true);
            expect(result.pppoe).toBe(true);
            expect(result.radius).toBe(true);
        });

        it('should return false for missing services', async () => {
            mockApiWrite.mockResolvedValue([]);

            const result = await service.testConfiguration(mockNas);

            expect(result.hotspot).toBe(false);
            expect(result.pppoe).toBe(false);
            expect(result.radius).toBe(false);
        });
    });

    // =============================================
    // Firewall Configuration
    // =============================================
    describe('configureFirewall', () => {
        it('should add NAT masquerade rule', async () => {
            mockApiWrite.mockResolvedValue([]);

            const result = await service.configureFirewall(mockNas, 'ether1');

            expect(result).toBe(true);
            expect(mockApiWrite).toHaveBeenCalledWith('/ip/firewall/nat/add', expect.arrayContaining([
                '=chain=srcnat',
                '=action=masquerade',
                '=out-interface=ether1',
            ]));
        });

        it('should not duplicate existing NAT rule', async () => {
            mockApiWrite.mockImplementation(async (command: string) => {
                if (command === '/ip/firewall/nat/print') {
                    return [{ chain: 'srcnat', action: 'masquerade', 'out-interface': 'ether1' }];
                }
                return [];
            });

            await service.configureFirewall(mockNas, 'ether1');

            // Should not call add if rule exists
            expect(mockApiWrite).not.toHaveBeenCalledWith('/ip/firewall/nat/add', expect.any(Array));
        });
    });

    // =============================================
    // Session Management
    // =============================================
    describe('getActiveSessions', () => {
        it('should return active PPPoE sessions', async () => {
            mockApiWrite.mockResolvedValue([
                { '.id': '*1', name: 'user1', service: 'pppoe', 'caller-id': '00:11:22:33:44:55', address: '10.10.1.5', uptime: '1h30m' },
            ]);

            const sessions = await service.getActiveSessions(mockNas);

            expect(sessions).toHaveLength(1);
            expect(sessions[0].name).toBe('user1');
            expect(sessions[0].address).toBe('10.10.1.5');
        });
    });

    describe('disconnectUser', () => {
        it('should disconnect user by username', async () => {
            mockApiWrite.mockImplementation(async (command: string) => {
                if (command === '/ppp/active/print') {
                    return [{ '.id': '*1', name: 'user1' }];
                }
                return [];
            });

            const result = await service.disconnectUser(mockNas, 'user1');

            expect(result).toBe(true);
            expect(mockApiWrite).toHaveBeenCalledWith('/ppp/active/remove', expect.any(Array));
        });

        it('should return false for non-existent user', async () => {
            mockApiWrite.mockResolvedValue([]);

            const result = await service.disconnectUser(mockNas, 'nonexistent');

            expect(result).toBe(false);
        });
    });
});
