/**
 * RADIUS Access-Request Handler
 * Handles authentication requests from MikroTik routers
 */

import { createHash } from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import {
    type RadiusPacket,
    type AttributeBuilder,
    getAttribute,
    getAttributeString,
    decryptPassword,
    verifyChapPassword,
    createResponse,
} from '../packet.js';
import {
    RadiusCode,
    RadiusAttributeType,
    MikroTikAttribute,
    MIKROTIK_VENDOR_ID,
    ServiceType,
} from '../dictionary.js';

export interface AccessResult {
    code: RadiusCode.ACCESS_ACCEPT | RadiusCode.ACCESS_REJECT;
    attributes: AttributeBuilder[];
    replyMessage?: string;
}

export interface AuthContext {
    username: string;
    nasIp: string;
    nasIdentifier?: string;
    callingStationId?: string;  // MAC address
    calledStationId?: string;   // SSID or interface
    nasPortType?: number;
}

/**
 * Handle Access-Request packet
 */
export async function handleAccessRequest(
    packet: RadiusPacket,
    secret: string,
    nasIp: string
): Promise<Buffer> {
    const startTime = Date.now();

    try {
        // Extract authentication context
        const context = extractAuthContext(packet, nasIp);

        logger.info({
            username: context.username,
            nasIp: context.nasIp,
            mac: context.callingStationId,
        }, 'Access-Request received');

        // Authenticate the user
        const result = await authenticateUser(packet, secret, context);

        // Create response packet
        const response = createResponse(
            result.code,
            packet.identifier,
            packet.authenticator,
            result.attributes,
            secret
        );

        const duration = Date.now() - startTime;
        logger.info({
            username: context.username,
            result: result.code === RadiusCode.ACCESS_ACCEPT ? 'ACCEPT' : 'REJECT',
            duration,
            replyMessage: result.replyMessage,
        }, 'Access-Request processed');

        return response;
    } catch (error) {
        logger.error({ error, nasIp }, 'Access-Request handler error');

        // Return Access-Reject on error
        return createResponse(
            RadiusCode.ACCESS_REJECT,
            packet.identifier,
            packet.authenticator,
            [{ type: RadiusAttributeType.REPLY_MESSAGE, value: 'Internal server error' }],
            secret
        );
    }
}

/**
 * Extract authentication context from packet
 */
function extractAuthContext(packet: RadiusPacket, nasIp: string): AuthContext {
    const username = getAttributeString(packet, RadiusAttributeType.USER_NAME) || '';
    const nasIdentifier = getAttributeString(packet, RadiusAttributeType.NAS_IDENTIFIER);
    const callingStationId = getAttributeString(packet, RadiusAttributeType.CALLING_STATION_ID);
    const calledStationId = getAttributeString(packet, RadiusAttributeType.CALLED_STATION_ID);
    const nasPortTypeAttr = getAttribute(packet, RadiusAttributeType.NAS_PORT_TYPE);
    const nasPortType = typeof nasPortTypeAttr?.value === 'number' ? nasPortTypeAttr.value : undefined;

    // Get NAS-IP-Address from packet if available
    const nasIpAttr = getAttribute(packet, RadiusAttributeType.NAS_IP_ADDRESS);
    const packetNasIp = typeof nasIpAttr?.value === 'string' ? nasIpAttr.value : nasIp;

    return {
        username,
        nasIp: packetNasIp,
        nasIdentifier,
        callingStationId,
        calledStationId,
        nasPortType,
    };
}

/**
 * Authenticate user against database
 */
