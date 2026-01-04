/**
 * RouterOS v7+ REST API Service
 * Uses HTTPS fetch calls to communicate with MikroTik routers via /rest endpoint
 * 
 * Requirements:
 * - RouterOS v7.1+ with www-ssl service enabled
 * - HTTP Basic Authentication
 * - Self-signed certificates supported
 */

import https from 'https';
import { logger } from '../lib/logger.js';

// Allow self-signed certificates (common in router deployments)
const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
});

// Router connection info
export interface RouterConnection {
    id: string;
    name: string;
    host: string;         // IP or hostname (prefer VPN IP)
    username: string;
    password: string;
    port?: number;        // Default 443
    useTls?: boolean;     // Default true
}

// System resources response
export interface SystemResources {
    uptime: string;
    version: string;
    buildTime: string;
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

// Interface info
export interface RouterInterface {
    id: string;
    name: string;
    type: string;
    macAddress: string;
    running: boolean;
    disabled: boolean;
    comment: string;
}

// Hotspot user
export interface HotspotUser {
    id: string;
    name: string;
    address: string;
    macAddress: string;
    uptime: string;
    bytesIn: number;
    bytesOut: number;
    packetsIn: number;
    packetsOut: number;
}

// PPPoE active connection
export interface PPPoEConnection {
    id: string;
    name: string;
    service: string;
    callerId: string;
    address: string;
    uptime: string;
    encoding: string;
}

/**
 * MikroTik REST API Service
 */
class MikroTikRestService {
    private timeout = 10000; // 10 seconds

    /**
     * Make a REST API request
     */
    private async request<T>(
        router: RouterConnection,
        method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        path: string,
        body?: Record<string, unknown>
    ): Promise<T> {
        const port = router.port ?? 443;
        const protocol = router.useTls !== false ? 'https' : 'http';
        const url = `${protocol}://${router.host}:${port}/rest${path}`;

        const auth = Buffer.from(`${router.username}:${router.password}`).toString('base64');

        const options: RequestInit = {
            method,
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json',
            },
            // @ts-ignore - Node.js specific
            agent: router.useTls !== false ? httpsAgent : undefined,
            signal: AbortSignal.timeout(this.timeout),
        };

        if (body && method !== 'GET') {
            options.body = JSON.stringify(body);
        }

        try {
            logger.debug({ url, method, routerId: router.id }, 'REST API request');

            const response = await fetch(url, options);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`REST API error ${response.status}: ${errorText}`);
            }

