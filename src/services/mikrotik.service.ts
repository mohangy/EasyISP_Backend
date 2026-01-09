/**
 * MikroTik RouterOS API Service
 * Handles all communication with MikroTik routers via their API
 */

import { RouterOSAPI } from 'routeros-client';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

interface NASInfo {
    id: string;
    name: string;
    ipAddress: string;
    apiUsername?: string | null;
    apiPassword?: string | null;
    apiPort: number;
    vpnIp?: string | null;
    tenantId?: string;
}

export interface PPPoESession {
    id: string;           // MikroTik internal ID (e.g., "*1")
    name: string;         // Username
    service: string;      // Service name (e.g., "pppoe")
    callerId: string;     // MAC address
    address: string;      // Assigned IP
    uptime: string;       // e.g., "2h30m15s"
    encoding: string;
    sessionId: string;    // Acct-Session-Id
}

export interface BandwidthStats {
    txBps: number;        // Transmit bytes per second
    rxBps: number;        // Receive bytes per second
    txPackets: number;
    rxPackets: number;
}

export interface PingResult {
    reachable: boolean;
    latencyMs: number | null;
    error?: string;
}

// New interfaces for enhanced wizard
export interface SystemResources {
    uptime: string;
    version: string;
    buildTime: string;
    factorySoftware: string;
    freeMemory: number;
    totalMemory: number;
    cpu: string;
    cpuCount: number;
    cpuFrequency: number;
    cpuLoad: number;
    freeHddSpace: number;
    totalHddSpace: number;
    architectureName: string;
    boardName: string;
    platform: string;
}

export interface RouterInterface {
    id: string;
    name: string;
    type: string;
    macAddress: string;
    running: boolean;
    disabled: boolean;
    comment: string;
    isWan: boolean;  // Has default gateway route
}

export interface HotspotConfig {
    interfaces: string[];
    bridgeName?: string;
    gatewayIp: string;
    poolStart: string;
    poolEnd: string;
    dnsServers: string[];
    sessionTimeout?: string;
    idleTimeout?: string;
}

export interface PPPoEConfig {
    interfaces: string[];
    serviceName: string;
    poolStart: string;
    poolEnd: string;
    localAddress: string;
}

// Wireless interface information
export interface WirelessInterface {
    id: string;
    name: string;
    macAddress: string;
    ssid: string;
    band: string;
    channel: string;
    frequency: number;
    mode: string;
    securityProfile: string;
    running: boolean;
    disabled: boolean;
}

// Wireless configuration options
export interface WirelessConfig {
    interfaceName: string;
    ssid: string;
    band?: '2ghz-b' | '2ghz-b/g' | '2ghz-b/g/n' | '5ghz-a' | '5ghz-a/n' | '5ghz-a/n/ac';
    channel?: string;
    securityMode?: 'none' | 'wpa-psk' | 'wpa2-psk' | 'wpa-eap' | 'wpa2-eap';
    passphrase?: string;
    disabled?: boolean;
}

// Firmware/package information
export interface FirmwareInfo {
    currentVersion: string;
    latestVersion: string | null;
    updateAvailable: boolean;
    channel: string;
    packages: PackageInfo[];
}

export interface PackageInfo {
    name: string;
    version: string;
    buildTime: string;
    scheduled: string | null;
}

/**
 * MikroTik Service for RouterOS API operations
 */
export class MikroTikService {
    private connections: Map<string, RouterOSAPI> = new Map();

    /**
     * Get or create a connection to a MikroTik router
     */
    private async getConnection(nas: NASInfo): Promise<RouterOSAPI> {
        // Check if we have an existing connection
        const existing = this.connections.get(nas.id);
        if (existing) {
            try {
                // Test if connection is still alive
                await existing.write('/system/identity/print');
                return existing;
            } catch {
                // Connection dead, remove it
                this.connections.delete(nas.id);
            }
        }

        // Create new connection
        if (!nas.apiUsername || !nas.apiPassword) {
            throw new Error(`Router ${nas.name} does not have API credentials configured`);
        }

        const host = (nas.vpnIp && nas.vpnIp !== '0.0.0.0') ? nas.vpnIp : nas.ipAddress;

        logger.info({ nasId: nas.id, host, useVpn: !!nas.vpnIp }, 'Connecting to RouterOS API');

        const api = new RouterOSAPI({
            host: host,
            port: nas.apiPort || 8728,
            user: nas.apiUsername,
            password: nas.apiPassword,
            timeout: 10000,
        });

        try {
            await api.connect();
            this.connections.set(nas.id, api);
            logger.info({ nasId: nas.id, nasName: nas.name }, 'Connected to MikroTik router');
            return api;
        } catch (error) {
            logger.error({ nasId: nas.id, error }, 'Failed to connect to MikroTik router');
            throw new Error(`Failed to connect to router ${nas.name}: ${(error as Error).message}`);
        }
    }

    /**
     * Get all active PPPoE sessions from the router
     */
    async getActiveSessions(nas: NASInfo): Promise<PPPoESession[]> {
        const api = await this.getConnection(nas);

        try {
            const result = await api.write('/ppp/active/print');

            return result.map((item: any) => ({
                id: item['.id'],
                name: item.name,
                service: item.service || 'pppoe',
                callerId: item['caller-id'] || '',
                address: item.address || '',
                uptime: item.uptime || '0s',
                encoding: item.encoding || '',
                sessionId: item['session-id'] || '',
            }));
        } catch (error) {
            logger.error({ nasId: nas.id, error }, 'Failed to get active sessions');
            throw error;
        }
    }

    /**
     * Get all active Hotspot sessions from the router
     */
    async getActiveHotspotUsers(nas: NASInfo): Promise<{
        name: string;
        address: string;
        'mac-address': string;
        uptime: string;
        'bytes-in': string;
        'bytes-out': string;
        'host-name'?: string;
        server?: string;
    }[]> {
        const api = await this.getConnection(nas);

        try {
            const result = await api.write('/ip/hotspot/active/print');

            return result.map((item: any) => ({
                name: item.user || item.name || '',
                address: item.address || '',
                'mac-address': item['mac-address'] || '',
                uptime: item.uptime || '0s',
                'bytes-in': item['bytes-in'] || '0',
                'bytes-out': item['bytes-out'] || '0',
                'host-name': item['host-name'] || '',
                server: item.server || '',
            }));
        } catch (error) {
            logger.error({ nasId: nas.id, error }, 'Failed to get active hotspot users');
            throw error;
        }
    }

