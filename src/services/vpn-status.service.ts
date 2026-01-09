/**
 * VPN Status Monitor Service
 * Monitors WireGuard connection status for routers and updates their online/offline state
 */

import { execSync } from 'child_process';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

// Configuration
const WG_INTERFACE = process.env['WG_INTERFACE'] ?? 'wg0';
const HANDSHAKE_TIMEOUT_SECONDS = 180; // Consider offline if no handshake in 3 minutes
const MONITOR_INTERVAL_MS = 60000; // Check every 60 seconds

export interface VpnPeerInfo {
    publicKey: string;
    endpoint: string | null;
    allowedIps: string;
    lastHandshake: Date | null;
    rxBytes: bigint;
    txBytes: bigint;
    isConnected: boolean;
}

export interface NasVpnStatus {
    nasId: string;
    nasName: string;
    vpnIp: string;
    status: 'ONLINE' | 'OFFLINE' | 'PENDING';
    isConnected: boolean;
    lastHandshake: Date | null;
    uptime: string | null;
    offlineDuration: string | null;
    lastSeen: Date | null;
    bytesReceived: bigint;
    bytesSent: bigint;
}

/**
 * Parse WireGuard dump output to get peer info
 */
export function parseWireGuardDump(): Map<string, VpnPeerInfo> {
    const peers = new Map<string, VpnPeerInfo>();

    try {
        const output = execSync(`wg show ${WG_INTERFACE} dump`).toString();
        const lines = output.trim().split('\n');

        // Skip first line (interface info), parse peer lines
        // Format: public_key preshared endpoint allowed-ips latest-handshake rx-bytes tx-bytes keepalive
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

                // Consider connected if handshake within timeout
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
    } catch (error) {
        logger.error({ error }, 'Failed to parse WireGuard dump');
    }

    return peers;
}

/**
 * Get VPN peer info by VPN IP
 */
export function getPeerInfoByVpnIp(vpnIp: string): VpnPeerInfo | null {
    const peers = parseWireGuardDump();

    for (const [_, peer] of peers) {
        // Check if this peer's allowed-ips matches the VPN IP
        if (peer.allowedIps.includes(vpnIp)) {
            return peer;
        }
    }

    return null;
}

/**
 * Format duration in human-readable format
 */
