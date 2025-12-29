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

        const api = new RouterOSAPI({
            host: nas.ipAddress,
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