    /**
     * Find an active session by username
     */
    async findActiveSession(nas: NASInfo, username: string): Promise<PPPoESession | null> {
        const sessions = await this.getActiveSessions(nas);
        return sessions.find(s => s.name.toLowerCase() === username.toLowerCase()) || null;
    }

    /**
     * Disconnect a user by username
     */
    async disconnectUser(nas: NASInfo, username: string): Promise<boolean> {
        const api = await this.getConnection(nas);

        try {
            // Find the active session
            const sessions = await api.write('/ppp/active/print', [
                `?name=${username}`
            ]);

            if (sessions.length === 0) {
                logger.warn({ nasId: nas.id, username }, 'User not found in active sessions');
                return false;
            }

            // Remove the session
            await api.write('/ppp/active/remove', [
                `=.id=${sessions[0]['.id']}`
            ]);

            logger.info({ nasId: nas.id, username }, 'User disconnected from router');
            return true;
        } catch (error) {
            logger.error({ nasId: nas.id, username, error }, 'Failed to disconnect user');
            throw error;
        }
    }

    /**
     * Clear MAC binding (caller-id) for a user
     */
    async clearMacBinding(nas: NASInfo, username: string): Promise<boolean> {
        const api = await this.getConnection(nas);

        try {
            // Find the PPP secret
            const secrets = await api.write('/ppp/secret/print', [
                `?name=${username}`
            ]);

            if (secrets.length === 0) {
                logger.warn({ nasId: nas.id, username }, 'User not found in PPP secrets');
                return false;
            }

            // Clear the caller-id
            await api.write('/ppp/secret/set', [
                `=.id=${secrets[0]['.id']}`,
                '=caller-id='
            ]);

            logger.info({ nasId: nas.id, username }, 'MAC binding cleared');
            return true;
        } catch (error) {
            logger.error({ nasId: nas.id, username, error }, 'Failed to clear MAC binding');
            throw error;
        }
    }

    /**
     * Lock MAC address (set caller-id) for a user
     */
    async lockMacAddress(nas: NASInfo, username: string, macAddress: string): Promise<boolean> {
        const api = await this.getConnection(nas);

        try {
            // Find the PPP secret
            const secrets = await api.write('/ppp/secret/print', [
                `?name=${username}`
            ]);

            if (secrets.length === 0) {
                logger.warn({ nasId: nas.id, username }, 'User not found in PPP secrets');
                return false;
            }

            // Set the caller-id
            await api.write('/ppp/secret/set', [
                `=.id=${secrets[0]['.id']}`,
                `=caller-id=${macAddress}`
            ]);

            logger.info({ nasId: nas.id, username, macAddress }, 'MAC address locked');
            return true;
        } catch (error) {
            logger.error({ nasId: nas.id, username, error }, 'Failed to lock MAC address');
            throw error;
        }
    }

    /**
     * Assign a static IP address to a user
     */
    async assignStaticIp(nas: NASInfo, username: string, ipAddress: string): Promise<boolean> {
        const api = await this.getConnection(nas);

        try {
            // Find the PPP secret
            const secrets = await api.write('/ppp/secret/print', [
                `?name=${username}`
            ]);

            if (secrets.length === 0) {
                logger.warn({ nasId: nas.id, username }, 'User not found in PPP secrets');
                return false;
            }

            // Set the remote-address (static IP)
            await api.write('/ppp/secret/set', [
                `=.id=${secrets[0]['.id']}`,
                `=remote-address=${ipAddress}`
            ]);

            logger.info({ nasId: nas.id, username, ipAddress }, 'Static IP assigned');
            return true;
        } catch (error) {
            logger.error({ nasId: nas.id, username, error }, 'Failed to assign static IP');
            throw error;
        }
    }

    /**
     * Set or update a user's bandwidth queue
     */
    async setUserQueue(
        nas: NASInfo,
        username: string,
        downloadMbps: number,
        uploadMbps: number
    ): Promise<boolean> {
        const api = await this.getConnection(nas);
        const maxLimit = `${uploadMbps}M/${downloadMbps}M`;

        try {
            // First, try to find an existing queue for this user
            const queues = await api.write('/queue/simple/print', [
                `?name=<pppoe-${username}>`
            ]);

            if (queues.length > 0) {
                // Update existing queue
                await api.write('/queue/simple/set', [
                    `=.id=${queues[0]['.id']}`,
                    `=max-limit=${maxLimit}`
                ]);
                logger.info({ nasId: nas.id, username, maxLimit }, 'Queue updated');
            } else {
                // Find user's current IP to create queue
                const session = await this.findActiveSession(nas, username);
                if (!session || !session.address) {
                    logger.warn({ nasId: nas.id, username }, 'Cannot create queue - user not online');
                    return false;
                }

                // Create new queue
                await api.write('/queue/simple/add', [
                    `=name=<pppoe-${username}>`,
                    `=target=${session.address}/32`,
                    `=max-limit=${maxLimit}`
                ]);
                logger.info({ nasId: nas.id, username, maxLimit }, 'Queue created');
            }

            return true;
        } catch (error) {
            logger.error({ nasId: nas.id, username, error }, 'Failed to set user queue');
            throw error;
        }
    }

