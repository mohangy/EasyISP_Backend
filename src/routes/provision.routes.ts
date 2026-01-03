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
    const apiBaseUrl = process.env['API_BASE_URL'] ?? 'https://113-30-190-52.cloud-xip.com';

    // Generate complete RouterOS configuration script
    const script = `# ===========================================
# EasyISP Auto-Configuration Script
# Router: ${nas.name}
# Generated: ${new Date().toISOString()}
# ===========================================

:log info "Starting EasyISP configuration..."

# Remove existing RADIUS configuration
/radius remove [find]

# Add RADIUS server
/radius add address=${radiusServer} secret="${data.secret}" service=hotspot,login,ppp \\
    authentication-port=${radiusPort} accounting-port=${acctPort} timeout=3000ms

# Enable RADIUS for PPPoE
/ppp aaa set use-radius=yes accounting=yes interim-update=5m

# Enable RADIUS for User Manager
/user aaa set use-radius=yes accounting=yes interim-update=5m

# Configure CoA (Change of Authorization) for remote disconnect
/radius incoming set accept=yes port=${nas.coaPort}

# Configure Hotspot profile to use RADIUS
:do {
    /ip hotspot profile set [find default=yes] \\
        use-radius=yes radius-interim-update=5m \\
        login-by=http-chap,mac-cookie \\
        nas-port-type=ethernet
} on-error={
    :log warning "Could not configure hotspot profile - hotspot may not be set up"
}

# Set system identity
/system identity set name="${nas.name}"

# Mark configuration complete by calling back to server
:do {
    /tool fetch mode=https url="${apiBaseUrl}/api/wizard/${nas.id}/provision-complete" keep-result=no
} on-error={
    :log warning "Could not notify server of completion"
}

:log info "EasyISP configuration completed successfully!"
:log info "RADIUS Server: ${radiusServer}"
:log info "RADIUS Secret: ${data.secret}"
`;

    // Return as plain text script
    c.header('Content-Type', 'text/plain; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="${nas.name}-config.rsc"`);

    logger.info({ routerId: nas.id, routerName: nas.name }, 'Provision script downloaded');

    return c.text(script);
});
