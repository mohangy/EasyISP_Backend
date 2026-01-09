import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { createAuditLog } from '../lib/audit.js';
import { logger } from '../lib/logger.js';
import { execSync } from 'child_process';

export const vpnRoutes = new Hono();

// WireGuard interface name from environment
const WG_INTERFACE = process.env['WG_INTERFACE'] ?? 'wg0';

/**
 * Generate WireGuard keypair using actual wg commands
 */
function generateWireGuardKeys(): { privateKey: string; publicKey: string } {
    try {
        const privateKey = execSync('wg genkey').toString().trim();
        const publicKey = execSync(`echo "${privateKey}" | wg pubkey`).toString().trim();
        return { privateKey, publicKey };
    } catch (error) {
        logger.error({ error }, 'Failed to generate WireGuard keys');
        throw new Error('Failed to generate VPN keys. Is WireGuard installed?');
    }
}

/**
 * Add peer to WireGuard server
 */
function addPeerToServer(publicKey: string, allowedIps: string): boolean {
    try {
        execSync(`sudo wg set ${WG_INTERFACE} peer ${publicKey} allowed-ips ${allowedIps}`);
        logger.info({ publicKey, allowedIps }, 'Added WireGuard peer to server');
        return true;
    } catch (error) {
        logger.error({ error, publicKey }, 'Failed to add WireGuard peer to server');
        return false;
    }
}

/**
 * Remove peer from WireGuard server
 */
function removePeerFromServer(publicKey: string): boolean {
    try {
        execSync(`sudo wg set ${WG_INTERFACE} peer ${publicKey} remove`);
        logger.info({ publicKey }, 'Removed WireGuard peer from server');
        return true;
    } catch (error) {
        logger.error({ error, publicKey }, 'Failed to remove WireGuard peer from server');
        return false;
    }
}

/**
 * Get peer statistics from WireGuard server
 */
export function getServerPeerStats(): Map<string, { lastHandshake: Date | null; rxBytes: bigint; txBytes: bigint }> {
    const stats = new Map<string, { lastHandshake: Date | null; rxBytes: bigint; txBytes: bigint }>();

    try {
        const output = execSync(`wg show ${WG_INTERFACE} dump`).toString();
        const lines = output.trim().split('\n');

        // Skip first line (interface info), parse peer lines
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
    } catch (error) {
        logger.error({ error }, 'Failed to get WireGuard peer stats');
    }

    return stats;
}

// Apply auth middleware to all routes
vpnRoutes.use('*', authMiddleware);

// Validation schemas
const createPeerSchema = z.object({
    name: z.string().min(1),
    customerId: z.string().uuid().optional(),
    allowedIps: z.string().optional().default('0.0.0.0/0'),
    persistentKeepalive: z.number().optional().default(25),
});

// GET /api/vpn/status - Get WireGuard server status
vpnRoutes.get('/status', async (c) => {
    const tenantId = c.get('tenantId');

    // Count VPN peers
    const [totalPeers, activePeers] = await Promise.all([
        prisma.vPNPeer.count({ where: { tenantId } }),
        prisma.vPNPeer.count({ where: { tenantId, status: 'ACTIVE' } }),
    ]);

    return c.json({
        status: 'running',
        protocol: 'WireGuard',
        publicKey: process.env['WG_PUBLIC_KEY'] ?? 'Not configured',
        endpoint: process.env['WG_ENDPOINT'] ?? 'Not configured',
        listenPort: parseInt(process.env['WG_LISTEN_PORT'] ?? '51820'),
        peers: {
            total: totalPeers,
            active: activePeers,
        },
    });
});