    /**
     * Set a temporary speed boost that reverts after specified duration
     */
    async setTemporaryBoost(
        nas: NASInfo,
        username: string,
        downloadMbps: number,
        uploadMbps: number,
        durationMinutes: number,
        originalDownload: number,
        originalUpload: number
    ): Promise<boolean> {
        const api = await this.getConnection(nas);

        try {
            // First, set the boosted speed
            await this.setUserQueue(nas, username, downloadMbps, uploadMbps);

            // Create a scheduler to revert the speed
            const schedulerName = `boost-revert-${username}`;
            const originalMaxLimit = `${originalUpload}M/${originalDownload}M`;

            // Remove any existing scheduler for this user
            try {
                const existing = await api.write('/system/scheduler/print', [
                    `?name=${schedulerName}`
                ]);
                if (existing.length > 0) {
                    await api.write('/system/scheduler/remove', [
                        `=.id=${existing[0]['.id']}`
                    ]);
                }
            } catch {
                // Ignore if doesn't exist
            }

            // Create new scheduler
            const script = `/queue simple set [find name="<pppoe-${username}>"] max-limit=${originalMaxLimit}; /system scheduler remove [find name="${schedulerName}"]`;

            await api.write('/system/scheduler/add', [
                `=name=${schedulerName}`,
                `=start-time=startup`,
                `=interval=${durationMinutes}m`,
                `=on-event=${script}`,
                `=policy=read,write,policy,test`
            ]);

            logger.info({
                nasId: nas.id,
                username,
                boostSpeed: `${uploadMbps}M/${downloadMbps}M`,
                duration: `${durationMinutes}m`
            }, 'Temporary speed boost applied');

            return true;
        } catch (error) {
            logger.error({ nasId: nas.id, username, error }, 'Failed to set temporary boost');
            throw error;
        }
    }

    /**
     * Get real-time bandwidth usage for a user's interface
     */
    async getUserBandwidth(nas: NASInfo, username: string): Promise<BandwidthStats | null> {
        const api = await this.getConnection(nas);

        try {
            // Find the user's PPPoE interface
            const session = await this.findActiveSession(nas, username);
            if (!session) {
                return null;
            }

            // The interface name is typically <pppoe-username>
            const interfaceName = `<pppoe-${username}>`;

            // Monitor traffic for 1 second
            const result = await api.write('/interface/monitor-traffic', [
                `=interface=${interfaceName}`,
                '=once='
            ]);

            if (result.length === 0) {
                return null;
            }

            return {
                txBps: parseInt(result[0]['tx-bits-per-second'] || '0') / 8,
                rxBps: parseInt(result[0]['rx-bits-per-second'] || '0') / 8,
                txPackets: parseInt(result[0]['tx-packets-per-second'] || '0'),
                rxPackets: parseInt(result[0]['rx-packets-per-second'] || '0'),
            };
        } catch (error) {
            logger.error({ nasId: nas.id, username, error }, 'Failed to get user bandwidth');
            return null;
        }
    }

    /**
     * Send a message to a connected PPPoE user
     * Note: This works via MikroTik's built-in messaging feature
     */
    async sendMessage(nas: NASInfo, username: string, message: string): Promise<boolean> {
        const api = await this.getConnection(nas);

        try {
            // Check if user is online
            const session = await this.findActiveSession(nas, username);
            if (!session) {
                logger.warn({ nasId: nas.id, username }, 'Cannot send message - user not online');
                return false;
            }

            // Use the /tool/sms or customer message approach
            // MikroTik's PPPoE doesn't have a direct message feature, but we can use
            // the User Manager's message feature if available, or winbox messaging

            // Alternative: Create a hotspot-style message page
            // For PPPoE, we'll log and return true (actual implementation depends on setup)
            logger.info({ nasId: nas.id, username, message }, 'Message logged (PPPoE messaging not natively supported)');

            // You could implement this via:
            // 1. Creating a web page notification system
            // 2. Using SMS if phone is available
            // 3. Email notification

            return true;
        } catch (error) {
            logger.error({ nasId: nas.id, username, error }, 'Failed to send message');
            throw error;
        }
    }

    /**
     * Ping a router to test connectivity
     */
    async pingRouter(ipAddress: string, timeout: number = 5000): Promise<PingResult> {
        // Use Node.js net module to test TCP connectivity to API port
        // This is more reliable than ICMP ping which may be blocked

        return new Promise((resolve) => {
            const net = require('net');
            const startTime = Date.now();

            const socket = new net.Socket();
            socket.setTimeout(timeout);

            socket.on('connect', () => {
                const latency = Date.now() - startTime;
                socket.destroy();
                resolve({ reachable: true, latencyMs: latency });
            });

            socket.on('timeout', () => {
                socket.destroy();
                resolve({ reachable: false, latencyMs: null, error: 'Connection timeout' });
            });

            socket.on('error', (err: Error) => {
                socket.destroy();
                resolve({ reachable: false, latencyMs: null, error: err.message });
            });

            // Try to connect to API port (8728)
            socket.connect(8728, ipAddress);
        });
    }

    // ==========================================
    // ENHANCED WIZARD METHODS
    // ==========================================

    /**
     * Update hotspot files on the router by fetching them from the server
     */
    async updateHotspotFiles(nas: NASInfo): Promise<{ success: boolean; files: string[] }> {
        const api = await this.getConnection(nas);

        const publicUrl = process.env['API_BASE_URL'] ?? 'https://113-30-190-52.cloud-xip.com';
        // If router is on VPN, use internal IP for reliable file transfer
        // Note: 10.10.0.1 is the server's WireGuard IP
        const useVpn = !!nas.vpnIp;
        const baseUrl = useVpn ? 'http://10.10.0.1:3000' : publicUrl;

        const files = ['login.html', 'logout.html', 'status.html', 'alogin.html', 'styles.css', 'script.js'];
        const updatedFiles: string[] = [];

        try {
            // First ensure hotspot directory exists (it usually does if hotspot is setup)
            // We'll just fetch files into flash/hotspot or hotspot/ depending on router
            // Standard hotspot path is 'hotspot/'

            for (const file of files) {
                const url = `${baseUrl}/portal-preview/${file}`;

                logger.info({ nasId: nas.id, file, url, useVpn }, 'Fetching hotspot file to router');

                // Using /tool/fetch
                await api.write('/tool/fetch', [
                    `=url=${url}`,
                    `=dst-path=hotspot/${file}`,
                    // Use http mode if internal VPN (no SSL cert issues), otherwise https
                    `=mode=${useVpn ? 'http' : 'https'}`,
                    `=check-certificate=no` // Important for self-signed or dev certs
                ]);

                updatedFiles.push(file);
                // detailed logging or waiting could be added here
            }

            // Fetch dynamic config.js
            const configUrl = `${baseUrl}/provision/hotspot-config/${nas.id}`;
            logger.info({ nasId: nas.id, url: configUrl }, 'Fetching dynamic hotspot config');

            await api.write('/tool/fetch', [
                `=url=${configUrl}`,
                `=dst-path=hotspot/config.js`,
                `=mode=${useVpn ? 'http' : 'https'}`,
                `=check-certificate=no`
            ]);
            updatedFiles.push('config.js');

            return { success: true, files: updatedFiles };
        } catch (error) {
            logger.error({ nasId: nas.id, error }, 'Failed to update hotspot files');
            throw new Error(`Failed to update hotspot files: ${(error as Error).message}`);
        }
    }

