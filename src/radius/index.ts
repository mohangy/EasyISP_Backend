/**
 * EasyISP RADIUS Server
 * Custom implementation for MikroTik Hotspot and PPPoE authentication
 */

import dgram from 'dgram';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { parsePacket } from './packet.js';
import { RadiusCode } from './dictionary.js';
import { handleAccessRequest } from './handlers/access.js';
import { handleAccountingRequest } from './handlers/accounting.js';

export interface RadiusServerConfig {
    authPort: number;
    acctPort: number;
    coaPort: number;
}

const DEFAULT_CONFIG: RadiusServerConfig = {
    authPort: parseInt(process.env['RADIUS_PORT'] ?? '1812'),
    acctPort: parseInt(process.env['RADIUS_ACCT_PORT'] ?? '1813'),
    coaPort: parseInt(process.env['RADIUS_COA_PORT'] ?? '3799'),
};

class RadiusServer {
    private authSocket: dgram.Socket | null = null;
    private acctSocket: dgram.Socket | null = null;
    private config: RadiusServerConfig;
    private isRunning = false;

    constructor(config: Partial<RadiusServerConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Start the RADIUS server
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            logger.warn('RADIUS server already running');
            return;
        }

        // Start Authentication Server (UDP 1812)
        await this.startAuthServer();

        // Start Accounting Server (UDP 1813)
        await this.startAcctServer();

        this.isRunning = true;
        logger.info({
            authPort: this.config.authPort,
            acctPort: this.config.acctPort,
        }, 'RADIUS server started');
    }

    /**
     * Stop the RADIUS server
     */
    async stop(): Promise<void> {
        if (!this.isRunning) return;

        if (this.authSocket) {
            this.authSocket.close();
            this.authSocket = null;
        }

        if (this.acctSocket) {
            this.acctSocket.close();
            this.acctSocket = null;
        }

        this.isRunning = false;
        logger.info('RADIUS server stopped');
    }

    /**
     * Start Authentication server
     */
    private async startAuthServer(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.authSocket = dgram.createSocket('udp4');

            this.authSocket.on('error', (err) => {
                logger.error({ err }, 'RADIUS Auth server error');
                this.authSocket?.close();
                this.authSocket = null;
            });

            this.authSocket.on('message', async (msg, rinfo) => {
                await this.handleAuthPacket(msg, rinfo);
            });

            this.authSocket.bind(this.config.authPort, '0.0.0.0', () => {
                logger.info(`RADIUS Auth server listening on 0.0.0.0:${this.config.authPort}`);
                resolve();
            });
        });
    }

    /**
     * Start Accounting server
     */
    private async startAcctServer(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.acctSocket = dgram.createSocket('udp4');

            this.acctSocket.on('error', (err) => {
                logger.error({ err }, 'RADIUS Acct server error');
                this.acctSocket?.close();
                this.acctSocket = null;
            });

            this.acctSocket.on('message', async (msg, rinfo) => {
                await this.handleAcctPacket(msg, rinfo);
            });

            this.acctSocket.bind(this.config.acctPort, '0.0.0.0', () => {
                logger.info(`RADIUS Acct server listening on 0.0.0.0:${this.config.acctPort}`);
                resolve();
            });
        });
    }

    /**
     * Handle incoming authentication packet
     */
    private async handleAuthPacket(msg: Buffer, rinfo: dgram.RemoteInfo): Promise<void> {
        try {
            const packet = parsePacket(msg);
            const nasIp = rinfo.address;

            // Only handle Access-Request
            if (packet.code !== RadiusCode.ACCESS_REQUEST) {
                logger.warn({ code: packet.code, nasIp }, 'Unexpected packet type on auth port');
                return;
            }

            // Get shared secret for this NAS
            const secret = await this.getSecret(nasIp);
            if (!secret) {
                logger.warn({ nasIp }, 'Access-Request from unknown NAS');
                return;
            }

            // Process request
            const response = await handleAccessRequest(packet, secret, nasIp);

            // Send response
            this.authSocket?.send(response, rinfo.port, nasIp, (err) => {
                if (err) {
                    logger.error({ err, nasIp }, 'Failed to send Access-Response');
                }
            });
        } catch (error) {
            logger.error({ error, nasIp: rinfo.address }, 'Error processing auth packet');
        }
    }

    /**
     * Handle incoming accounting packet
     */
    private async handleAcctPacket(msg: Buffer, rinfo: dgram.RemoteInfo): Promise<void> {
        try {
            const packet = parsePacket(msg);
            const nasIp = rinfo.address;

            // Only handle Accounting-Request
            if (packet.code !== RadiusCode.ACCOUNTING_REQUEST) {
                logger.warn({ code: packet.code, nasIp }, 'Unexpected packet type on acct port');
                return;
            }

            // Get shared secret for this NAS
            const secret = await this.getSecret(nasIp);
            if (!secret) {
                logger.warn({ nasIp }, 'Accounting-Request from unknown NAS');
                return;
            }

            // Process request
            const response = await handleAccountingRequest(packet, secret, nasIp);

            // Send response
            this.acctSocket?.send(response, rinfo.port, nasIp, (err) => {
                if (err) {
                    logger.error({ err, nasIp }, 'Failed to send Accounting-Response');
                }
            });
        } catch (error) {
            logger.error({ error, nasIp: rinfo.address }, 'Error processing acct packet');
        }
    }

    /**
     * Get shared secret for a NAS
     */
    private async getSecret(nasIp: string): Promise<string | null> {
        const nas = await prisma.nAS.findFirst({
            where: {
                OR: [
                    { ipAddress: nasIp },
                    { vpnIp: nasIp },
                ],
            },
            select: { secret: true },
        });

        return nas?.secret || null;
    }

    /**
     * Get server status
     */
    getStatus(): { running: boolean; authPort: number; acctPort: number } {
        return {
            running: this.isRunning,
            authPort: this.config.authPort,
            acctPort: this.config.acctPort,
        };
    }
}

// Export singleton instance
export const radiusServer = new RadiusServer();

// Re-export types and utilities
export { RadiusCode } from './dictionary.js';
export { parsePacket, type RadiusPacket, type RadiusAttribute } from './packet.js';
export { disconnectUser, updateUserSpeed } from './handlers/coa.js';
