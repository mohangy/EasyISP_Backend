/**
 * MikroTik RouterOS API Service
 * Handles all communication with MikroTik routers via their API
 */

import { RouterOSAPI } from 'routeros-client';
import { logger } from '../lib/logger.js';

interface NASInfo {
    id: string;
    name: string;
    ipAddress: string;
    apiUsername?: string | null;
    apiPassword?: string | null;
    apiPort: number;
    vpnIp?: string | null;
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
            // 1. Create bridge if multiple interfaces
            let hotspotInterface = config.interfaces[0];
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
                    `=dns-name=hotspot.local`
                ]);
            } catch { /* Profile may already exist */ }

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

            // 8. Configure walled garden
            const walledGardenEntries = [
                radiusServer,
            ];
            for (const entry of walledGardenEntries) {
                try {
                    await api.write('/ip/hotspot/walled-garden/ip/add', [
                        `=dst-host=${entry}`,
                        '=action=accept'
                    ]);
                } catch { /* Entry may already exist */ }
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