export function formatDuration(milliseconds: number): string {
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

/**
 * Get NAS VPN status with uptime/offline duration
 */
export async function getNasVpnStatus(nasId: string): Promise<NasVpnStatus | null> {
    const nas = await prisma.nAS.findUnique({
        where: { id: nasId },
        select: {
            id: true,
            name: true,
            vpnIp: true,
            vpnPublicKey: true,
            status: true,
            lastSeen: true,
            uptime: true,
        },
    });

    if (!nas || !nas.vpnIp) {
        return null;
    }

    // Get real-time WireGuard status
    const peerInfo = getPeerInfoByVpnIp(nas.vpnIp);

    const isConnected = peerInfo?.isConnected ?? false;
    const lastHandshake = peerInfo?.lastHandshake ?? null;

    let uptime: string | null = null;
    let offlineDuration: string | null = null;

    if (isConnected && lastHandshake) {
        // Calculate time since first connection (use lastSeen as approximation if no uptime)
        uptime = nas.uptime ?? formatDuration(Date.now() - lastHandshake.getTime());
    } else if (!isConnected && nas.lastSeen) {
        // Calculate how long it's been offline
        offlineDuration = formatDuration(Date.now() - nas.lastSeen.getTime());
    }

    return {
        nasId: nas.id,
        nasName: nas.name,
        vpnIp: nas.vpnIp,
        status: isConnected ? 'ONLINE' : (nas.status === 'PENDING' ? 'PENDING' : 'OFFLINE'),
        isConnected,
        lastHandshake,
        uptime,
        offlineDuration,
        lastSeen: nas.lastSeen,
        bytesReceived: peerInfo?.rxBytes ?? BigInt(0),
        bytesSent: peerInfo?.txBytes ?? BigInt(0),
    };
}

/**
 * Sync all NAS statuses based on WireGuard handshake data
 */
export async function syncAllNasStatuses(): Promise<{ updated: number; online: number; offline: number }> {
    const peers = parseWireGuardDump();

    // Get all NAS with VPN configured
    const nasList = await prisma.nAS.findMany({
        where: { vpnIp: { not: null } },
        select: {
            id: true,
            name: true,
            vpnIp: true,
            vpnPublicKey: true,
            status: true,
            lastSeen: true,
        },
    });

    let updated = 0;
    let online = 0;
    let offline = 0;

    for (const nas of nasList) {
        if (!nas.vpnIp) continue;

        // Find matching peer by public key or allowed-ips
        let peerInfo: VpnPeerInfo | null = null;

        if (nas.vpnPublicKey) {
            peerInfo = peers.get(nas.vpnPublicKey) ?? null;
        }

        if (!peerInfo) {
            // Try to find by VPN IP in allowed-ips
            for (const [_, peer] of peers) {
                if (peer.allowedIps.includes(nas.vpnIp)) {
                    peerInfo = peer;
                    break;
                }
            }
        }

        const isConnected = peerInfo?.isConnected ?? false;
        const newStatus = isConnected ? 'ONLINE' : 'OFFLINE';

        // Only update if status changed
        if (nas.status !== newStatus) {
            await prisma.nAS.update({
                where: { id: nas.id },
                data: {
                    status: newStatus,
                    lastSeen: isConnected ? new Date() : nas.lastSeen,
                },
            });
            updated++;
            logger.info({ nasId: nas.id, nasName: nas.name, newStatus }, 'NAS status updated');
        } else if (isConnected) {
            // Update lastSeen for online routers
            await prisma.nAS.update({
                where: { id: nas.id },
                data: { lastSeen: new Date() },
            });
        }

        if (isConnected) {
            online++;
        } else {
            offline++;
        }
    }

    return { updated, online, offline };
}

/**
 * Get all NAS VPN statuses for a tenant
 */
export async function getAllNasVpnStatuses(tenantId: string): Promise<NasVpnStatus[]> {
    const peers = parseWireGuardDump();

    const nasList = await prisma.nAS.findMany({
        where: { tenantId, vpnIp: { not: null } },
        select: {
            id: true,
            name: true,
            vpnIp: true,
            vpnPublicKey: true,
            status: true,
            lastSeen: true,
            uptime: true,
        },
    });

    const statuses: NasVpnStatus[] = [];

    for (const nas of nasList) {
        if (!nas.vpnIp) continue;

        // Find matching peer
        let peerInfo: VpnPeerInfo | null = null;

        if (nas.vpnPublicKey) {
            peerInfo = peers.get(nas.vpnPublicKey) ?? null;
        }

        if (!peerInfo) {
            for (const [_, peer] of peers) {
                if (peer.allowedIps.includes(nas.vpnIp)) {
                    peerInfo = peer;
                    break;
                }
            }
        }

        const isConnected = peerInfo?.isConnected ?? false;
        const lastHandshake = peerInfo?.lastHandshake ?? null;

        let uptime: string | null = null;
        let offlineDuration: string | null = null;

        if (isConnected) {
            uptime = nas.uptime ?? (lastHandshake ? formatDuration(Date.now() - lastHandshake.getTime()) : null);
        } else if (nas.lastSeen) {
            offlineDuration = formatDuration(Date.now() - nas.lastSeen.getTime());
        }

        statuses.push({
            nasId: nas.id,
            nasName: nas.name,
            vpnIp: nas.vpnIp,
            status: isConnected ? 'ONLINE' : (nas.status === 'PENDING' ? 'PENDING' : 'OFFLINE'),
            isConnected,
            lastHandshake,
            uptime,
            offlineDuration,
            lastSeen: nas.lastSeen,
            bytesReceived: peerInfo?.rxBytes ?? BigInt(0),
            bytesSent: peerInfo?.txBytes ?? BigInt(0),
        });
    }

    return statuses;
}

// Status monitor interval handle
let monitorInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the VPN status monitor
 */
export function startVpnStatusMonitor(): void {
    if (monitorInterval) {
        logger.warn('VPN status monitor already running');
        return;
    }

    logger.info({ interval: MONITOR_INTERVAL_MS }, 'Starting VPN status monitor');

    // Run immediately on start
    syncAllNasStatuses()
        .then(result => {
            logger.info(result, 'Initial NAS status sync complete');
        })
        .catch(error => {
            logger.error({ error }, 'Failed initial NAS status sync');
        });

    // Schedule periodic sync
    monitorInterval = setInterval(async () => {
        try {
            const result = await syncAllNasStatuses();
            logger.debug(result, 'NAS status sync complete');
        } catch (error) {
            logger.error({ error }, 'Failed NAS status sync');
        }
    }, MONITOR_INTERVAL_MS);
}

/**
 * Stop the VPN status monitor
 */
export function stopVpnStatusMonitor(): void {
    if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = null;
        logger.info('VPN status monitor stopped');
    }
}