// GET /api/vpn/peers - List VPN peers
vpnRoutes.get('/peers', async (c) => {
    const tenantId = c.get('tenantId');
    const page = parseInt(c.req.query('page') ?? '1');
    const pageSize = parseInt(c.req.query('pageSize') ?? '20');
    const status = c.req.query('status');

    interface PeerWhere {
        tenantId: string;
        status?: string;
    }

    const where: PeerWhere = { tenantId };
    if (status) where.status = status.toUpperCase();

    const [peers, total] = await Promise.all([
        prisma.vPNPeer.findMany({
            where,
            include: {
                customer: { select: { id: true, name: true, username: true } },
            },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.vPNPeer.count({ where }),
    ]);

    return c.json({
        peers: peers.map((p) => ({
            id: p.id,
            name: p.name,
            publicKey: p.publicKey,
            allowedIps: p.allowedIps,
            status: p.status.toLowerCase(),
            customer: p.customer,
            lastHandshake: p.lastHandshake,
            bytesReceived: p.bytesReceived,
            bytesSent: p.bytesSent,
            createdAt: p.createdAt,
        })),
        total,
        page,
        pageSize,
    });
});

// POST /api/vpn/peers - Create VPN peer
vpnRoutes.post('/peers', async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const body = await c.req.json();
    const data = createPeerSchema.parse(body);

    // Generate keypair using actual WireGuard commands
    const { privateKey, publicKey } = generateWireGuardKeys();

    // Assign IP from pool (improved allocation that checks for gaps)
    const existingPeers = await prisma.vPNPeer.findMany({
        where: { tenantId },
        select: { assignedIp: true },
    });

    const usedIps = new Set(existingPeers.map(p => p.assignedIp.split('/')[0]));
    let assignedIp = '';

    // Find first available IP in 10.10.x.x range (skip .1 which is server)
    outer: for (let i = 0; i <= 255; i++) {
        for (let j = 2; j <= 254; j++) {
            const ip = `10.10.${i}.${j}`;
            if (!usedIps.has(ip)) {
                assignedIp = `${ip}/32`;
                break outer;
            }
        }
    }

    if (!assignedIp) {
        throw new AppError(503, 'No available VPN IPs in pool');
    }

    const peer = await prisma.vPNPeer.create({
        data: {
            name: data.name,
            publicKey,
            privateKey, // TODO: Encrypt with VPN_KEY_SECRET
            allowedIps: data.allowedIps ?? '0.0.0.0/0',
            assignedIp,
            persistentKeepalive: data.persistentKeepalive ?? 25,
            status: 'ACTIVE',
            customerId: data.customerId,
            tenantId,
        },
    });

    // Add peer to WireGuard server
    const serverSynced = addPeerToServer(publicKey, assignedIp);
    if (!serverSynced) {
        logger.warn({ peerId: peer.id }, 'Peer created in DB but failed to sync to WireGuard server');
    }

    // Audit log
    await createAuditLog({
        action: 'VPN_PEER_CREATE',
        targetType: 'VPNPeer',
        targetId: peer.id,
        targetName: peer.name,
        user,
    });

    // Generate client config
    const serverPublicKey = process.env['WG_PUBLIC_KEY'] ?? 'SERVER_PUBLIC_KEY';
    const serverEndpoint = process.env['WG_ENDPOINT'] ?? 'vpn.example.com:51820';
    const dns = process.env['WG_DNS'] ?? '1.1.1.1';

    const clientConfig = `[Interface]
PrivateKey = ${privateKey}
Address = ${assignedIp}
DNS = ${dns}

[Peer]
PublicKey = ${serverPublicKey}
Endpoint = ${serverEndpoint}
AllowedIPs = ${data.allowedIps}
PersistentKeepalive = ${data.persistentKeepalive}
`;

    return c.json(
        {
            id: peer.id,
            name: peer.name,
            publicKey: peer.publicKey,
            assignedIp: peer.assignedIp,
            config: clientConfig,
            serverSynced,
        },
        201
    );
});

// DELETE /api/vpn/peers/:id - Delete VPN peer
vpnRoutes.delete('/peers/:id', async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const peerId = c.req.param('id');

    const peer = await prisma.vPNPeer.findFirst({
        where: { id: peerId, tenantId },
    });

    if (!peer) {
        throw new AppError(404, 'VPN peer not found');
    }

    // Remove from WireGuard server first
    const serverSynced = removePeerFromServer(peer.publicKey);
    if (!serverSynced) {
        logger.warn({ peerId: peer.id }, 'Failed to remove peer from WireGuard server, continuing with DB delete');
    }

    await prisma.vPNPeer.delete({ where: { id: peerId } });

    // Audit log
    await createAuditLog({
        action: 'VPN_PEER_DELETE',
        targetType: 'VPNPeer',
        targetId: peer.id,
        targetName: peer.name,
        user,
    });

    return c.json({ success: true, serverSynced });
});

// GET /api/vpn/peers/:id/config - Get peer config file
vpnRoutes.get('/peers/:id/config', async (c) => {
    const tenantId = c.get('tenantId');
    const peerId = c.req.param('id');

    const peer = await prisma.vPNPeer.findFirst({
        where: { id: peerId, tenantId },
    });

    if (!peer) {
        throw new AppError(404, 'VPN peer not found');
    }

    const serverPublicKey = process.env['WG_PUBLIC_KEY'] ?? 'SERVER_PUBLIC_KEY';
    const serverEndpoint = process.env['WG_ENDPOINT'] ?? 'vpn.example.com:51820';
    const dns = process.env['WG_DNS'] ?? '1.1.1.1';

    const config = `[Interface]
PrivateKey = ${peer.privateKey}
Address = ${peer.assignedIp}
DNS = ${dns}

[Peer]
PublicKey = ${serverPublicKey}
Endpoint = ${serverEndpoint}
AllowedIPs = ${peer.allowedIps}
PersistentKeepalive = ${peer.persistentKeepalive}
`;

    c.header('Content-Type', 'text/plain');
    c.header('Content-Disposition', `attachment; filename="${peer.name}.conf"`);

    return c.text(config);
});

