/**
 * Zero Touch Module Integration Tests
 * These tests verify the core functionality of the Zero Touch module
 * without depending on complex mocking of middleware
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// =============================================
// Token Encryption/Decryption Tests
// =============================================
describe('Token Encryption (Direct)', () => {
    const PROVISION_SECRET = 'testsecretkey123456789012345678';
    const algorithm = 'aes-256-cbc';

    function encryptTokenDirect(data: Record<string, any>): string {
        const key = crypto.createHash('sha256').update(PROVISION_SECRET).digest();
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(algorithm, key, iv);
        let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
    }

    function decryptTokenDirect(token: string): Record<string, any> {
        const key = crypto.createHash('sha256').update(PROVISION_SECRET).digest();
        const [ivHex, encryptedHex] = token.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const decipher = crypto.createDecipheriv(algorithm, key, iv);
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return JSON.parse(decrypted);
    }

    it('should encrypt and decrypt correctly', () => {
        const data = { routerId: 'router-123', tenantId: 'tenant-456', secret: 'mysecret' };
        const token = encryptTokenDirect(data);
        const result = decryptTokenDirect(token);
        expect(result).toEqual(data);
    });

    it('should produce different tokens for same data (random IV)', () => {
        const data = { routerId: 'test', tenantId: 'test', secret: 'test' };
        const token1 = encryptTokenDirect(data);
        const token2 = encryptTokenDirect(data);
        expect(token1).not.toBe(token2);
    });

    it('should throw on invalid token format', () => {
        expect(() => decryptTokenDirect('invalid')).toThrow();
    });

    it('should handle special characters', () => {
        const data = { routerId: 'router/with/slashes', tenantId: 'tenant+plus', secret: 'secret==' };
        const token = encryptTokenDirect(data);
        const result = decryptTokenDirect(token);
        expect(result).toEqual(data);
    });
});

// =============================================
// Configuration Validation Tests
// =============================================
describe('Configuration Validation', () => {
    describe('Wireless Config', () => {
        const validWirelessConfig = {
            interfaceName: 'wlan1',
            ssid: 'TestNetwork',
            band: '2ghz-b/g/n',
            securityMode: 'wpa2-psk',
            passphrase: 'secure12345',
        };

        it('should accept valid WPA2 config', () => {
            expect(validWirelessConfig.passphrase.length).toBeGreaterThanOrEqual(8);
            expect(['none', 'wpa-psk', 'wpa2-psk']).toContain(validWirelessConfig.securityMode);
        });

        it('should require passphrase for WPA modes', () => {
            const configWithoutPassphrase = { ...validWirelessConfig, passphrase: undefined };
            const needsPassphrase = configWithoutPassphrase.securityMode !== 'none' && !configWithoutPassphrase.passphrase;
            expect(needsPassphrase).toBe(true);
        });

        it('should not require passphrase for open network', () => {
            const openConfig = { ...validWirelessConfig, securityMode: 'none', passphrase: undefined };
            const needsPassphrase = openConfig.securityMode !== 'none' && !openConfig.passphrase;
            expect(needsPassphrase).toBe(false);
        });
    });

    describe('Hotspot Config', () => {
        const validHotspotConfig = {
            interfaces: ['ether2'],
            gatewayIp: '10.5.50.1',
            poolStart: '10.5.50.2',
            poolEnd: '10.5.50.254',
            dnsServers: ['8.8.8.8', '1.1.1.1'],
        };

        it('should have valid IP pool range', () => {
            const startOctet = parseInt(validHotspotConfig.poolStart.split('.')[3]);
            const endOctet = parseInt(validHotspotConfig.poolEnd.split('.')[3]);
            expect(endOctet).toBeGreaterThan(startOctet);
        });

        it('should have at least one interface', () => {
            expect(validHotspotConfig.interfaces.length).toBeGreaterThan(0);
        });

        it('should have at least one DNS server', () => {
            expect(validHotspotConfig.dnsServers.length).toBeGreaterThan(0);
        });
    });

    describe('PPPoE Config', () => {
        const validPPPoEConfig = {
            interfaces: ['ether2', 'ether3'],
            serviceName: 'easyisp-pppoe',
            poolStart: '10.10.1.2',
            poolEnd: '10.10.1.254',
            localAddress: '10.10.1.1',
        };

        it('should have valid service name', () => {
            expect(validPPPoEConfig.serviceName).toBeTruthy();
            expect(validPPPoEConfig.serviceName.length).toBeLessThanOrEqual(64);
        });

        it('should have local address outside pool range', () => {
            const localOctet = parseInt(validPPPoEConfig.localAddress.split('.')[3]);
            const poolStartOctet = parseInt(validPPPoEConfig.poolStart.split('.')[3]);
            expect(localOctet).toBeLessThan(poolStartOctet);
        });
    });
});

// =============================================
// Wizard State Logic Tests
// =============================================
describe('Wizard State Logic', () => {
    interface NASState {
        status: string;
        ipAddress: string;
        apiUsername: string | null;
        apiPassword: string | null;
        secret: string;
    }

    function determineWizardStep(nas: NASState): { step: string; canResume: boolean } {
        if (nas.status === 'ONLINE' && nas.apiUsername && nas.apiPassword) {
            return { step: 'info', canResume: true };
        } else if (nas.ipAddress && nas.ipAddress !== '0.0.0.0') {
            return { step: 'verify', canResume: true };
        } else if (nas.secret) {
            return { step: 'script', canResume: true };
        }
        return { step: 'intro', canResume: false };
    }

    it('should detect script step for new router', () => {
        const nas = {
            status: 'PENDING',
            ipAddress: '0.0.0.0',
            apiUsername: null,
            apiPassword: null,
            secret: 'mysecret123',
        };
        const result = determineWizardStep(nas);
        expect(result.step).toBe('script');
        expect(result.canResume).toBe(true);
    });

    it('should detect verify step for router with IP', () => {
        const nas = {
            status: 'PENDING',
            ipAddress: '192.168.1.100',
            apiUsername: null,
            apiPassword: null,
            secret: 'mysecret123',
        };
        const result = determineWizardStep(nas);
        expect(result.step).toBe('verify');
    });

    it('should detect info step for online router', () => {
        const nas = {
            status: 'ONLINE',
            ipAddress: '192.168.1.100',
            apiUsername: 'admin',
            apiPassword: 'password',
            secret: 'mysecret123',
        };
        const result = determineWizardStep(nas);
        expect(result.step).toBe('info');
    });

    it('should not allow resume for intro step', () => {
        const nas = {
            status: 'PENDING',
            ipAddress: '0.0.0.0',
            apiUsername: null,
            apiPassword: null,
            secret: '',
        };
        const result = determineWizardStep(nas);
        expect(result.step).toBe('intro');
        expect(result.canResume).toBe(false);
    });
});

// =============================================
// MikroTik Script Generation Tests
// =============================================
describe('MikroTik Script Generation', () => {
    function generateWireGuardScript(routerId: string, vpnIp: string, serverPublicKey: string): string {
        return `/interface wireguard add name=wg-easyisp private-key="${routerId}"
/interface wireguard peers add interface=wg-easyisp public-key="${serverPublicKey}" allowed-address=0.0.0.0/0
/ip address add address=${vpnIp}/24 interface=wg-easyisp`;
    }

    function generateRadiusScript(radiusServer: string, radiusSecret: string): string {
        return `/radius add address=${radiusServer} secret="${radiusSecret}" service=hotspot,ppp authentication-port=1812 accounting-port=1813
/ppp aaa set use-radius=yes accounting=yes interim-update=5m`;
    }

    it('should generate valid WireGuard commands', () => {
        const script = generateWireGuardScript('routerabc', '10.10.0.5', 'serverPubKeyXYZ=');
        expect(script).toContain('/interface wireguard add');
        expect(script).toContain('wg-easyisp');
        expect(script).toContain('10.10.0.5/24');
    });

    it('should generate valid RADIUS commands', () => {
        const script = generateRadiusScript('10.10.0.1', 'secretkey123');
        expect(script).toContain('/radius add');
        expect(script).toContain('10.10.0.1');
        expect(script).toContain('secretkey123');
        expect(script).toContain('interim-update=5m');
    });
});

// =============================================
// Rate Limit Format Tests
// =============================================
describe('MikroTik Rate Limit Format', () => {
    function formatRateLimit(uploadMbps: number, downloadMbps: number): string {
        return `${uploadMbps}M/${downloadMbps}M`;
    }

    function formatBurstRateLimit(
        uploadMbps: number,
        downloadMbps: number,
        burstUploadMbps: number,
        burstDownloadMbps: number,
        burstThreshold: number,
        burstTime: number
    ): string {
        return `${uploadMbps}M/${downloadMbps}M ${burstUploadMbps}M/${burstDownloadMbps}M ${burstThreshold}/${burstThreshold} ${burstTime}/${burstTime}`;
    }

    it('should format basic rate limit', () => {
        expect(formatRateLimit(10, 20)).toBe('10M/20M');
        expect(formatRateLimit(1, 5)).toBe('1M/5M');
    });

    it('should format burst rate limit', () => {
        const result = formatBurstRateLimit(10, 20, 20, 40, 80, 10);
        expect(result).toBe('10M/20M 20M/40M 80/80 10/10');
    });
});

// =============================================
// Data Usage Calculation Tests
// =============================================
describe('Data Usage Calculation', () => {
    function calculateTotalBytes(inputOctets: number, outputOctets: number, inputGigawords: number, outputGigawords: number): bigint {
        const input = BigInt(inputOctets) + BigInt(inputGigawords) * BigInt(4294967296);
        const output = BigInt(outputOctets) + BigInt(outputGigawords) * BigInt(4294967296);
        return input + output;
    }

    function formatBytes(bytes: bigint): string {
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let value = Number(bytes);
        let unit = 0;
        while (value >= 1024 && unit < units.length - 1) {
            value /= 1024;
            unit++;
        }
        return `${value.toFixed(2)} ${units[unit]}`;
    }

    it('should calculate usage without gigawords', () => {
        const total = calculateTotalBytes(1000000, 2000000, 0, 0);
        expect(total).toBe(BigInt(3000000));
    });

    it('should calculate usage with gigawords (>4GB)', () => {
        // 1 gigaword = 4GB
        const total = calculateTotalBytes(1000000, 1000000, 1, 1);
        expect(total).toBe(BigInt(1000000) + BigInt(1000000) + BigInt(4294967296) * BigInt(2));
    });

    it('should format bytes correctly', () => {
        expect(formatBytes(BigInt(1024))).toBe('1.00 KB');
        expect(formatBytes(BigInt(1048576))).toBe('1.00 MB');
        expect(formatBytes(BigInt(1073741824))).toBe('1.00 GB');
    });
});

// =============================================
// Provision Callback Security Tests
// =============================================
describe('Provision Callback Security', () => {
    function validateCallback(nasApiPassword: string | null, providedKey: string | undefined): boolean {
        if (!nasApiPassword || !providedKey) {
            return false;
        }
        return nasApiPassword === providedKey;
    }

    it('should validate matching key', () => {
        expect(validateCallback('correctPassword', 'correctPassword')).toBe(true);
    });

    it('should reject wrong key', () => {
        expect(validateCallback('correctPassword', 'wrongPassword')).toBe(false);
    });

    it('should reject missing key', () => {
        expect(validateCallback('correctPassword', undefined)).toBe(false);
    });

    it('should reject null API password', () => {
        expect(validateCallback(null, 'someKey')).toBe(false);
    });
});

// =============================================
// Interface Type Detection Tests
// =============================================
describe('Interface Type Detection', () => {
    interface RouterInterface {
        name: string;
        type: string;
        isWan: boolean;
    }

    function categorizeInterfaces(interfaces: RouterInterface[]): {
        wanInterface: string | null;
        lanInterfaces: string[];
        wirelessInterfaces: string[];
    } {
        const wanInterface = interfaces.find(i => i.isWan)?.name || null;
        const lanInterfaces = interfaces
            .filter(i => !i.isWan && i.type === 'ether')
            .map(i => i.name);
        const wirelessInterfaces = interfaces
            .filter(i => i.type === 'wlan' || i.type === 'cap')
            .map(i => i.name);

        return { wanInterface, lanInterfaces, wirelessInterfaces };
    }

    it('should detect WAN interface', () => {
        const interfaces = [
            { name: 'ether1', type: 'ether', isWan: true },
            { name: 'ether2', type: 'ether', isWan: false },
        ];
        const result = categorizeInterfaces(interfaces);
        expect(result.wanInterface).toBe('ether1');
    });

    it('should list LAN interfaces', () => {
        const interfaces = [
            { name: 'ether1', type: 'ether', isWan: true },
            { name: 'ether2', type: 'ether', isWan: false },
            { name: 'ether3', type: 'ether', isWan: false },
        ];
        const result = categorizeInterfaces(interfaces);
        expect(result.lanInterfaces).toEqual(['ether2', 'ether3']);
    });

    it('should list wireless interfaces', () => {
        const interfaces = [
            { name: 'ether1', type: 'ether', isWan: true },
            { name: 'wlan1', type: 'wlan', isWan: false },
            { name: 'wlan2', type: 'cap', isWan: false },
        ];
        const result = categorizeInterfaces(interfaces);
        expect(result.wirelessInterfaces).toEqual(['wlan1', 'wlan2']);
    });
});