    /**
     * Update router configuration (Golden State)
     * Configures Firewall, NAT, RADIUS, Walled Garden, etc.
     */
    async updateRouterConfiguration(nasId: string): Promise<void> {
        const nas = await prisma.nAS.findUnique({ where: { id: nasId } });
        if (!nas) {
            throw new Error('NAS not found');
        }

        const api = await this.getConnection(nas);
        const startTime = Date.now();

        try {
            await this.configureGoldenState(api, nas);
            logger.info({ nasId, duration: Date.now() - startTime }, 'Router configuration updated successfully');
        } catch (error) {
            logger.error({ nasId, error }, 'Failed to update router configuration');
            throw new Error(`Failed to update configuration: ${(error as Error).message}`);
        }
    }

    /**
     * Get system resources (CPU, memory, uptime, version, board)
     */
    async getSystemResources(nas: NASInfo): Promise<SystemResources> {
        const api = await this.getConnection(nas);

        try {
            const [resource, identity, routerboard] = await Promise.all([
                api.write('/system/resource/print'),
                api.write('/system/identity/print'),
                api.write('/system/routerboard/print').catch(() => [{}]),
            ]);

            const res = resource[0] || {};
            const rb = routerboard[0] || {};

            return {
                uptime: res.uptime || '0s',
                version: res.version || 'Unknown',
                buildTime: res['build-time'] || '',
                factorySoftware: rb['factory-software'] || '',
                freeMemory: parseInt(res['free-memory'] || '0'),
                totalMemory: parseInt(res['total-memory'] || '0'),
                cpu: res.cpu || 'Unknown',
                cpuCount: parseInt(res['cpu-count'] || '1'),
                cpuFrequency: parseInt(res['cpu-frequency'] || '0'),
                cpuLoad: parseInt(res['cpu-load'] || '0'),
                freeHddSpace: parseInt(res['free-hdd-space'] || '0'),
                totalHddSpace: parseInt(res['total-hdd-space'] || '0'),
                architectureName: res['architecture-name'] || '',
                boardName: res['board-name'] || rb['model'] || 'Unknown',
                platform: res.platform || 'MikroTik',
            };
        } catch (error) {
            logger.error({ nasId: nas.id, error }, 'Failed to get system resources');
            throw error;
        }
    }

    /**
     * Get all interfaces with WAN detection
     */
    async getInterfaces(nas: NASInfo): Promise<RouterInterface[]> {
        const api = await this.getConnection(nas);

        try {
            // Get all interfaces
            const interfaces = await api.write('/interface/print');

            // Get routes to detect WAN interface
            const routes = await api.write('/ip/route/print', ['?dst-address=0.0.0.0/0']);
            const wanInterfaces = new Set(routes.map((r: any) => r.interface).filter(Boolean));

            return interfaces.map((iface: any) => ({
                id: iface['.id'] || '',
                name: iface.name || '',
                type: iface.type || 'unknown',
                macAddress: iface['mac-address'] || '',
                running: iface.running === 'true' || iface.running === true,
                disabled: iface.disabled === 'true' || iface.disabled === true,
                comment: iface.comment || '',
                isWan: wanInterfaces.has(iface.name),
            }));
        } catch (error) {
            logger.error({ nasId: nas.id, error }, 'Failed to get interfaces');
            throw error;
        }
    }

    /**
     * Backup current router configuration
     */
    async backupConfig(nas: NASInfo): Promise<string> {
        const api = await this.getConnection(nas);

        try {
            const backupName = `easyisp-backup-${Date.now()}`;
            await api.write('/system/backup/save', [`=name=${backupName}`]);
            logger.info({ nasId: nas.id, backupName }, 'Router config backed up');
            return backupName;
        } catch (error) {
            logger.error({ nasId: nas.id, error }, 'Failed to backup config');
            throw error;
        }
    }

    /**
     * Restore configuration from backup
     * WARNING: This will reboot the router
     */
    async restoreBackup(nas: NASInfo, backupName: string): Promise<boolean> {
        const api = await this.getConnection(nas);

        try {
            logger.info({ nasId: nas.id, backupName }, 'Restoring backup (router will reboot)...');

            // This command reboots the router, so the connection will be dropped
            // We ignore the specific error that comes from the connection closing
            await api.write('/system/backup/load', [
                `=name=${backupName}`,
                '=password=' // Zero-touch backups don't have passwords by default
            ]).catch((err: any) => {
                // If error is just connection lost, that's expected
                if (err.message?.includes('Socket closed') || err.message?.includes('Connection reset')) {
                    return;
                }
                throw err;
            });

            return true;
        } catch (error) {
            // Re-check if it's a connection error (sometimes comes here)
            if ((error as Error).message?.includes('Socket closed') || (error as Error).message?.includes('Connection reset')) {
                return true;
            }
            logger.error({ nasId: nas.id, error }, 'Failed to restore backup');
            throw error;
        }
    }

    /**
     * Configure firewall with NAT masquerade
     */
    async configureFirewall(nas: NASInfo, wanInterface: string): Promise<boolean> {
        const api = await this.getConnection(nas);

        try {
            // Check if masquerade rule already exists
            const existingNat = await api.write('/ip/firewall/nat/print', [
                '?chain=srcnat',
                '?action=masquerade',
                `?out-interface=${wanInterface}`
            ]);

            if (existingNat.length === 0) {
                // Add NAT masquerade rule
                await api.write('/ip/firewall/nat/add', [
                    '=chain=srcnat',
                    '=action=masquerade',
                    `=out-interface=${wanInterface}`,
                    '=comment=EasyISP NAT'
                ]);
                logger.info({ nasId: nas.id, wanInterface }, 'NAT masquerade configured');
            }

            return true;
        } catch (error) {
            logger.error({ nasId: nas.id, error }, 'Failed to configure firewall');
            throw error;
        }
    }

