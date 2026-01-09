/**
 * VPN Integration Tests
 * Tests for WireGuard VPN functionality
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// =============================================
// WireGuard Key Generation Tests
// =============================================
describe('WireGuard Key Generation', () => {
    function isValidBase64(str: string): boolean {
        try {
            return Buffer.from(str, 'base64').toString('base64') === str;
        } catch {
            return false;
        }
    }

    function isValidWireGuardKey(key: string): boolean {
        // WireGuard keys are 32 bytes, base64 encoded to 44 characters (with padding =)
        if (!isValidBase64(key)) return false;
        const decoded = Buffer.from(key, 'base64');
        return decoded.length === 32;
    }

    // Simulate key generation (can't actually call wg in test environment)
    function generateMockKeys(): { privateKey: string; publicKey: string } {
        const privateKey = crypto.randomBytes(32).toString('base64');
        // In real WireGuard, public key is derived from private key using Curve25519
        // Here we just mock it
        const publicKey = crypto.randomBytes(32).toString('base64');
        return { privateKey, publicKey };
    }

    it('should generate 32-byte base64 encoded private key', () => {
        const keys = generateMockKeys();
        expect(isValidWireGuardKey(keys.privateKey)).toBe(true);
    });

    it('should generate 32-byte base64 encoded public key', () => {
        const keys = generateMockKeys();
        expect(isValidWireGuardKey(keys.publicKey)).toBe(true);
    });

    it('should generate unique keys each time', () => {
        const keys1 = generateMockKeys();
        const keys2 = generateMockKeys();
        expect(keys1.privateKey).not.toBe(keys2.privateKey);
        expect(keys1.publicKey).not.toBe(keys2.publicKey);
    });

    it('should produce keys of correct length (44 chars with padding)', () => {
        const keys = generateMockKeys();
        expect(keys.privateKey.length).toBe(44); // 32 bytes = 44 base64 chars
        expect(keys.publicKey.length).toBe(44);
    });
});

// =============================================
// IP Pool Allocation Tests
// =============================================
describe('VPN IP Pool Allocation', () => {
    function allocateIp(usedIps: Set<string>): string | null {
        // 10.10.x.x range, skip .1 (server)
        for (let i = 0; i <= 255; i++) {
            for (let j = 2; j <= 254; j++) {
                const ip = `10.10.${i}.${j}`;
                if (!usedIps.has(ip)) {
                    return `${ip}/32`;
                }
            }
        }
        return null; // Pool exhausted
    }

    function ipToNumber(ip: string): number {
        const parts = ip.split('/')[0].split('.').map(Number);
        return (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
    }

    it('should allocate first IP as 10.10.0.2/32', () => {
        const usedIps = new Set<string>();
        const ip = allocateIp(usedIps);
        expect(ip).toBe('10.10.0.2/32');
    });

    it('should allocate sequential IPs', () => {
        const usedIps = new Set<string>(['10.10.0.2']);
        const ip = allocateIp(usedIps);
        expect(ip).toBe('10.10.0.3/32');
    });

    it('should skip used IPs and find gaps', () => {
        const usedIps = new Set<string>(['10.10.0.2', '10.10.0.3', '10.10.0.5']);
        const ip = allocateIp(usedIps);
        expect(ip).toBe('10.10.0.4/32'); // Finds the gap
    });

    it('should move to next /24 block', () => {
        const usedIps = new Set<string>();
        for (let i = 2; i <= 254; i++) {
            usedIps.add(`10.10.0.${i}`);
        }
        const ip = allocateIp(usedIps);
        expect(ip).toBe('10.10.1.2/32');
    });

    it('should never allocate server IP (.1)', () => {
        const usedIps = new Set<string>();
        for (let i = 0; i < 1000; i++) {
            const ip = allocateIp(usedIps);
            if (ip) {
                usedIps.add(ip.split('/')[0]);
                expect(ip).not.toContain('.1/32');
            }
        }
    });

    it('should calculate correct IP numbers', () => {
        expect(ipToNumber('10.10.0.2')).toBe(168427522);
        expect(ipToNumber('10.10.0.1')).toBe(168427521);
        expect(ipToNumber('10.10.1.2')).toBe(168427778);
    });
});

// =============================================
// WireGuard Config Generation Tests
// =============================================
describe('WireGuard Config Generation', () => {
    interface ConfigOptions {
        privateKey: string;
        assignedIp: string;
        dns: string;
        serverPublicKey: string;
        serverEndpoint: string;
        allowedIps: string;
        persistentKeepalive: number;
    }

    function generateConfig(options: ConfigOptions): string {
        return `[Interface]
PrivateKey = ${options.privateKey}
Address = ${options.assignedIp}
DNS = ${options.dns}

[Peer]
PublicKey = ${options.serverPublicKey}
Endpoint = ${options.serverEndpoint}
AllowedIPs = ${options.allowedIps}
PersistentKeepalive = ${options.persistentKeepalive}
`;
    }

    const testOptions: ConfigOptions = {
        privateKey: 'wJvkKcGjJ2qLGhQb3Z7E5pS8T9H+R4Y6X1A/K0D=',
        assignedIp: '10.10.0.5/32',
        dns: '1.1.1.1',
        serverPublicKey: 'VCnoAMcYMtfDGcBKHatyKjuA8ZBP7onHrWG8kQcXxkY=',
        serverEndpoint: 'vpn.example.com:51820',
        allowedIps: '0.0.0.0/0',
        persistentKeepalive: 25,
    };

    it('should include [Interface] section', () => {
        const config = generateConfig(testOptions);
        expect(config).toContain('[Interface]');
    });

    it('should include [Peer] section', () => {
        const config = generateConfig(testOptions);
        expect(config).toContain('[Peer]');
    });

    it('should include private key in Interface section', () => {
        const config = generateConfig(testOptions);
        expect(config).toContain(`PrivateKey = ${testOptions.privateKey}`);
    });

    it('should include assigned IP address', () => {
        const config = generateConfig(testOptions);
        expect(config).toContain(`Address = ${testOptions.assignedIp}`);
    });

    it('should include DNS server', () => {
        const config = generateConfig(testOptions);
        expect(config).toContain(`DNS = ${testOptions.dns}`);
    });

    it('should include server public key', () => {
        const config = generateConfig(testOptions);
        expect(config).toContain(`PublicKey = ${testOptions.serverPublicKey}`);
    });

    it('should include server endpoint', () => {
        const config = generateConfig(testOptions);
        expect(config).toContain(`Endpoint = ${testOptions.serverEndpoint}`);
    });

    it('should include allowed IPs', () => {
        const config = generateConfig(testOptions);
        expect(config).toContain(`AllowedIPs = ${testOptions.allowedIps}`);
    });

    it('should include persistent keepalive', () => {
        const config = generateConfig(testOptions);
        expect(config).toContain(`PersistentKeepalive = ${testOptions.persistentKeepalive}`);
    });

    it('should generate valid WireGuard config format', () => {
        const config = generateConfig(testOptions);
        const lines = config.split('\n');

        // Check structure
        const interfaceIndex = lines.findIndex(l => l === '[Interface]');
        const peerIndex = lines.findIndex(l => l === '[Peer]');

        expect(interfaceIndex).toBeGreaterThanOrEqual(0);
        expect(peerIndex).toBeGreaterThan(interfaceIndex);
    });
});

// =============================================
// Peer Status Management Tests
// =============================================
describe('VPN Peer Status Management', () => {
    type PeerStatus = 'ACTIVE' | 'DISABLED';

    interface VPNPeer {
        id: string;
        name: string;
        publicKey: string;
        status: PeerStatus;
    }

    function togglePeerStatus(peer: VPNPeer): PeerStatus {
        return peer.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    }

    it('should toggle ACTIVE to DISABLED', () => {
        const peer: VPNPeer = {
            id: '1',
            name: 'Test Peer',
            publicKey: 'abc123',
            status: 'ACTIVE',
        };
        expect(togglePeerStatus(peer)).toBe('DISABLED');
    });

    it('should toggle DISABLED to ACTIVE', () => {
        const peer: VPNPeer = {
            id: '1',
            name: 'Test Peer',
            publicKey: 'abc123',
            status: 'DISABLED',
        };
        expect(togglePeerStatus(peer)).toBe('ACTIVE');
    });
});

// =============================================
// WireGuard Server Stats Parsing Tests
// =============================================
describe('WireGuard Server Stats Parsing', () => {
    // wg show wg0 dump format:
    // public_key\tpreshared_key\tendpoint\tallowed_ips\tlatest_handshake\trx_bytes\ttx_bytes\tkeepalive

    function parseWgDump(dump: string): Map<string, { lastHandshake: Date | null; rxBytes: bigint; txBytes: bigint }> {
        const stats = new Map<string, { lastHandshake: Date | null; rxBytes: bigint; txBytes: bigint }>();
        const lines = dump.trim().split('\n');

        // Skip first line (interface info)
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split('\t');
            if (parts.length >= 8) {
                const publicKey = parts[0];
                const lastHandshakeEpoch = parseInt(parts[4] || '0');
                const rxBytes = BigInt(parts[5] || '0');
                const txBytes = BigInt(parts[6] || '0');

                stats.set(publicKey, {
                    lastHandshake: lastHandshakeEpoch > 0 ? new Date(lastHandshakeEpoch * 1000) : null,
                    rxBytes,
                    txBytes,
                });
            }
        }

        return stats;
    }

    const sampleDump = `wg0\tSHqroU8jMMVOSuOXAkloY4Z3wMGhEJGyKXX9xgRnfFk=\t(none)\t51820\toff
VCnoAMcYMtfDGcBKHatyKjuA8ZBP7onHrWG8kQcXxkY=\t(none)\t192.168.1.100:51821\t10.10.0.5/32\t1704456000\t1073741824\t536870912\t25
XYZabc123456789012345678901234567890123456=\t(none)\t192.168.1.101:51821\t10.10.0.6/32\t0\t0\t0\t25`;

    it('should parse peer public key', () => {
        const stats = parseWgDump(sampleDump);
        expect(stats.has('VCnoAMcYMtfDGcBKHatyKjuA8ZBP7onHrWG8kQcXxkY=')).toBe(true);
    });

    it('should parse last handshake timestamp', () => {
        const stats = parseWgDump(sampleDump);
        const peer = stats.get('VCnoAMcYMtfDGcBKHatyKjuA8ZBP7onHrWG8kQcXxkY=');
        expect(peer?.lastHandshake).toBeInstanceOf(Date);
        expect(peer?.lastHandshake?.getTime()).toBe(1704456000000);
    });

    it('should parse rx bytes', () => {
        const stats = parseWgDump(sampleDump);
        const peer = stats.get('VCnoAMcYMtfDGcBKHatyKjuA8ZBP7onHrWG8kQcXxkY=');
        expect(peer?.rxBytes).toBe(BigInt(1073741824)); // 1GB
    });

    it('should parse tx bytes', () => {
        const stats = parseWgDump(sampleDump);
        const peer = stats.get('VCnoAMcYMtfDGcBKHatyKjuA8ZBP7onHrWG8kQcXxkY=');
        expect(peer?.txBytes).toBe(BigInt(536870912)); // 512MB
    });

    it('should handle peer with no handshake', () => {
        const stats = parseWgDump(sampleDump);
        const peer = stats.get('XYZabc123456789012345678901234567890123456=');
        expect(peer?.lastHandshake).toBeNull();
    });

    it('should handle peer with zero bytes', () => {
        const stats = parseWgDump(sampleDump);
        const peer = stats.get('XYZabc123456789012345678901234567890123456=');
        expect(peer?.rxBytes).toBe(BigInt(0));
        expect(peer?.txBytes).toBe(BigInt(0));
    });

    it('should parse multiple peers', () => {
        const stats = parseWgDump(sampleDump);
        expect(stats.size).toBe(2);
    });
});

// =============================================
// Data Transfer Formatting Tests
// =============================================
describe('Data Transfer Formatting', () => {
    function formatBytes(bytes: bigint): string {
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let value = Number(bytes);
        let unitIndex = 0;

        while (value >= 1024 && unitIndex < units.length - 1) {
            value /= 1024;
            unitIndex++;
        }

        return `${value.toFixed(2)} ${units[unitIndex]}`;
    }

    it('should format bytes', () => {
        expect(formatBytes(BigInt(512))).toBe('512.00 B');
    });

    it('should format kilobytes', () => {
        expect(formatBytes(BigInt(1024))).toBe('1.00 KB');
    });

    it('should format megabytes', () => {
        expect(formatBytes(BigInt(1048576))).toBe('1.00 MB');
    });

    it('should format gigabytes', () => {
        expect(formatBytes(BigInt(1073741824))).toBe('1.00 GB');
    });

    it('should format terabytes', () => {
        expect(formatBytes(BigInt(1099511627776))).toBe('1.00 TB');
    });

    it('should handle large values', () => {
        expect(formatBytes(BigInt('10995116277760'))).toBe('10.00 TB');
    });
});

// =============================================
// VPN Peer Validation Tests
// =============================================
describe('VPN Peer Validation', () => {
    interface CreatePeerInput {
        name: string;
        customerId?: string;
        allowedIps?: string;
        persistentKeepalive?: number;
    }

    function validatePeerInput(input: CreatePeerInput): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!input.name || input.name.trim().length === 0) {
            errors.push('Name is required');
        }

        if (input.name && input.name.length > 100) {
            errors.push('Name too long (max 100 characters)');
        }

        if (input.allowedIps) {
            // Basic CIDR validation
            const cidrPattern = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
            if (!cidrPattern.test(input.allowedIps) && input.allowedIps !== '0.0.0.0/0') {
                errors.push('Invalid allowed IPs format');
            }
        }

        if (input.persistentKeepalive !== undefined) {
            if (input.persistentKeepalive < 0 || input.persistentKeepalive > 65535) {
                errors.push('Persistent keepalive must be 0-65535');
            }
        }

        if (input.customerId !== undefined) {
            // Basic UUID validation
            const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidPattern.test(input.customerId)) {
                errors.push('Invalid customer ID format');
            }
        }

        return { valid: errors.length === 0, errors };
    }

    it('should accept valid input', () => {
        const result = validatePeerInput({ name: 'Test Peer' });
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('should reject empty name', () => {
        const result = validatePeerInput({ name: '' });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Name is required');
    });

    it('should accept valid CIDR', () => {
        const result = validatePeerInput({ name: 'Test', allowedIps: '10.0.0.0/24' });
        expect(result.valid).toBe(true);
    });

    it('should accept 0.0.0.0/0', () => {
        const result = validatePeerInput({ name: 'Test', allowedIps: '0.0.0.0/0' });
        expect(result.valid).toBe(true);
    });

    it('should reject invalid keepalive', () => {
        const result = validatePeerInput({ name: 'Test', persistentKeepalive: 70000 });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Persistent keepalive must be 0-65535');
    });

    it('should accept valid UUID', () => {
        const result = validatePeerInput({
            name: 'Test',
            customerId: '550e8400-e29b-41d4-a716-446655440000',
        });
        expect(result.valid).toBe(true);
    });

    it('should reject invalid UUID', () => {
        const result = validatePeerInput({ name: 'Test', customerId: 'invalid' });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Invalid customer ID format');
    });
});

// =============================================
// Router VPN Provisioning Tests
// =============================================
describe('Router VPN Provisioning', () => {
    interface RouterVpnConfig {
        vpnIp: string;
        vpnPrivateKey: string;
        vpnPublicKey: string;
        serverPublicKey: string;
        serverEndpoint: string;
    }

    function generateRouterOsScript(config: RouterVpnConfig): string {
        const [host, port] = config.serverEndpoint.split(':');

        return `/interface wireguard add name=wg-easyisp mtu=1420 private-key="${config.vpnPrivateKey}"
/interface wireguard peers add interface=wg-easyisp public-key="${config.serverPublicKey}" endpoint-address=${host} endpoint-port=${port} allowed-address=10.10.0.0/16 persistent-keepalive=25s
/ip address add address=${config.vpnIp}/32 interface=wg-easyisp network=10.10.0.0
/ip route add dst-address=10.10.0.0/16 gateway=wg-easyisp`;
    }

    const testConfig: RouterVpnConfig = {
        vpnIp: '10.10.0.5',
        vpnPrivateKey: 'wJvkKcGjJ2qLGhQb3Z7E5pS8T9H+R4Y6X1A/K0D=',
        vpnPublicKey: 'ABCdef123456789012345678901234567890123=',
        serverPublicKey: 'VCnoAMcYMtfDGcBKHatyKjuA8ZBP7onHrWG8kQcXxkY=',
        serverEndpoint: '113.30.190.52:51820',
    };

    it('should create WireGuard interface', () => {
        const script = generateRouterOsScript(testConfig);
        expect(script).toContain('/interface wireguard add name=wg-easyisp');
    });

    it('should include private key', () => {
        const script = generateRouterOsScript(testConfig);
        expect(script).toContain(`private-key="${testConfig.vpnPrivateKey}"`);
    });

    it('should add server as peer', () => {
        const script = generateRouterOsScript(testConfig);
        expect(script).toContain('/interface wireguard peers add');
        expect(script).toContain(`public-key="${testConfig.serverPublicKey}"`);
    });

    it('should configure endpoint', () => {
        const script = generateRouterOsScript(testConfig);
        expect(script).toContain('endpoint-address=113.30.190.52');
        expect(script).toContain('endpoint-port=51820');
    });

    it('should add IP address', () => {
        const script = generateRouterOsScript(testConfig);
        expect(script).toContain(`/ip address add address=${testConfig.vpnIp}/32`);
    });

    it('should add route to VPN network', () => {
        const script = generateRouterOsScript(testConfig);
        expect(script).toContain('/ip route add dst-address=10.10.0.0/16 gateway=wg-easyisp');
    });

    it('should set persistent keepalive', () => {
        const script = generateRouterOsScript(testConfig);
        expect(script).toContain('persistent-keepalive=25s');
    });
});

// =============================================
// WireGuard Server Commands Tests
// =============================================
describe('WireGuard Server Commands', () => {
    function buildAddPeerCommand(iface: string, publicKey: string, allowedIps: string): string {
        return `sudo wg set ${iface} peer ${publicKey} allowed-ips ${allowedIps}`;
    }

    function buildRemovePeerCommand(iface: string, publicKey: string): string {
        return `sudo wg set ${iface} peer ${publicKey} remove`;
    }

    it('should build add peer command', () => {
        const cmd = buildAddPeerCommand('wg0', 'ABC123=', '10.10.0.5/32');
        expect(cmd).toBe('sudo wg set wg0 peer ABC123= allowed-ips 10.10.0.5/32');
    });

    it('should build remove peer command', () => {
        const cmd = buildRemovePeerCommand('wg0', 'ABC123=');
        expect(cmd).toBe('sudo wg set wg0 peer ABC123= remove');
    });

    it('should handle special characters in public key', () => {
        const pubKey = 'VCnoAMcYMtfDGcBKHatyKjuA8ZBP7onHrWG8kQcXxkY=';
        const cmd = buildAddPeerCommand('wg0', pubKey, '10.10.0.5/32');
        expect(cmd).toContain(pubKey);
    });
});
