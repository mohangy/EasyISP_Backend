/**
 * RADIUS Change of Authorization (CoA) Handler
 * RFC 5176 - Dynamic Authorization Extensions to RADIUS
 * 
 * Used to:
 * - Disconnect users (Disconnect-Request)
 * - Change session attributes (CoA-Request)
 */

import dgram from 'dgram';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import {
    type AttributeBuilder,
    createRequest,
    parsePacket,
} from '../packet.js';
import {
    RadiusCode,
    RadiusAttributeType,
    MikroTikAttribute,
    MIKROTIK_VENDOR_ID,
} from '../dictionary.js';

const COA_TIMEOUT = 5000; // 5 seconds

export interface DisconnectResult {
    success: boolean;
    message: string;
}

/**
 * Send Disconnect-Request to router to terminate a session
 */
export async function disconnectSession(
    nasIp: string,
    coaPort: number,
    secret: string,
    sessionId: string,
    username?: string
): Promise<DisconnectResult> {
    return new Promise((resolve) => {
        const identifier = Math.floor(Math.random() * 256);

        const attributes: AttributeBuilder[] = [];

        // Add session ID
        if (sessionId) {
            attributes.push({
                type: RadiusAttributeType.ACCT_SESSION_ID,
                value: sessionId,
            });
        }

        // Add username
        if (username) {
            attributes.push({
                type: RadiusAttributeType.USER_NAME,
                value: username,
            });
        }

        const packet = createRequest(
            RadiusCode.DISCONNECT_REQUEST,
            identifier,
            attributes,
            secret
        );

        const socket = dgram.createSocket('udp4');
        let responded = false;

        const timeout = setTimeout(() => {
            if (!responded) {
                responded = true;
                socket.close();
                logger.warn({ nasIp, coaPort, sessionId }, 'CoA Disconnect-Request timeout');
                resolve({ success: false, message: 'Request timed out' });
            }
        }, COA_TIMEOUT);

        socket.on('message', (msg) => {
            if (responded) return;
            responded = true;
            clearTimeout(timeout);
            socket.close();

            try {
                const response = parsePacket(msg);

                if (response.identifier !== identifier) {
                    logger.warn({ expected: identifier, received: response.identifier }, 'CoA identifier mismatch');
                    resolve({ success: false, message: 'Invalid response' });
                    return;
                }

                if (response.code === RadiusCode.DISCONNECT_ACK) {
                    logger.info({ nasIp, sessionId, username }, 'User disconnected successfully');
                    resolve({ success: true, message: 'User disconnected' });
                } else if (response.code === RadiusCode.DISCONNECT_NAK) {
                    logger.info({ nasIp, sessionId, username }, 'Disconnect-NAK received');
                    resolve({ success: false, message: 'Router rejected disconnect request' });
                } else {
                    resolve({ success: false, message: `Unexpected response code: ${response.code}` });
                }
            } catch (error) {
                logger.error({ error }, 'Failed to parse CoA response');
                resolve({ success: false, message: 'Failed to parse response' });
            }
        });

        socket.on('error', (err) => {
            if (responded) return;
            responded = true;
            clearTimeout(timeout);
            socket.close();
            logger.error({ err, nasIp, coaPort }, 'CoA socket error');
            resolve({ success: false, message: `Socket error: ${err.message}` });
        });

        socket.send(packet, coaPort, nasIp, (err) => {
            if (err) {
                if (responded) return;
                responded = true;
                clearTimeout(timeout);
                socket.close();
                logger.error({ err, nasIp, coaPort }, 'Failed to send CoA packet');
                resolve({ success: false, message: `Send error: ${err.message}` });
            } else {
                logger.debug({ nasIp, coaPort, sessionId }, 'Disconnect-Request sent');
            }
        });
    });
}

/**
 * Send CoA-Request to update session attributes (e.g., change speed)
 */