            // Handle empty responses (DELETE, some POST)
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                return {} as T;
            }

            return await response.json() as T;
        } catch (error) {
            logger.error({ error, url, routerId: router.id }, 'REST API request failed');
            throw error;
        }
    }

    /**
     * Test connection to router
     */
    async testConnection(router: RouterConnection): Promise<boolean> {
        try {
            await this.request(router, 'GET', '/system/resource');
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get system resources (CPU, memory, version, etc.)
     */
    async getSystemResources(router: RouterConnection): Promise<SystemResources> {
        const data = await this.request<Record<string, string>[]>(router, 'GET', '/system/resource');
        const r = data[0] || {};

        return {
            uptime: r['uptime'] || '0s',
            version: r['version'] || 'Unknown',
            buildTime: r['build-time'] || '',
            freeMemory: parseInt(r['free-memory'] || '0'),
            totalMemory: parseInt(r['total-memory'] || '0'),
            cpu: r['cpu'] || 'Unknown',
            cpuCount: parseInt(r['cpu-count'] || '1'),
            cpuFrequency: parseInt(r['cpu-frequency'] || '0'),
            cpuLoad: parseInt(r['cpu-load'] || '0'),
            freeHddSpace: parseInt(r['free-hdd-space'] || '0'),
            totalHddSpace: parseInt(r['total-hdd-space'] || '0'),
            architectureName: r['architecture-name'] || '',
            boardName: r['board-name'] || 'Unknown',
            platform: r['platform'] || 'MikroTik',
        };
    }

    /**
     * Get system identity (router name)
     */
    async getIdentity(router: RouterConnection): Promise<string> {
        const data = await this.request<{ name: string }[]>(router, 'GET', '/system/identity');
        return data[0]?.name || 'Unknown';
    }

    /**
     * Set system identity
     */
    async setIdentity(router: RouterConnection, name: string): Promise<void> {
        await this.request(router, 'POST', '/system/identity/set', { name });
    }

    /**
     * Get all interfaces
     */
    async getInterfaces(router: RouterConnection): Promise<RouterInterface[]> {
        const data = await this.request<Record<string, string>[]>(router, 'GET', '/interface');

        return data.map(iface => ({
            id: iface['.id'] || '',
            name: iface['name'] || '',
            type: iface['type'] || 'unknown',
            macAddress: iface['mac-address'] || '',
            running: iface['running'] === 'true',
            disabled: iface['disabled'] === 'true',
            comment: iface['comment'] || '',
        }));
    }

    /**
     * Get active hotspot users
     */
    async getHotspotActive(router: RouterConnection): Promise<HotspotUser[]> {
        const data = await this.request<Record<string, string>[]>(router, 'GET', '/ip/hotspot/active');

        return data.map(user => ({
            id: user['.id'] || '',
            name: user['user'] || '',
            address: user['address'] || '',
            macAddress: user['mac-address'] || '',
            uptime: user['uptime'] || '0s',
            bytesIn: parseInt(user['bytes-in'] || '0'),
            bytesOut: parseInt(user['bytes-out'] || '0'),
            packetsIn: parseInt(user['packets-in'] || '0'),
            packetsOut: parseInt(user['packets-out'] || '0'),
        }));
    }

    /**
     * Disconnect hotspot user by ID
     */
    async disconnectHotspotUser(router: RouterConnection, userId: string): Promise<void> {
        await this.request(router, 'DELETE', `/ip/hotspot/active/${userId}`);
    }

    /**
     * Get active PPPoE connections
     */
    async getPPPoEActive(router: RouterConnection): Promise<PPPoEConnection[]> {
        const data = await this.request<Record<string, string>[]>(router, 'GET', '/ppp/active');

        return data.map(conn => ({
            id: conn['.id'] || '',
            name: conn['name'] || '',
            service: conn['service'] || 'pppoe',
            callerId: conn['caller-id'] || '',
            address: conn['address'] || '',
            uptime: conn['uptime'] || '0s',
            encoding: conn['encoding'] || '',
        }));
    }

    /**
     * Disconnect PPPoE user by ID
     */
    async disconnectPPPoEUser(router: RouterConnection, userId: string): Promise<void> {
        await this.request(router, 'DELETE', `/ppp/active/${userId}`);
    }

    /**
     * Get RADIUS configuration
     */
    async getRadiusServers(router: RouterConnection): Promise<Record<string, string>[]> {
        return await this.request<Record<string, string>[]>(router, 'GET', '/radius');
    }

    /**
     * Add RADIUS server
     */
    async addRadiusServer(
        router: RouterConnection,
        address: string,
        secret: string,
        service: string = 'hotspot,login,ppp'
    ): Promise<string> {
        const result = await this.request<{ ret: string }>(router, 'PUT', '/radius', {
            address,
            secret,
            service,
            'authentication-port': 1812,
            'accounting-port': 1813,
            timeout: '3000ms',
        });
        return result.ret; // Returns the new item ID
    }

    /**
     * Remove RADIUS server by ID
     */
    async removeRadiusServer(router: RouterConnection, serverId: string): Promise<void> {
        await this.request(router, 'DELETE', `/radius/${serverId}`);
    }

    /**
     * Get hotspot profiles
     */
    async getHotspotProfiles(router: RouterConnection): Promise<Record<string, string>[]> {
        return await this.request<Record<string, string>[]>(router, 'GET', '/ip/hotspot/profile');
    }

    /**
     * Update hotspot profile
     */
    async updateHotspotProfile(
        router: RouterConnection,
        profileId: string,
        config: Record<string, string | boolean>
    ): Promise<void> {
        await this.request(router, 'PATCH', `/ip/hotspot/profile/${profileId}`, config);
    }

    /**
     * Get hotspot servers
     */
    async getHotspotServers(router: RouterConnection): Promise<Record<string, string>[]> {
        return await this.request<Record<string, string>[]>(router, 'GET', '/ip/hotspot');
    }

    /**
     * Create hotspot server
     */
    async createHotspotServer(
        router: RouterConnection,
        config: {
            name: string;
            interface: string;
            addressPool: string;
            profile: string;
        }
    ): Promise<string> {
        const result = await this.request<{ ret: string }>(router, 'PUT', '/ip/hotspot', {
            name: config.name,
            interface: config.interface,
            'address-pool': config.addressPool,
            profile: config.profile,
            disabled: 'no',
        });
        return result.ret;
    }

    /**
     * Get walled garden IP entries
     */
    async getWalledGarden(router: RouterConnection): Promise<Record<string, string>[]> {
        return await this.request<Record<string, string>[]>(router, 'GET', '/ip/hotspot/walled-garden/ip');
    }

    /**
     * Add walled garden entry
     */
    async addWalledGardenEntry(
        router: RouterConnection,
        dstHost: string,
        action: string = 'accept',
        comment?: string
    ): Promise<string> {
        const result = await this.request<{ ret: string }>(router, 'PUT', '/ip/hotspot/walled-garden/ip', {
            'dst-host': dstHost,
            action,
            ...(comment && { comment }),
        });
        return result.ret;
    }

    /**
     * Get IP pools
     */
    async getIPPools(router: RouterConnection): Promise<Record<string, string>[]> {
        return await this.request<Record<string, string>[]>(router, 'GET', '/ip/pool');
    }

    /**
     * Create IP pool
     */
    async createIPPool(router: RouterConnection, name: string, ranges: string): Promise<string> {
        const result = await this.request<{ ret: string }>(router, 'PUT', '/ip/pool', {
            name,
            ranges,
        });
        return result.ret;
    }

    /**
     * Get IP addresses
     */
    async getIPAddresses(router: RouterConnection): Promise<Record<string, string>[]> {
        return await this.request<Record<string, string>[]>(router, 'GET', '/ip/address');
    }

    /**
     * Add IP address to interface
     */
    async addIPAddress(router: RouterConnection, address: string, interfaceName: string): Promise<string> {
        const result = await this.request<{ ret: string }>(router, 'PUT', '/ip/address', {
            address,
            interface: interfaceName,
        });
        return result.ret;
    }

    /**
     * Get DHCP servers
     */
    async getDHCPServers(router: RouterConnection): Promise<Record<string, string>[]> {
        return await this.request<Record<string, string>[]>(router, 'GET', '/ip/dhcp-server');
    }

    /**
     * Create DHCP server
     */
    async createDHCPServer(
        router: RouterConnection,
        name: string,
        interfaceName: string,
        addressPool: string
    ): Promise<string> {
        const result = await this.request<{ ret: string }>(router, 'PUT', '/ip/dhcp-server', {
            name,
            interface: interfaceName,
            'address-pool': addressPool,
            'lease-time': '1h',
            disabled: 'no',
        });
        return result.ret;
    }

    /**
     * Get DNS settings
     */
    async getDNS(router: RouterConnection): Promise<Record<string, string>> {
        const data = await this.request<Record<string, string>[]>(router, 'GET', '/ip/dns');
        return data[0] || {};
    }

    /**
     * Set DNS servers
     */
    async setDNS(router: RouterConnection, servers: string): Promise<void> {
        await this.request(router, 'POST', '/ip/dns/set', {
            servers,
            'allow-remote-requests': 'yes',
        });
    }

    /**
     * Get firewall NAT rules
     */
    async getNATRules(router: RouterConnection): Promise<Record<string, string>[]> {
        return await this.request<Record<string, string>[]>(router, 'GET', '/ip/firewall/nat');
    }

    /**
     * Add NAT masquerade rule
     */
    async addNATMasquerade(router: RouterConnection, outInterface: string, comment?: string): Promise<string> {
        const result = await this.request<{ ret: string }>(router, 'PUT', '/ip/firewall/nat', {
            chain: 'srcnat',
            action: 'masquerade',
            'out-interface': outInterface,
            ...(comment && { comment }),
        });
        return result.ret;
    }

    /**
     * Create system backup
     */
    async createBackup(router: RouterConnection, name?: string): Promise<void> {
        const backupName = name || `easyisp-backup-${Date.now()}`;
        await this.request(router, 'POST', '/system/backup/save', { name: backupName });
    }

    /**
     * Enable CoA (Change of Authorization) on router
     */
    async enableCoA(router: RouterConnection, port: number = 3799): Promise<void> {
        await this.request(router, 'POST', '/radius/incoming/set', {
            accept: 'yes',
            port: port.toString(),
        });
    }

    /**
     * Configure PPP AAA settings
     */
    async configurePPPAAA(router: RouterConnection): Promise<void> {
        await this.request(router, 'POST', '/ppp/aaa/set', {
            'use-radius': 'yes',
            accounting: 'yes',
            'interim-update': '5m',
        });
    }

    /**
     * Configure User AAA settings
     */
    async configureUserAAA(router: RouterConnection): Promise<void> {
        await this.request(router, 'POST', '/user/aaa/set', {
            'use-radius': 'yes',
            accounting: 'yes',
            'interim-update': '5m',
        });
    }

    /**
     * Run a script on the router
     */
    async runScript(router: RouterConnection, script: string): Promise<void> {
        await this.request(router, 'POST', '/system/script/run', {
            source: script,
        });
    }

    /**
     * Fetch file from URL to router
     */
    async fetchFile(router: RouterConnection, url: string, dstPath: string): Promise<void> {
        await this.request(router, 'POST', '/tool/fetch', {
            url,
            'dst-path': dstPath,
            mode: 'https',
            'check-certificate': 'no',
        });
    }
}

// Export singleton instance
export const mikrotikRestService = new MikroTikRestService();

// Helper: Convert NAS database model to RouterConnection
export function nasToConnection(nas: {
    id: string;
    name: string;
    ipAddress: string;
    vpnIp?: string | null;
    restUsername?: string | null;
    restPassword?: string | null;
    apiUsername?: string | null;
    apiPassword?: string | null;
}): RouterConnection {
    return {
        id: nas.id,
        name: nas.name,
        host: nas.vpnIp || nas.ipAddress,
        username: nas.restUsername || nas.apiUsername || 'admin',
        password: nas.restPassword || nas.apiPassword || '',
        port: 443,
        useTls: true,
    };
}
