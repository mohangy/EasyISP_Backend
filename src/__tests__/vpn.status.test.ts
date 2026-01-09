/**
 * VPN Status Monitoring Tests
 * Tests for router online/offline status based on WireGuard handshakes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================
// WireGuard Dump Parsing Tests
// =============================================
describe('WireGuard Dump Parsing', () => {
    interface VpnPeerInfo {
        publicKey: string;
        endpoint: string | null;
        allowedIps: string;
        lastHandshake: Date | null;
        rxBytes: bigint;
        txBytes: bigint;
        isConnected: boolean;
    }

    const HANDSHAKE_TIMEOUT_SECONDS = 180;

    function parseWgDump(dump: string): Map<string, VpnPeerInfo> {
        const peers = new Map<string, VpnPeerInfo>();
        const lines = dump.trim().split('\n');

        // Skip first line (interface info), parse peer lines
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split('\t');
            if (parts.length >= 7) {
                const publicKey = parts[0];
                const endpoint = parts[2] !== '(none)' ? parts[2] : null;
                const allowedIps = parts[3];
                const lastHandshakeEpoch = parseInt(parts[4] || '0');
                const rxBytes = BigInt(parts[5] || '0');
                const txBytes = BigInt(parts[6] || '0');

                const lastHandshake = lastHandshakeEpoch > 0
                    ? new Date(lastHandshakeEpoch * 1000)
                    : null;

                const isConnected = lastHandshake !== null &&
                    (Date.now() - lastHandshake.getTime()) < (HANDSHAKE_TIMEOUT_SECONDS * 1000);

                peers.set(publicKey, {
                    publicKey,
                    endpoint,
                    allowedIps,
                    lastHandshake,
                    rxBytes,
                    txBytes,
                    isConnected,
                });
            }
        }

        return peers;
    }

    const sampleDump = `wg0\tSHqroU8jMMVOSuOXAkloY4Z3wMGhEJGyKXX9xgRnfFk=\t(none)\t51820\toff
VCnoAMcYMtfDGcBKHatyKjuA8ZBP7onHrWG8kQcXxkY=\t(none)\t192.168.1.100:51821\t10.10.0.5/32\t${Math.floor(Date.now() / 1000) - 60}\t1073741824\t536870912\t25
XYZabc123456789012345678901234567890123456=\t(none)\t(none)\t10.10.0.6/32\t0\t0\t0\t25`;

    it('should parse peer with recent handshake as connected', () => {
        const peers = parseWgDump(sampleDump);
        const peer = peers.get('VCnoAMcYMtfDGcBKHatyKjuA8ZBP7onHrWG8kQcXxkY=');
        expect(peer?.isConnected).toBe(true);
    });

    it('should parse peer with no handshake as disconnected', () => {
        const peers = parseWgDump(sampleDump);
        const peer = peers.get('XYZabc123456789012345678901234567890123456=');
        expect(peer?.isConnected).toBe(false);
    });

    it('should parse endpoint address', () => {
        const peers = parseWgDump(sampleDump);
        const peer = peers.get('VCnoAMcYMtfDGcBKHatyKjuA8ZBP7onHrWG8kQcXxkY=');
        expect(peer?.endpoint).toBe('192.168.1.100:51821');
    });

    it('should parse null endpoint for disconnected peer', () => {
        const peers = parseWgDump(sampleDump);
        const peer = peers.get('XYZabc123456789012345678901234567890123456=');
        expect(peer?.endpoint).toBeNull();
    });

    it('should parse allowed IPs', () => {
        const peers = parseWgDump(sampleDump);
        const peer = peers.get('VCnoAMcYMtfDGcBKHatyKjuA8ZBP7onHrWG8kQcXxkY=');
        expect(peer?.allowedIps).toBe('10.10.0.5/32');
    });

    it('should parse bytes received', () => {
        const peers = parseWgDump(sampleDump);
        const peer = peers.get('VCnoAMcYMtfDGcBKHatyKjuA8ZBP7onHrWG8kQcXxkY=');
        expect(peer?.rxBytes).toBe(BigInt(1073741824));
    });

    it('should parse bytes sent', () => {
        const peers = parseWgDump(sampleDump);
        const peer = peers.get('VCnoAMcYMtfDGcBKHatyKjuA8ZBP7onHrWG8kQcXxkY=');
        expect(peer?.txBytes).toBe(BigInt(536870912));
    });
});

// =============================================
// Handshake Timeout Tests
// =============================================
describe('Handshake Timeout Detection', () => {
    const TIMEOUT_MS = 180000; // 3 minutes

    function isConnectionActive(lastHandshake: Date | null): boolean {
        if (!lastHandshake) return false;
        return (Date.now() - lastHandshake.getTime()) < TIMEOUT_MS;
    }

    it('should consider recent handshake as active', () => {
        const recent = new Date(Date.now() - 60000); // 1 minute ago
        expect(isConnectionActive(recent)).toBe(true);
    });

    it('should consider old handshake as inactive', () => {
        const old = new Date(Date.now() - 300000); // 5 minutes ago
        expect(isConnectionActive(old)).toBe(false);
    });

    it('should consider null handshake as inactive', () => {
        expect(isConnectionActive(null)).toBe(false);
    });

    it('should handle handshake exactly at timeout', () => {
        const atTimeout = new Date(Date.now() - TIMEOUT_MS);
        expect(isConnectionActive(atTimeout)).toBe(false);
    });

    it('should handle handshake just before timeout', () => {
        const justBefore = new Date(Date.now() - TIMEOUT_MS + 1000);
        expect(isConnectionActive(justBefore)).toBe(true);
    });
});

// =============================================
// Duration Formatting Tests
// =============================================
describe('Duration Formatting', () => {
    function formatDuration(milliseconds: number): string {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) {
            return `${days}d ${hours % 24}h ${minutes % 60}m`;
        } else if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    it('should format seconds', () => {
        expect(formatDuration(45000)).toBe('45s');
    });

    it('should format minutes and seconds', () => {
        expect(formatDuration(125000)).toBe('2m 5s');
    });

    it('should format hours and minutes', () => {
        expect(formatDuration(3665000)).toBe('1h 1m');
    });

    it('should format days, hours, and minutes', () => {
        expect(formatDuration(90061000)).toBe('1d 1h 1m');
    });

    it('should format exact hour', () => {
        expect(formatDuration(3600000)).toBe('1h 0m');
    });

    it('should format zero', () => {
        expect(formatDuration(0)).toBe('0s');
    });

    it('should format large durations', () => {
        expect(formatDuration(86400000 * 7)).toBe('7d 0h 0m'); // 1 week
    });
});

// =============================================
// NAS Status State Machine Tests
// =============================================
describe('NAS Status State Machine', () => {
    type NasStatus = 'ONLINE' | 'OFFLINE' | 'PENDING';

    interface NasState {
        status: NasStatus;
        lastSeen: Date | null;
        isConnected: boolean;
    }

    function calculateNewStatus(
        currentStatus: NasStatus,
        isConnected: boolean
    ): NasStatus {
        if (isConnected) {
            return 'ONLINE';
        } else if (currentStatus === 'PENDING') {
            return 'PENDING';
        } else {
            return 'OFFLINE';
        }
    }

    it('should transition to ONLINE when connected', () => {
        expect(calculateNewStatus('OFFLINE', true)).toBe('ONLINE');
        expect(calculateNewStatus('PENDING', true)).toBe('ONLINE');
        expect(calculateNewStatus('ONLINE', true)).toBe('ONLINE');
    });

    it('should transition to OFFLINE when disconnected', () => {
        expect(calculateNewStatus('ONLINE', false)).toBe('OFFLINE');
    });

    it('should stay PENDING when not yet connected', () => {
        expect(calculateNewStatus('PENDING', false)).toBe('PENDING');
    });

    it('should stay OFFLINE when already offline', () => {
        expect(calculateNewStatus('OFFLINE', false)).toBe('OFFLINE');
    });
});

// =============================================
// Uptime and Offline Duration Tests
// =============================================
describe('Uptime and Offline Duration', () => {
    interface StatusInfo {
        isConnected: boolean;
        lastHandshake: Date | null;
        lastSeen: Date | null;
    }

    function formatDuration(ms: number): string {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const h = Math.floor(m / 60);
        const d = Math.floor(h / 24);

        if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
        if (h > 0) return `${h}h ${m % 60}m`;
        if (m > 0) return `${m}m ${s % 60}s`;
        return `${s}s`;
    }

    function calculateUptime(info: StatusInfo): string | null {
        if (info.isConnected && info.lastHandshake) {
            return formatDuration(Date.now() - info.lastHandshake.getTime());
        }
        return null;
    }

    function calculateOfflineDuration(info: StatusInfo): string | null {
        if (!info.isConnected && info.lastSeen) {
            return formatDuration(Date.now() - info.lastSeen.getTime());
        }
        return null;
    }

    it('should calculate uptime for connected router', () => {
        const info: StatusInfo = {
            isConnected: true,
            lastHandshake: new Date(Date.now() - 3600000), // 1 hour ago
            lastSeen: new Date(),
        };
        expect(calculateUptime(info)).toBe('1h 0m');
    });

    it('should return null uptime for disconnected router', () => {
        const info: StatusInfo = {
            isConnected: false,
            lastHandshake: null,
            lastSeen: new Date(),
        };
        expect(calculateUptime(info)).toBeNull();
    });

    it('should calculate offline duration for disconnected router', () => {
        const info: StatusInfo = {
            isConnected: false,
            lastHandshake: null,
            lastSeen: new Date(Date.now() - 7200000), // 2 hours ago
        };
        expect(calculateOfflineDuration(info)).toBe('2h 0m');
    });

    it('should return null offline duration for connected router', () => {
        const info: StatusInfo = {
            isConnected: true,
            lastHandshake: new Date(),
            lastSeen: new Date(),
        };
        expect(calculateOfflineDuration(info)).toBeNull();
    });
});

// =============================================
// VPN IP to Peer Matching Tests
// =============================================
describe('VPN IP to Peer Matching', () => {
    interface Peer {
        publicKey: string;
        allowedIps: string;
    }

    function findPeerByVpnIp(peers: Map<string, Peer>, vpnIp: string): Peer | null {
        for (const [_, peer] of peers) {
            if (peer.allowedIps.includes(vpnIp)) {
                return peer;
            }
        }
        return null;
    }

    it('should find peer by exact IP', () => {
        const peers = new Map<string, Peer>([
            ['key1', { publicKey: 'key1', allowedIps: '10.10.0.5/32' }],
            ['key2', { publicKey: 'key2', allowedIps: '10.10.0.6/32' }],
        ]);

        const found = findPeerByVpnIp(peers, '10.10.0.5');
        expect(found?.publicKey).toBe('key1');
    });

    it('should find peer by IP in allowed-ips string', () => {
        const peers = new Map<string, Peer>([
            ['key1', { publicKey: 'key1', allowedIps: '10.10.0.5/32,10.10.0.0/24' }],
        ]);

        // The simple includes check matches the IP in the allowed-ips string
        const found = findPeerByVpnIp(peers, '10.10.0.5');
        expect(found?.publicKey).toBe('key1');
    });

    it('should return null for unknown IP', () => {
        const peers = new Map<string, Peer>([
            ['key1', { publicKey: 'key1', allowedIps: '10.10.0.5/32' }],
        ]);

        const found = findPeerByVpnIp(peers, '10.10.0.99');
        expect(found).toBeNull();
    });
});

// =============================================
// Status Summary Tests
// =============================================
describe('Status Summary', () => {
    interface NasStatus {
        nasId: string;
        isConnected: boolean;
        status: 'ONLINE' | 'OFFLINE' | 'PENDING';
    }

    function calculateSummary(statuses: NasStatus[]): {
        total: number;
        online: number;
        offline: number;
        pending: number;
    } {
        return {
            total: statuses.length,
            online: statuses.filter(s => s.isConnected).length,
            offline: statuses.filter(s => !s.isConnected && s.status !== 'PENDING').length,
            pending: statuses.filter(s => s.status === 'PENDING').length,
        };
    }

    it('should calculate summary correctly', () => {
        const statuses: NasStatus[] = [
            { nasId: '1', isConnected: true, status: 'ONLINE' },
            { nasId: '2', isConnected: true, status: 'ONLINE' },
            { nasId: '3', isConnected: false, status: 'OFFLINE' },
            { nasId: '4', isConnected: false, status: 'PENDING' },
        ];

        const summary = calculateSummary(statuses);
        expect(summary.total).toBe(4);
        expect(summary.online).toBe(2);
        expect(summary.offline).toBe(1);
        expect(summary.pending).toBe(1);
    });

    it('should handle all online', () => {
        const statuses: NasStatus[] = [
            { nasId: '1', isConnected: true, status: 'ONLINE' },
            { nasId: '2', isConnected: true, status: 'ONLINE' },
        ];

        const summary = calculateSummary(statuses);
        expect(summary.online).toBe(2);
        expect(summary.offline).toBe(0);
    });

    it('should handle all offline', () => {
        const statuses: NasStatus[] = [
            { nasId: '1', isConnected: false, status: 'OFFLINE' },
            { nasId: '2', isConnected: false, status: 'OFFLINE' },
        ];

        const summary = calculateSummary(statuses);
        expect(summary.online).toBe(0);
        expect(summary.offline).toBe(2);
    });

    it('should handle empty list', () => {
        const summary = calculateSummary([]);
        expect(summary.total).toBe(0);
        expect(summary.online).toBe(0);
        expect(summary.offline).toBe(0);
        expect(summary.pending).toBe(0);
    });
});

// =============================================
// Monitor Interval Tests
// =============================================
describe('Monitor Interval Management', () => {
    let monitorInterval: ReturnType<typeof setInterval> | null = null;
    const INTERVAL_MS = 60000;

    function startMonitor(): void {
        if (monitorInterval) return;
        monitorInterval = setInterval(() => { }, INTERVAL_MS);
    }

    function stopMonitor(): void {
        if (monitorInterval) {
            clearInterval(monitorInterval);
            monitorInterval = null;
        }
    }

    function isMonitorRunning(): boolean {
        return monitorInterval !== null;
    }

    beforeEach(() => {
        stopMonitor();
    });

    it('should start monitor', () => {
        startMonitor();
        expect(isMonitorRunning()).toBe(true);
        stopMonitor();
    });

    it('should stop monitor', () => {
        startMonitor();
        stopMonitor();
        expect(isMonitorRunning()).toBe(false);
    });

    it('should not start duplicate monitor', () => {
        startMonitor();
        const firstInterval = monitorInterval;
        startMonitor();
        expect(monitorInterval).toBe(firstInterval);
        stopMonitor();
    });
});