// PUT /api/vpn/peers/:id/toggle - Enable/disable peer
vpnRoutes.put('/peers/:id/toggle', async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const peerId = c.req.param('id');

    const peer = await prisma.vPNPeer.findFirst({
        where: { id: peerId, tenantId },
    });

    if (!peer) {
        throw new AppError(404, 'VPN peer not found');
    }

    const newStatus = peer.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';

    await prisma.vPNPeer.update({
        where: { id: peerId },
        data: { status: newStatus },
    });

    // Audit log
    await createAuditLog({
        action: newStatus === 'ACTIVE' ? 'VPN_PEER_ENABLE' : 'VPN_PEER_DISABLE',
        targetType: 'VPNPeer',
        targetId: peer.id,
        targetName: peer.name,
        user,
    });

    return c.json({
        success: true,
        status: newStatus.toLowerCase(),
    });
});

// POST /api/vpn/sync-stats - Sync peer statistics from WireGuard server
vpnRoutes.post('/sync-stats', async (c) => {
    const tenantId = c.get('tenantId');

    // Get all peers for this tenant
    const peers = await prisma.vPNPeer.findMany({
        where: { tenantId },
        select: { id: true, publicKey: true },
    });

    // Get stats from WireGuard server
    const serverStats = getServerPeerStats();

    let updated = 0;

    for (const peer of peers) {
        const stats = serverStats.get(peer.publicKey);
        if (stats) {
            await prisma.vPNPeer.update({
                where: { id: peer.id },
                data: {
                    lastHandshake: stats.lastHandshake,
                    bytesReceived: stats.rxBytes,
                    bytesSent: stats.txBytes,
                },
            });
            updated++;
        }
    }

    return c.json({
        success: true,
        peersChecked: peers.length,
        peersUpdated: updated,
    });
});

// =============================================
// Router VPN Status Endpoints
// =============================================

import {
    getAllNasVpnStatuses,
    getNasVpnStatus,
    syncAllNasStatuses,
    formatDuration
} from '../services/vpn-status.service.js';

// GET /api/vpn/routers/status - Get all router VPN statuses
vpnRoutes.get('/routers/status', async (c) => {
    const tenantId = c.get('tenantId');

    const statuses = await getAllNasVpnStatuses(tenantId);

    return c.json({
        routers: statuses.map(s => ({
            id: s.nasId,
            name: s.nasName,
            vpnIp: s.vpnIp,
            status: s.status,
            isConnected: s.isConnected,
            lastHandshake: s.lastHandshake,
            uptime: s.uptime,
            offlineDuration: s.offlineDuration,
            lastSeen: s.lastSeen,
            bytesReceived: s.bytesReceived.toString(),
            bytesSent: s.bytesSent.toString(),
        })),
        summary: {
            total: statuses.length,
            online: statuses.filter(s => s.isConnected).length,
            offline: statuses.filter(s => !s.isConnected && s.status !== 'PENDING').length,
            pending: statuses.filter(s => s.status === 'PENDING').length,
        },
    });
});

// GET /api/vpn/routers/:id/status - Get single router VPN status
vpnRoutes.get('/routers/:id/status', async (c) => {
    const tenantId = c.get('tenantId');
    const nasId = c.req.param('id');

    // Verify NAS belongs to tenant
    const nas = await prisma.nAS.findFirst({
        where: { id: nasId, tenantId },
        select: { id: true },
    });

    if (!nas) {
        throw new AppError(404, 'Router not found');
    }

    const status = await getNasVpnStatus(nasId);

    if (!status) {
        throw new AppError(404, 'Router VPN not configured');
    }

    return c.json({
        id: status.nasId,
        name: status.nasName,
        vpnIp: status.vpnIp,
        status: status.status,
        isConnected: status.isConnected,
        lastHandshake: status.lastHandshake,
        uptime: status.uptime,
        offlineDuration: status.offlineDuration,
        lastSeen: status.lastSeen,
        bytesReceived: status.bytesReceived.toString(),
        bytesSent: status.bytesSent.toString(),
    });
});

// POST /api/vpn/routers/sync - Manually trigger status sync for all routers
vpnRoutes.post('/routers/sync', async (c) => {
    const result = await syncAllNasStatuses();

    return c.json({
        success: true,
        ...result,
    });
});