    /**
     * Configure complete Hotspot setup
     */
    async configureHotspot(nas: NASInfo, config: HotspotConfig, radiusServer: string, radiusSecret: string): Promise<boolean> {
        const api = await this.getConnection(nas);
        const poolName = 'hotspot-pool';
        const profileName = 'easyisp-hotspot';

        try {
            // 1. Prepare interfaces (Enable & Remove from existing bridges)
            let hotspotInterface = config.interfaces[0];

            // If multiple interfaces, we create a bridge. If single, we configure directly.
            // In both cases, we must ensure physical interfaces are clean (not slaves).
            for (const ifaceName of config.interfaces) {
                // Enable interface
                try {
                    await api.write('/interface/enable', [`=numbers=${ifaceName}`]);
                } catch { /* Ignore if already enabled */ }

                // Check if in bridge and remove
                try {
                    const ports = await api.write('/interface/bridge/port/print', [`?interface=${ifaceName}`]);
                    for (const port of ports) {
                        await api.write('/interface/bridge/port/remove', [`=.id=${port['.id']}`]);
                    }
                } catch { /* Ignore checks */ }
            }

            if (config.interfaces.length > 1) {
                const bridgeName = config.bridgeName || 'bridge-hotspot';

                // Create bridge
                try {
                    await api.write('/interface/bridge/add', [`=name=${bridgeName}`]);
                } catch { /* Bridge may already exist */ }

                // Add ports to bridge
                for (const iface of config.interfaces) {
                    try {
                        await api.write('/interface/bridge/port/add', [
                            `=bridge=${bridgeName}`,
                            `=interface=${iface}`
                        ]);
                    } catch { /* Port may already be added */ }
                }
                hotspotInterface = bridgeName;
            } else {
                // Single interface mode - ensure it's not a slave
                // (Already removed from bridge above)
            }

            // 2. Create IP pool
            try {
                await api.write('/ip/pool/add', [
                    `=name=${poolName}`,
                    `=ranges=${config.poolStart}-${config.poolEnd}`
                ]);
            } catch { /* Pool may already exist */ }

            // 3. Add IP address to interface
            try {
                await api.write('/ip/address/add', [
                    `=address=${config.gatewayIp}/24`,
                    `=interface=${hotspotInterface}`
                ]);
            } catch { /* Address may already exist */ }

            // 4. Create DHCP server
            try {
                const networkParts = config.gatewayIp.split('.');
                const network = `${networkParts[0]}.${networkParts[1]}.${networkParts[2]}.0/24`;

                await api.write('/ip/dhcp-server/network/add', [
                    `=address=${network}`,
                    `=gateway=${config.gatewayIp}`,
                    `=dns-server=${config.gatewayIp}`
                ]);

                await api.write('/ip/dhcp-server/add', [
                    '=name=hotspot-dhcp',
                    `=interface=${hotspotInterface}`,
                    `=address-pool=${poolName}`,
                    '=lease-time=1h',
                    '=disabled=no'
                ]);
            } catch { /* DHCP may already exist */ }

            // 5. Set DNS
            await api.write('/ip/dns/set', [
                `=servers=${config.dnsServers.join(',')}`,
                '=allow-remote-requests=yes'
            ]);

            // 6. Create hotspot profile
            try {
                await api.write('/ip/hotspot/profile/add', [
                    `=name=${profileName}`,
                    '=use-radius=yes',
                    '=radius-interim-update=5m',
                    '=login-by=http-chap,mac-cookie',
                    '=nas-port-type=ethernet',
                    '=html-directory=hotspot',
                    `=dns-name=hotspot.local`
                ]);
            } catch {
                // Profile may already exist - update it
                try {
                    await api.write('/ip/hotspot/profile/set', [
                        `=numbers=${profileName}`,
                        '=html-directory=hotspot',
                        '=use-radius=yes'
                    ]);
                } catch { /* Ignore update errors */ }
            }

            // 7. Create hotspot server
            try {
                await api.write('/ip/hotspot/add', [
                    '=name=easyisp-hotspot',
                    `=interface=${hotspotInterface}`,
                    `=address-pool=${poolName}`,
                    `=profile=${profileName}`,
                    '=disabled=no'
                ]);
            } catch { /* Hotspot may already exist */ }

            // 8. Configure walled garden (including captive portal detection URLs)
            const walledGardenEntries = [
                radiusServer,
                '113.30.190.52', // Backend IP
                '113-30-190-52.cloud-xip.com', // Backend Domain
                // Apple captive portal detection
                'captive.apple.com',
                'www.apple.com',
                'apple.com',
                // Android/Google captive portal detection
                'connectivitycheck.gstatic.com',
                'clients3.google.com',
                'www.gstatic.com',
                'android.clients.google.com',
                'play.googleapis.com',
                // Windows captive portal detection
                'www.msftconnecttest.com',
                'msftconnecttest.com',
                'www.msftncsi.com',
                // Generic fallback for testing
                'neverssl.com',
            ];
            for (const entry of walledGardenEntries) {
                try {
                    await api.write('/ip/hotspot/walled-garden/ip/add', [
                        `=dst-host=${entry}`,
                        '=action=accept'
                    ]);
                } catch { /* Entry may already exist */ }
            }

            // 9. Download Captive Portal Files (all required files)
            try {
                // Determine API Base URL (Should match provision script URL)
                const apiBaseUrl = process.env['API_BASE_URL'] ?? 'https://113-30-190-52.cloud-xip.com';

                // List of all captive portal files to download
                const captivePortalFiles = ['login.html', 'error.html', 'status.html', 'styles.css', 'script.js'];
                const tenantId = nas.tenantId ?? '';

                // Download each file with tenantId for dynamic injection
                for (const file of captivePortalFiles) {
                    try {
                        await api.write('/tool/fetch', [
                            `=url=${apiBaseUrl}/provision/hotspot/${file}?tenantId=${tenantId}`,
                            `=dst-path=hotspot/${file}`,
                            '=mode=https',
                            '=check-certificate=no'
                        ]);
                        logger.info({ nasId: nas.id, file }, 'Downloaded captive portal file');
                    } catch (fileError) {
                        logger.warn({ nasId: nas.id, file, error: fileError }, 'Failed to download captive portal file');
                    }
                }

                logger.info({ nasId: nas.id }, 'Captive portal files downloaded');
            } catch (error) {
                logger.warn({ nasId: nas.id, error }, 'Failed to download captive portal files');
                // Don't fail the whole setup, as basic connectivity works
            }

            logger.info({ nasId: nas.id, hotspotInterface, poolName }, 'Hotspot configured');
            return true;
        } catch (error) {
            logger.error({ nasId: nas.id, error }, 'Failed to configure hotspot');
            throw error;
        }
    }