export async function updateSession(
    nasIp: string,
    coaPort: number,
    secret: string,
    sessionId: string,
    username: string,
    newRateLimit: string
): Promise<DisconnectResult> {
    return new Promise((resolve) => {
        const identifier = Math.floor(Math.random() * 256);

        const attributes: AttributeBuilder[] = [
            {
                type: RadiusAttributeType.ACCT_SESSION_ID,
                value: sessionId,
            },
            {
                type: RadiusAttributeType.USER_NAME,
                value: username,
            },
            {
                type: MikroTikAttribute.RATE_LIMIT,
                value: newRateLimit,
                vendorId: MIKROTIK_VENDOR_ID,
                vendorType: MikroTikAttribute.RATE_LIMIT,
            },
        ];

        const packet = createRequest(
            RadiusCode.COA_REQUEST,
            identifier,
            attributes,
            secret
        );

        const socket = dgram.createSocket('udp4');
        let responded = false;

        const timeout = setTimeout(() => {
            if (!responded) {
                responded = true;
                socket.close();
                logger.warn({ nasIp, coaPort, sessionId }, 'CoA-Request timeout');
                resolve({ success: false, message: 'Request timed out' });
            }
        }, COA_TIMEOUT);

        socket.on('message', (msg) => {
            if (responded) return;
            responded = true;
            clearTimeout(timeout);
            socket.close();

            try {
                const response = parsePacket(msg);

                if (response.code === RadiusCode.COA_ACK) {
                    logger.info({ nasIp, sessionId, newRateLimit }, 'Session updated successfully');
                    resolve({ success: true, message: 'Session updated' });
                } else if (response.code === RadiusCode.COA_NAK) {
                    logger.info({ nasIp, sessionId }, 'CoA-NAK received');
                    resolve({ success: false, message: 'Router rejected update request' });
                } else {
                    resolve({ success: false, message: `Unexpected response code: ${response.code}` });
                }
            } catch (error) {
                logger.error({ error }, 'Failed to parse CoA response');
                resolve({ success: false, message: 'Failed to parse response' });
            }
        });

        socket.on('error', (err) => {
            if (responded) return;
            responded = true;
            clearTimeout(timeout);
            socket.close();
            logger.error({ err, nasIp, coaPort }, 'CoA socket error');
            resolve({ success: false, message: `Socket error: ${err.message}` });
        });

        socket.send(packet, coaPort, nasIp, (err) => {
            if (err) {
                if (responded) return;
                responded = true;
                clearTimeout(timeout);
                socket.close();
                logger.error({ err, nasIp, coaPort }, 'Failed to send CoA packet');
                resolve({ success: false, message: `Send error: ${err.message}` });
            } else {
                logger.debug({ nasIp, coaPort, sessionId, newRateLimit }, 'CoA-Request sent');
            }
        });
    });
}

/**
 * Disconnect a user by username (finds session and disconnects)
 */
export async function disconnectUser(username: string, tenantId: string): Promise<DisconnectResult> {
    // Find active session
    const session = await prisma.session.findFirst({
        where: {
            username,
            stopTime: null,
            customer: { tenantId },
        },
        include: {
            nas: true,
        },
    });

    if (!session) {
        return { success: false, message: 'No active session found' };
    }

    if (!session.nas) {
        return { success: false, message: 'Session NAS not found' };
    }

    // Use VPN IP if available, otherwise public IP
    const nasIp = session.nas.vpnIp || session.nas.ipAddress;

    return disconnectSession(
        nasIp,
        session.nas.coaPort,
        session.nas.secret,
        session.sessionId,
        username
    );
}

/**
 * Update a user's speed in real-time via CoA
 */
export async function updateUserSpeed(
    username: string,
    tenantId: string,
    uploadMbps: number,
    downloadMbps: number
): Promise<DisconnectResult> {
    // Find active session
    const session = await prisma.session.findFirst({
        where: {
            username,
            stopTime: null,
            customer: { tenantId },
        },
        include: {
            nas: true,
        },
    });

    if (!session) {
        return { success: false, message: 'No active session found' };
    }

    if (!session.nas) {
        return { success: false, message: 'Session NAS not found' };
    }

    const nasIp = session.nas.vpnIp || session.nas.ipAddress;
    const rateLimit = `${uploadMbps}M/${downloadMbps}M`;

    return updateSession(
        nasIp,
        session.nas.coaPort,
        session.nas.secret,
        session.sessionId,
        username,
        rateLimit
    );
}
