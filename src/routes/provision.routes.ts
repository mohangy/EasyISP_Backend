import { execSync } from 'node:child_process';
import { Hono } from 'hono';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export const provisionRoutes = new Hono();

// Encryption key - should be in env in production
const PROVISION_SECRET = process.env['PROVISION_SECRET'] ?? 'easyisp-provision-secret-key-32b';

// Encrypt provision token
export function encryptToken(data: { routerId: string; tenantId: string; secret: string }): string {
    const iv = randomBytes(16);
    const key = Buffer.from(PROVISION_SECRET.padEnd(32, '0').slice(0, 32));
    const cipher = createCipheriv('aes-256-cbc', key, iv);

    const payload = JSON.stringify({
        ...data,
        timestamp: Date.now(),
    });

    let encrypted = cipher.update(payload, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    // Combine IV and encrypted data
    const combined = iv.toString('base64') + '.' + encrypted;
    return Buffer.from(combined).toString('base64url');
}

// Decrypt provision token
function decryptToken(token: string): { routerId: string; tenantId: string; secret: string; timestamp: number } | null {
    try {
        const combined = Buffer.from(token, 'base64url').toString('utf8');
        const [ivBase64, encrypted] = combined.split('.');

        if (!ivBase64 || !encrypted) return null;

        const iv = Buffer.from(ivBase64, 'base64');
        const key = Buffer.from(PROVISION_SECRET.padEnd(32, '0').slice(0, 32));
        const decipher = createDecipheriv('aes-256-cbc', key, iv);

        let decrypted = decipher.update(encrypted, 'base64', 'utf8');
        decrypted += decipher.final('utf8');

        return JSON.parse(decrypted);
    } catch (error) {
        logger.error({ error }, 'Failed to decrypt provision token');
        return null;
    }
}

// Helper: Generate WireGuard keys
function generateWireGuardKeys(): { privateKey: string; publicKey: string } {
    try {
        const privateKey = execSync('wg genkey').toString().trim();
        const publicKey = execSync(`echo "${privateKey}" | wg pubkey`).toString().trim();
        return { privateKey, publicKey };
    } catch (error) {
        logger.error({ error }, 'Failed to generate WireGuard keys');
        throw new Error('Failed to generate VPN keys');
    }
}

// Helper: Assign free VPN IP
async function assignVpnIp(tenantId: string): Promise<string> {
    // Get all used IPs from NAS and VPNPeer
    const [nasList, peerList] = await Promise.all([
        prisma.nAS.findMany({ where: { tenantId, vpnIp: { not: null } }, select: { vpnIp: true } }),
        prisma.vPNPeer.findMany({ where: { tenantId }, select: { assignedIp: true } }),
    ]);

    const usedIps = new Set([
        ...nasList.map(n => n.vpnIp!),
        ...peerList.map(p => p.assignedIp.split('/')[0]), // Remove /32 prefix
    ]);

    // Simple allocation: 10.10.x.x
    // Avoid 10.10.0.1 (Server)
    for (let i = 0; i <= 255; i++) {
        for (let j = 2; j <= 254; j++) {
            const ip = `10.10.${i}.${j}`;
            if (!usedIps.has(ip)) return ip;
        }
    }
    throw new Error('No updated VPN IPs available');
}

// GET /provision/:token - Public endpoint for routers to fetch their config
// NO AUTH - routers call this directly
provisionRoutes.get('/:token', async (c) => {
    const token = c.req.param('token');

    // Decrypt token
    const data = decryptToken(token);
    if (!data) {
        return c.text('# Invalid or expired provision token', 400);
    }

    // Check token age (valid for 24 hours)
    const tokenAge = Date.now() - data.timestamp;
    if (tokenAge > 24 * 60 * 60 * 1000) {
        return c.text('# Provision token has expired. Please generate a new one.', 400);
    }

    // Get router from database
    const nas = await prisma.nAS.findFirst({
        where: { id: data.routerId, tenantId: data.tenantId },
    });

    if (!nas) {
        return c.text('# Router not found', 404);
    }

    // Get RADIUS server config from environment
    const radiusServer = process.env['RADIUS_SERVER'] ?? '113.30.190.52';
    const radiusPort = process.env['RADIUS_PORT'] ?? '1812';
    const acctPort = process.env['RADIUS_ACCT_PORT'] ?? '1813';
    const apiBaseUrl = process.env['API_BASE_URL'] ?? 'https://113.30.190.52';

    // Get WireGuard server config
    const wgPublicKey = process.env['WG_PUBLIC_KEY'] ?? 'VCnoAMcYMtfDGcBKHatyKjuA8ZBP7onHrWG8kQcXxkY=';
    const wgEndpoint = process.env['WG_ENDPOINT'] ?? '113.30.190.52:51820';
    const wgInterface = process.env['WG_INTERFACE'] ?? 'wg0';

    // Generate API credentials for this router
    const apiUsername = 'easyisp-api';
    const apiPassword = randomBytes(16).toString('hex');

    // Setup WireGuard VPN
    let vpnIp = nas.vpnIp;
    let vpnPrivateKey = nas.vpnPrivateKey;
    let vpnPublicKey = nas.vpnPublicKey;

    // Generate new keys/IP if missing
    if (!vpnIp || !vpnPrivateKey || !vpnPublicKey) {
        try {
            const keys = generateWireGuardKeys();
            vpnPrivateKey = keys.privateKey;
            vpnPublicKey = keys.publicKey;
            vpnIp = await assignVpnIp(data.tenantId);

            // Add peer to server interface
            // IMPORTANT: This requires sudo permissions or running as root
            try {
                execSync(`sudo wg set ${wgInterface} peer ${vpnPublicKey} allowed-ips ${vpnIp}/32`);
                logger.info({ routerId: nas.id, vpnIp }, 'Added WireGuard peer to server');
            } catch (wgError) {
                logger.error({ error: wgError }, 'Failed to add WireGuard peer on server (check permissions)');
                // Continue anyway - maybe user will add it manually or server syncs later
            }
        } catch (error) {
            logger.error({ error }, 'Failed to setup VPN');
        }
    }

    // Update the NAS record with API credentials and VPN info
    await prisma.nAS.update({
        where: { id: nas.id },
        data: {
            apiUsername,
            apiPassword,
            apiPort: 8728,
            vpnIp,
            vpnPublicKey,
            vpnPrivateKey,
        },
    });

    // Generate complete RouterOS configuration script
    const script = `# ===========================================
# EasyISP Auto-Configuration Script
# Router: ${nas.name}
# Generated: ${new Date().toISOString()}
# ===========================================

:log info "Starting EasyISP configuration..."

# ===== DNS CONFIGURATION =====
/ip dns set servers=8.8.8.8,1.1.1.1 allow-remote-requests=yes

# ===== WIREGUARD VPN CONFIGURATION =====
# Check if interface exists
:if ([:len [/interface wireguard find name=wg-easyisp]] = 0) do={
    /interface wireguard add name=wg-easyisp mtu=1420 listen-port=51821 private-key="${vpnPrivateKey}"
}

# Add peer (Server)
/interface wireguard peers remove [find interface=wg-easyisp]
/interface wireguard peers add interface=wg-easyisp \\
    public-key="${wgPublicKey}" \\
    endpoint-address=${wgEndpoint.split(':')[0]} endpoint-port=${wgEndpoint.split(':')[1]} \\
    allowed-address=10.10.0.0/16 persistent-keepalive=25s

# Add IP address
/ip address remove [find interface=wg-easyisp]
/ip address add address=${vpnIp}/32 interface=wg-easyisp network=10.10.0.0

# Add Route to VPN subnet
/ip route remove [find gateway=wg-easyisp]
    /ip route add dst-address=10.10.0.0/16 gateway=wg-easyisp comment="EasyISP VPN"
    
    # Allow Backend Management access
    /ip firewall filter add action=accept chain=input in-interface=wg-easyisp comment="Allow EasyISP Management" place-before=1
    
    # Update services to listen on VPN IP
    /ip service set api address=10.10.0.0/16

:log info "WireGuard VPN configured. IP: ${vpnIp}"

# ===== API SERVICE CONFIGURATION =====
# Enable API service for remote management
/ip service set api disabled=no port=8728 address=10.10.0.0/16

# Remove existing EasyISP API user if exists
# Configure EasyISP API user
:if ([:len [/user find name="${apiUsername}"]] > 0) do={
    /user set [find name="${apiUsername}"] password="${apiPassword}" group=full
} else={
    /user add name="${apiUsername}" password="${apiPassword}" group=full comment="EasyISP Management API"
}

:log info "API service configured"

# ===== RADIUS CONFIGURATION =====
# Remove existing RADIUS configuration
/radius remove [find]

# Add RADIUS server via VPN IP (Server is usually 10.10.0.1)
/radius add address=10.10.0.1 secret="${data.secret}" service=hotspot,login,ppp \\
    authentication-port=${radiusPort} accounting-port=${acctPort} timeout=3000ms

# Enable RADIUS for PPPoE
/ppp aaa set use-radius=yes accounting=yes interim-update=5m

# Enable RADIUS for User Manager
/user aaa set use-radius=yes accounting=yes interim-update=5m

# Configure CoA
/radius incoming set accept=yes port=${nas.coaPort}

:log info "RADIUS configured via VPN"

# ===== HOTSPOT PROFILE (DEFAULT) =====
# Configure default hotspot profile to use RADIUS
:do {
    /ip hotspot profile set [find default=yes] \\
        use-radius=yes radius-interim-update=5m \\
        login-by=http-chap,mac-cookie \\
        nas-port-type=ethernet
} on-error={
    :log warning "Could not configure hotspot profile - hotspot may not be set up yet"
}

# ===== SYSTEM IDENTITY =====
/system identity set name="${nas.name}"

# ===== NOTIFY SERVER =====
# Mark configuration complete by calling back to server via VPN or Public IP
:do {
    /tool fetch mode=https url="${apiBaseUrl}/api/wizard/${nas.id}/provision-complete" keep-result=no
} on-error={
    :log warning "Could not notify server of completion"
}

:log info "==========================================="
:log info "EasyISP configuration completed successfully!"
:log info "VPN IP: ${vpnIp}"
:log info "API User: ${apiUsername}"
:log info "==========================================="
:log info "Next: Open the EasyISP wizard and click"
:log info "'Check Router Online' to continue setup."
`;

    // Return as plain text script
    c.header('Content-Type', 'text/plain; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="${nas.name}-config.rsc"`);

    logger.info({ routerId: nas.id, routerName: nas.name, vpnIp }, 'Provision script downloaded with API & VPN credentials');

    return c.text(script);
});