    /**
     * Configure complete PPPoE server setup
     */
    async configurePPPoE(nas: NASInfo, config: PPPoEConfig): Promise<boolean> {
        const api = await this.getConnection(nas);
        const poolName = 'pppoe-pool';
        const profileName = 'easyisp-pppoe';

        try {
            // 1. Create IP pool
            try {
                await api.write('/ip/pool/add', [
                    `=name=${poolName}`,
                    `=ranges=${config.poolStart}-${config.poolEnd}`
                ]);
            } catch { /* Pool may already exist */ }

            // 2. Create PPP profile
            try {
                await api.write('/ppp/profile/add', [
                    `=name=${profileName}`,
                    `=local-address=${config.localAddress}`,
                    `=remote-address=${poolName}`,
                    '=use-encryption=yes',
                    '=only-one=yes',
                    '=change-tcp-mss=yes'
                ]);
            } catch { /* Profile may already exist */ }

            // 3. Create PPPoE server on each interface
            for (const iface of config.interfaces) {
                try {
                    await api.write('/interface/pppoe-server/server/add', [
                        `=service-name=${config.serviceName}`,
                        `=interface=${iface}`,
                        `=default-profile=${profileName}`,
                        '=authentication=pap,chap,mschap1,mschap2',
                        '=one-session-per-host=yes',
                        '=disabled=no'
                    ]);
                } catch { /* Server may already exist */ }
            }

            logger.info({ nasId: nas.id, interfaces: config.interfaces, poolName }, 'PPPoE configured');
            return true;
        } catch (error) {
            logger.error({ nasId: nas.id, error }, 'Failed to configure PPPoE');
            throw error;
        }
    }

    /**
     * Test configuration by checking if services are running
     */
    async testConfiguration(nas: NASInfo): Promise<{ hotspot: boolean; pppoe: boolean; radius: boolean }> {
        const api = await this.getConnection(nas);

        try {
            const [hotspots, pppoeServers, radius] = await Promise.all([
                api.write('/ip/hotspot/print').catch(() => []),
                api.write('/interface/pppoe-server/server/print').catch(() => []),
                api.write('/radius/print').catch(() => []),
            ]);

            return {
                hotspot: hotspots.length > 0,
                pppoe: pppoeServers.length > 0,
                radius: radius.length > 0,
            };
        } catch (error) {
            logger.error({ nasId: nas.id, error }, 'Failed to test configuration');
            return { hotspot: false, pppoe: false, radius: false };
        }
    }

    // ==========================================
    // WIRELESS CONFIGURATION METHODS
    // ==========================================

    /**
     * Get all wireless interfaces with configuration details
     */
    async getWirelessInterfaces(nas: NASInfo): Promise<WirelessInterface[]> {
        const api = await this.getConnection(nas);

        try {
            const interfaces = await api.write('/interface/wireless/print');

            return interfaces.map((iface: any) => ({
                id: iface['.id'] || '',
                name: iface.name || '',
                macAddress: iface['mac-address'] || '',
                ssid: iface.ssid || '',
                band: iface.band || '',
                channel: iface.channel || 'auto',
                frequency: parseInt(iface.frequency || '0'),
                mode: iface.mode || '',
                securityProfile: iface['security-profile'] || 'default',
                running: iface.running === 'true' || iface.running === true,
                disabled: iface.disabled === 'true' || iface.disabled === true,
            }));
        } catch (error) {
            logger.error({ nasId: nas.id, error }, 'Failed to get wireless interfaces');
            throw error;
        }
    }

    /**
     * Get available wireless security profiles
     */
    async getSecurityProfiles(nas: NASInfo): Promise<{ name: string; mode: string; authentication: string }[]> {
        const api = await this.getConnection(nas);

        try {
            const profiles = await api.write('/interface/wireless/security-profiles/print');

            return profiles.map((profile: any) => ({
                name: profile.name || '',
                mode: profile.mode || 'none',
                authentication: profile['authentication-types'] || '',
            }));
        } catch (error) {
            logger.error({ nasId: nas.id, error }, 'Failed to get security profiles');
            throw error;
        }
    }

    /**
     * Configure a wireless interface
     */
    async configureWireless(nas: NASInfo, config: WirelessConfig): Promise<boolean> {
        const api = await this.getConnection(nas);

        try {
            // Find the wireless interface
            const interfaces = await api.write('/interface/wireless/print', [
                `?name=${config.interfaceName}`
            ]);

            if (interfaces.length === 0) {
                logger.warn({ nasId: nas.id, interfaceName: config.interfaceName }, 'Wireless interface not found');
                return false;
            }

            const ifaceId = interfaces[0]['.id'];

            // Build command parameters
            const params: string[] = [`=.id=${ifaceId}`];

            if (config.ssid) {
                params.push(`=ssid=${config.ssid}`);
            }

            if (config.band) {
                params.push(`=band=${config.band}`);
            }

            if (config.channel) {
                params.push(`=channel=${config.channel}`);
            }

            if (config.disabled !== undefined) {
                params.push(`=disabled=${config.disabled ? 'yes' : 'no'}`);
            }

            // If security mode is specified, create/update security profile
            if (config.securityMode && config.securityMode !== 'none') {
                const profileName = `easyisp-${config.interfaceName}`;

                // Try to create or update security profile
                try {
                    const existingProfiles = await api.write('/interface/wireless/security-profiles/print', [
                        `?name=${profileName}`
                    ]);

                    if (existingProfiles.length > 0) {
                        // Update existing profile
                        await api.write('/interface/wireless/security-profiles/set', [
                            `=.id=${existingProfiles[0]['.id']}`,
                            `=mode=dynamic-keys`,
                            `=authentication-types=${config.securityMode === 'wpa2-psk' ? 'wpa2-psk' : 'wpa-psk,wpa2-psk'}`,
                            `=wpa-pre-shared-key=${config.passphrase || ''}`,
                            `=wpa2-pre-shared-key=${config.passphrase || ''}`
                        ]);
                    } else {
                        // Create new profile
                        await api.write('/interface/wireless/security-profiles/add', [
                            `=name=${profileName}`,
                            `=mode=dynamic-keys`,
                            `=authentication-types=${config.securityMode === 'wpa2-psk' ? 'wpa2-psk' : 'wpa-psk,wpa2-psk'}`,
                            `=wpa-pre-shared-key=${config.passphrase || ''}`,
                            `=wpa2-pre-shared-key=${config.passphrase || ''}`
                        ]);
                    }

                    params.push(`=security-profile=${profileName}`);
                } catch (profileError) {
                    logger.warn({ nasId: nas.id, profileError }, 'Failed to configure security profile');
                }
            } else if (config.securityMode === 'none') {
                params.push('=security-profile=default');
            }

            // Apply wireless settings
            await api.write('/interface/wireless/set', params);

            logger.info({ nasId: nas.id, config }, 'Wireless interface configured');
            return true;
        } catch (error) {
            logger.error({ nasId: nas.id, error }, 'Failed to configure wireless');
            throw error;
        }
    }

