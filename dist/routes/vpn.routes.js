import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { createAuditLog } from '../lib/audit.js';
import { randomBytes } from 'crypto';
export const vpnRoutes = new Hono();
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
    const where = { tenantId };
    if (status)
        where.status = status.toUpperCase();
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
    // Generate keypair (in production, use actual WG keygen)
    const privateKey = randomBytes(32).toString('base64');
    const publicKey = randomBytes(32).toString('base64'); // Would be derived from private
    // Assign IP from pool
    const existingCount = await prisma.vPNPeer.count({ where: { tenantId } });
    const assignedIp = `10.10.${Math.floor(existingCount / 254)}.${(existingCount % 254) + 2}/32`;
    const peer = await prisma.vPNPeer.create({
        data: {
            name: data.name,
            publicKey,
            privateKey, // Would be encrypted in production
            allowedIps: data.allowedIps ?? '0.0.0.0/0',
            assignedIp,
            persistentKeepalive: data.persistentKeepalive ?? 25,
            status: 'ACTIVE',
            customerId: data.customerId,
            tenantId,
        },
    });
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
    return c.json({
        id: peer.id,
        name: peer.name,
        publicKey: peer.publicKey,
        assignedIp: peer.assignedIp,
        config: clientConfig,
    }, 201);
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
    await prisma.vPNPeer.delete({ where: { id: peerId } });
    // Audit log
    await createAuditLog({
        action: 'VPN_PEER_DELETE',
        targetType: 'VPNPeer',
        targetId: peer.id,
        targetName: peer.name,
        user,
    });
    // TODO: Remove from WireGuard server config
    return c.json({ success: true });
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
//# sourceMappingURL=vpn.routes.js.map