async function authenticateUser(
    packet: RadiusPacket,
    secret: string,
    context: AuthContext
): Promise<AccessResult> {
    // Find the NAS (router) in database
    const nas = await prisma.nAS.findFirst({
        where: {
            OR: [
                { ipAddress: context.nasIp },
                { vpnIp: context.nasIp },
            ],
        },
    });

    if (!nas) {
        logger.warn({ nasIp: context.nasIp }, 'Unknown NAS');
        return reject('Unknown network device');
    }

    // Verify the shared secret matches
    if (nas.secret !== secret) {
        logger.warn({ nasIp: context.nasIp }, 'Invalid RADIUS secret');
        return reject('Authentication failed');
    }

    // Find customer by username + tenant
    const customer = await prisma.customer.findFirst({
        where: {
            username: context.username,
            tenantId: nas.tenantId,
            deletedAt: null,
        },
        include: {
            package: true,
        },
    });

    if (!customer) {
        logger.info({ username: context.username, tenantId: nas.tenantId }, 'Customer not found');
        return reject('Invalid username or password');
    }

    // Verify password (PAP or CHAP)
    const passwordValid = await verifyPassword(packet, secret, customer.password);
    if (!passwordValid) {
        logger.info({ username: context.username }, 'Invalid password');
        return reject('Invalid username or password');
    }

    // Check customer status
    if (customer.status === 'SUSPENDED') {
        logger.info({ username: context.username }, 'Account suspended');
        return reject('Account suspended. Please contact support.');
    }

    if (customer.status === 'DISABLED') {
        logger.info({ username: context.username }, 'Account disabled');
        return reject('Account disabled');
    }

    // Check expiration
    if (customer.expiresAt && new Date(customer.expiresAt) < new Date()) {
        logger.info({ username: context.username, expiresAt: customer.expiresAt }, 'Account expired');
        return reject('Account expired. Please renew your subscription.');
    }

    // Check MAC Address Lock for Hotspot
    if (customer.connectionType === 'HOTSPOT' && customer.lastMac) {
        const reqMac = context.callingStationId?.replace(/[^A-Fa-f0-9]/g, '').toUpperCase();
        const lockedMac = customer.lastMac.replace(/[^A-Fa-f0-9]/g, '').toUpperCase();

        if (reqMac && lockedMac && reqMac !== lockedMac) {
            logger.warn({ username: context.username, reqMac, lockedMac }, 'MAC Address mismatch for locked account');
            return reject('This voucher is locked to another device');
        }
    }

    // Build Accept response with attributes
    const attributes: AttributeBuilder[] = [];

    // Add Service-Type
    attributes.push({
        type: RadiusAttributeType.SERVICE_TYPE,
        value: ServiceType.FRAMED,
    });

    // Add Framed-Protocol (PPP for PPPoE, none for Hotspot)
    if (customer.connectionType === 'PPPOE') {
        attributes.push({
            type: RadiusAttributeType.FRAMED_PROTOCOL,
            value: 1, // PPP
        });
    }

    // Add rate limiting (MikroTik-Rate-Limit)
    if (customer.package) {
        const rateLimit = `${customer.package.uploadSpeed}M/${customer.package.downloadSpeed}M`;
        attributes.push({
            type: MikroTikAttribute.RATE_LIMIT,
            value: rateLimit,
            vendorId: MIKROTIK_VENDOR_ID,
            vendorType: MikroTikAttribute.RATE_LIMIT,
        });

        // Add burst if configured
        if (customer.package.burstDownload && customer.package.burstUpload) {
            const burstRate = `${customer.package.uploadSpeed}M/${customer.package.downloadSpeed}M ${customer.package.burstUpload}M/${customer.package.burstDownload}M 0/0 1/1 5`;
            // Override with burst format: rx/tx rx-burst/tx-burst threshold-rx/tx time-rx/tx priority
            attributes[attributes.length - 1].value = burstRate;
        }
    }

    // Add session timeout for hotspot (based on sessionTime)
    if (customer.connectionType === 'HOTSPOT' && customer.package?.sessionTime) {
        // sessionTime is in minutes, RADIUS expects seconds
        attributes.push({
            type: RadiusAttributeType.SESSION_TIMEOUT,
            value: customer.package.sessionTime * 60,
        });
    }

    // Add data limit (bytes)
    if (customer.package?.dataLimit) {
        // MikroTik uses Recv-Limit (download) and Xmit-Limit (upload)
        // For simplicity, apply total limit to both
        const limitBytes = Number(customer.package.dataLimit);

        // Handle gigawords (values > 4GB)
        const gigawords = Math.floor(limitBytes / (4 * 1024 * 1024 * 1024));
        const remainingBytes = limitBytes % (4 * 1024 * 1024 * 1024);

        attributes.push({
            type: MikroTikAttribute.TOTAL_LIMIT,
            value: remainingBytes,
            vendorId: MIKROTIK_VENDOR_ID,
            vendorType: MikroTikAttribute.TOTAL_LIMIT,
        });

        if (gigawords > 0) {
            attributes.push({
                type: MikroTikAttribute.TOTAL_LIMIT_GIGAWORDS,
                value: gigawords,
                vendorId: MIKROTIK_VENDOR_ID,
                vendorType: MikroTikAttribute.TOTAL_LIMIT_GIGAWORDS,
            });
        }
    }

    // Add idle timeout (5 minutes default)
    attributes.push({
        type: RadiusAttributeType.IDLE_TIMEOUT,
        value: 300,
    });

    // Add interim update interval (5 minutes)
    attributes.push({
        type: RadiusAttributeType.ACCT_INTERIM_INTERVAL,
        value: 300,
    });

    // Update customer last login info
    await prisma.customer.update({
        where: { id: customer.id },
        data: {
            lastIp: context.nasIp,
            lastMac: context.callingStationId,
        },
    });

    return {
        code: RadiusCode.ACCESS_ACCEPT,
        attributes,
        replyMessage: 'Welcome!',
    };
}

/**
 * Verify user password (PAP or CHAP)
 */
async function verifyPassword(
    packet: RadiusPacket,
    secret: string,
    storedPassword: string
): Promise<boolean> {
    // Check for CHAP authentication
    const chapPassword = getAttribute(packet, RadiusAttributeType.CHAP_PASSWORD);
    const chapChallenge = getAttribute(packet, RadiusAttributeType.CHAP_CHALLENGE);

    if (chapPassword && Buffer.isBuffer(chapPassword.raw)) {
        // CHAP authentication
        const challenge = chapChallenge?.raw || packet.authenticator;
        if (!Buffer.isBuffer(challenge)) {
            return false;
        }
        return verifyChapPassword(chapPassword.raw, challenge, storedPassword);
    }

    // PAP authentication
    const userPassword = getAttribute(packet, RadiusAttributeType.USER_PASSWORD);
    if (userPassword && Buffer.isBuffer(userPassword.raw)) {
        const decrypted = decryptPassword(userPassword.raw, packet.authenticator, secret);
        return decrypted === storedPassword;
    }

    // No password provided
    return false;
}

/**
 * Create Access-Reject response
 */
function reject(message: string): AccessResult {
    return {
        code: RadiusCode.ACCESS_REJECT,
        attributes: [
            { type: RadiusAttributeType.REPLY_MESSAGE, value: message },
        ],
        replyMessage: message,
    };
}