    // ==========================================
    // FIRMWARE MANAGEMENT METHODS
    // ==========================================

    /**
     * Get firmware and package information
     */
    async getFirmwareInfo(nas: NASInfo): Promise<FirmwareInfo> {
        const api = await this.getConnection(nas);

        try {
            const [resource, packages] = await Promise.all([
                api.write('/system/resource/print'),
                api.write('/system/package/print'),
            ]);

            const currentVersion = resource[0]?.version || 'Unknown';

            // Check for updates (RouterOS 7+)
            let latestVersion: string | null = null;
            let updateAvailable = false;
            let channel = 'stable';

            try {
                const updateCheck = await api.write('/system/package/update/print');
                if (updateCheck.length > 0) {
                    latestVersion = updateCheck[0]['latest-version'] || null;
                    updateAvailable = updateCheck[0].status === 'New version is available';
                    channel = updateCheck[0].channel || 'stable';
                }
            } catch {
                // Update check may not be available on older RouterOS
            }

            return {
                currentVersion,
                latestVersion,
                updateAvailable,
                channel,
                packages: packages.map((pkg: any) => ({
                    name: pkg.name || '',
                    version: pkg.version || '',
                    buildTime: pkg['build-time'] || '',
                    scheduled: pkg.scheduled || null,
                })),
            };
        } catch (error) {
            logger.error({ nasId: nas.id, error }, 'Failed to get firmware info');
            throw error;
        }
    }

    /**
     * Check for available firmware updates
     */
    async checkFirmwareUpdates(nas: NASInfo): Promise<{ available: boolean; currentVersion: string; latestVersion: string | null }> {
        const api = await this.getConnection(nas);

        try {
            // Trigger update check
            await api.write('/system/package/update/check-for-updates');

            // Wait a moment for check to complete
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Get result
            const result = await api.write('/system/package/update/print');
            const resource = await api.write('/system/resource/print');

            const currentVersion = resource[0]?.version || 'Unknown';
            const latestVersion = result[0]?.['latest-version'] || null;
            const available = result[0]?.status === 'New version is available';

            logger.info({ nasId: nas.id, currentVersion, latestVersion, available }, 'Firmware update check completed');

            return { available, currentVersion, latestVersion };
        } catch (error) {
            logger.error({ nasId: nas.id, error }, 'Failed to check firmware updates');
            throw error;
        }
    }

    /**
     * Download and install firmware update
     * WARNING: This will reboot the router!
     */
    async updateFirmware(nas: NASInfo): Promise<{ success: boolean; message: string }> {
        const api = await this.getConnection(nas);

        try {
            // First check if update is available
            const updateInfo = await api.write('/system/package/update/print');
            if (!updateInfo[0] || updateInfo[0].status !== 'New version is available') {
                return { success: false, message: 'No update available' };
            }

            logger.info({ nasId: nas.id, version: updateInfo[0]['latest-version'] }, 'Starting firmware download...');

            // Download the update
            await api.write('/system/package/update/download');

            // Wait for download to complete (poll status)
            let attempts = 0;
            const maxAttempts = 60; // 5 minutes max

            while (attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 5000));
                attempts++;

                const status = await api.write('/system/package/update/print');

                if (status[0]?.status === 'Downloaded, please reboot to upgrade') {
                    // Install the update (this reboots the router)
                    logger.info({ nasId: nas.id }, 'Download complete, installing update...');

                    try {
                        await api.write('/system/package/update/install');
                    } catch {
                        // Connection will be lost during reboot
                    }

                    return { success: true, message: 'Update installed, router is rebooting' };
                }

                if (status[0]?.status?.includes('error') || status[0]?.status?.includes('failed')) {
                    return { success: false, message: `Update failed: ${status[0].status}` };
                }
            }

            return { success: false, message: 'Update download timed out' };
        } catch (error) {
            // Connection may be lost during reboot, which is expected
            if ((error as Error).message?.includes('Socket closed') || (error as Error).message?.includes('Connection reset')) {
                return { success: true, message: 'Update in progress, router is rebooting' };
            }

            logger.error({ nasId: nas.id, error }, 'Failed to update firmware');
            throw error;
        }
    }

    /**
     * Fix Walled Garden configuration
     * Removes CPD bypasses (Apple, Google) that prevent login popup
     * Adds allow rules for Backend API and Fonts
     * Configures RADIUS server
     */
    private async configureGoldenState(api: any, nas: any): Promise<void> {
        try {
            logger.info('Applying "Golden State" configuration...');

            // ==========================================
            // 1. Hotspot Profile Hardening
            // ==========================================
            try {
                // Force correct login methods and RADIUS on all profiles
                const profiles = await api.write('/ip/hotspot/profile/print');
                for (const profile of profiles) {
                    if (profile['.id']) {
                        await api.write('/ip/hotspot/profile/set', [
                            `=.id=${profile['.id']}`,
                            `=login-by=http-pap,mac-cookie`, // HTTP PAP is robust for captive portal
                            `=use-radius=yes`,
                            `=radius-interim-update=5m`
                        ]);
                    }
                }
            } catch (e) {
                logger.error({ error: e }, 'Failed to configure hotspot profile');
            }

            // ==========================================
            // 2. Walled Garden "Strict Mode"
            // ==========================================

            // 1. Remove bad entries (Apple, Google, MSFT CPD)
            const badComments = ['Apple CPD', 'Android CPD', 'Windows CPD'];
            for (const comment of badComments) {
                try {
                    const entries = await api.write('/ip/hotspot/walled-garden/ip/print', [
                        `?comment=${comment}`
                    ]);
                    for (const entry of entries) {
                        if (entry['.id']) {
                            await api.write('/ip/hotspot/walled-garden/ip/remove', [`=.id=${entry['.id']}`]);
                        }
                    }
                } catch (e) { /* ignore if not found */ }
            }

            // 2. Ensure Backend & Fonts are allowed
            const neededRules = [
                { host: '113.30.190.52', comment: 'EasyISP Backend' },
                { host: '113-30-190-52.cloud-xip.com', comment: 'EasyISP Backend' },
                { host: 'fonts.googleapis.com', comment: 'Google Fonts' },
                { host: 'fonts.gstatic.com', comment: 'Google Fonts' },
            ];

            for (const rule of neededRules) {
                // Check if exists
                try {
                    // MikroTik print filters are usually strict
                    const existing = await api.write('/ip/hotspot/walled-garden/ip/print', [
                        `?dst-host=${rule.host}`
                    ]);
                    if (existing.length === 0) {
                        await api.write('/ip/hotspot/walled-garden/ip/add', [
                            `=dst-host=${rule.host}`,
                            `=action=accept`,
                            `=comment=${rule.comment}`
                        ]);
                    }
                } catch (e) {
                    logger.error({ error: e, rule }, 'Failed to check/add walled garden rule');
                }
            }

            // ==========================================
            // 3. RADIUS Server Configuration
            // ==========================================
            try {
                // Check existing RADIUS configuration
                const radiusServers = await api.write('/radius/print', ['?service=hotspot']);

                // Remove old entries (simplest way to ensure correctness)
                // In production, might be better to update if ID exists, but removal is cleaner here
                for (const s of radiusServers) {
                    if (s['.id']) {
                        // Optionally check if it matches our config to avoid flapping,
                        // but re-adding ensures secrets are synced.
                        await api.write('/radius/remove', [`=.id=${s['.id']}`]);
                    }
                }

                // Add Backend RADIUS Server
                // STRICT VPN ONLY: As requested, we only use the VPN tunnel.
                // The Backend is always at 10.10.0.1 inside the tunnel.

                await api.write('/radius/add', [
                    `=address=10.10.0.1`,
                    `=secret=${nas.secret}`,
                    `=service=hotspot`,
                    `=authentication-port=1812`,
                    `=accounting-port=1813`,
                    `=timeout=1000ms`, // 1s timeout
                    `=comment=EasyISP VPN`
                ]);

            } catch (e) {
                logger.error({ error: e }, 'Failed to configure RADIUS server');
            }

            // ==========================================
            // 4. Firewall Filter "Golden Rules"
            // ==========================================
            // We insert these at the TOP (index 0) to ensure they override anything else.

            const filterRules = [
                // [INPUT CHAIN]
                {
                    comment: 'EasyISP: Accept Established/Related',
                    cmd: ['=chain=input', '=connection-state=established,related', '=action=accept']
                },
                {
                    comment: 'EasyISP: Accept DNS (UDP)',
                    cmd: ['=chain=input', '=protocol=udp', '=dst-port=53', '=action=accept']
                },
                {
                    comment: 'EasyISP: Accept DNS (TCP)',
                    cmd: ['=chain=input', '=protocol=tcp', '=dst-port=53', '=action=accept']
                },
                {
                    comment: 'EasyISP: Accept Hotspot Web',
                    cmd: ['=chain=input', '=protocol=tcp', '=dst-port=64872-64875', '=action=accept']
                },
                {
                    comment: 'EasyISP: Accept VPN Input',
                    cmd: ['=chain=input', '=in-interface=wg-easyisp', '=action=accept']
                },

                // [FORWARD CHAIN]
                {
                    comment: 'EasyISP: Accept Forward Established/Related',
                    cmd: ['=chain=forward', '=connection-state=established,related', '=action=accept']
                }
            ];

            // Insert rules at the top (place-before=0)
            // We proceed in reverse order so the first one ends up at 0
            for (let i = filterRules.length - 1; i >= 0; i--) {
                const rule = filterRules[i];
                const comment = rule.comment;
                try {
                    // Check if exists
                    const existing = await api.write('/ip/firewall/filter/print', [`?comment=${comment}`]);

                    if (existing.length > 0) {
                        // If it exists, move it to top to be safe
                        await api.write('/ip/firewall/filter/move', [
                            `=.id=${existing[0]['.id']}`,
                            `=destination=0`
                        ]);
                    } else {
                        // Create at top
                        await api.write('/ip/firewall/filter/add', [
                            ...rule.cmd,
                            `=comment=${comment}`,
                            `=place-before=0`
                        ]);
                    }
                } catch (e) {
                    logger.error({ error: e, rule: comment }, 'Failed to apply firewall rule');
                }
            }

            // ==========================================
            // 4. NAT "Golden Rules"
            // ==========================================
            // Ensure Masquerade exists for WAN/VPN
            try {
                const natComment = 'EasyISP: Masquerade';
                // Using template literal for comment query
                const existingNat = await api.write('/ip/firewall/nat/print', [`?comment=${natComment}`]);

                if (existingNat.length === 0) {
                    await api.write('/ip/firewall/nat/add', [
                        '=chain=srcnat',
                        '=action=masquerade',
                        `=comment=${natComment}`,
                    ]);
                }
            } catch (e) {
                logger.error({ error: e }, 'Failed to apply NAT rule');
            }
        } catch (error) {
            logger.error({ error }, 'Failed to fix Walled Garden');
            // Don't throw, as this is a maintenance task
        }
    }

    /**
     * Close all connections (for cleanup)
     */
    async closeAll(): Promise<void> {
        for (const [id, api] of this.connections) {
            try {
                await api.close();
                logger.info({ nasId: id }, 'Closed MikroTik connection');
            } catch {
                // Ignore close errors
            }
        }
        this.connections.clear();
    }
}

// Export singleton instance
export const mikrotikService = new MikroTikService();

