/**
 * RADIUS Accounting-Request Handler
 * Handles session tracking from MikroTik routers
 */

import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import {
    type RadiusPacket,
    type AttributeBuilder,
    getAttributeString,
    getAttributeNumber,
    createResponse,
    verifyAccountingAuthenticator,
} from '../packet.js';
import {
    RadiusCode,
    RadiusAttributeType,
    AcctStatusType,
    AcctTerminateCause,
} from '../dictionary.js';

export interface AccountingContext {
    username: string;
    sessionId: string;
    statusType: AcctStatusType;
    nasIp: string;
    nasIdentifier?: string;
    framedIp?: string;
    macAddress?: string;
    sessionTime?: number;
    inputOctets?: bigint;
    outputOctets?: bigint;
    inputPackets?: number;
    outputPackets?: number;
    terminateCause?: AcctTerminateCause;
    eventTimestamp?: number;
}

/**
 * Handle Accounting-Request packet
 */
export async function handleAccountingRequest(
    packet: RadiusPacket,
    secret: string,
    nasIp: string
): Promise<Buffer> {
    const startTime = Date.now();

    try {
        // Verify authenticator
        if (!verifyAccountingAuthenticator(packet, secret)) {
            logger.warn({ nasIp }, 'Invalid accounting authenticator');
            // Still respond to prevent retries
        }

        // Extract accounting context
        const context = extractAccountingContext(packet, nasIp);

        logger.debug({
            username: context.username,
            sessionId: context.sessionId,
            statusType: AcctStatusType[context.statusType],
            nasIp: context.nasIp,
        }, 'Accounting-Request received');

        // Process based on status type
        switch (context.statusType) {
            case AcctStatusType.START:
                await handleAccountingStart(context, secret);
                break;
            case AcctStatusType.INTERIM_UPDATE:
                await handleAccountingInterim(context);
                break;
            case AcctStatusType.STOP:
                await handleAccountingStop(context);
                break;
            case AcctStatusType.ACCOUNTING_ON:
            case AcctStatusType.ACCOUNTING_OFF:
                // Router restart - close all sessions for this NAS
                await handleNasRestart(context.nasIp);
                break;
            default:
                logger.warn({ statusType: context.statusType }, 'Unknown accounting status type');
        }

        // Always respond with Accounting-Response
        const response = createResponse(
            RadiusCode.ACCOUNTING_RESPONSE,
            packet.identifier,
            packet.authenticator,
            [],
            secret
        );

        const duration = Date.now() - startTime;
        logger.debug({
            sessionId: context.sessionId,
            statusType: AcctStatusType[context.statusType],
            duration,
        }, 'Accounting-Request processed');

        return response;
    } catch (error) {
        logger.error({ error, nasIp }, 'Accounting-Request handler error');

        // Still send response to prevent retries
        return createResponse(
            RadiusCode.ACCOUNTING_RESPONSE,
            packet.identifier,
            packet.authenticator,
            [],
            secret
        );
    }
}

/**
 * Extract accounting context from packet
 */
function extractAccountingContext(packet: RadiusPacket, nasIp: string): AccountingContext {
    const statusType = getAttributeNumber(packet, RadiusAttributeType.ACCT_STATUS_TYPE) ?? AcctStatusType.START;

    // Calculate total octets (handle gigawords for > 4GB)
    const inputOctetsLow = BigInt(getAttributeNumber(packet, RadiusAttributeType.ACCT_INPUT_OCTETS) ?? 0);
    const inputGigawords = BigInt(getAttributeNumber(packet, RadiusAttributeType.ACCT_INPUT_GIGAWORDS) ?? 0);
    const outputOctetsLow = BigInt(getAttributeNumber(packet, RadiusAttributeType.ACCT_OUTPUT_OCTETS) ?? 0);
    const outputGigawords = BigInt(getAttributeNumber(packet, RadiusAttributeType.ACCT_OUTPUT_GIGAWORDS) ?? 0);

    const inputOctets = inputOctetsLow + (inputGigawords * BigInt(4294967296)); // 2^32
    const outputOctets = outputOctetsLow + (outputGigawords * BigInt(4294967296));

    return {
        username: getAttributeString(packet, RadiusAttributeType.USER_NAME) ?? '',
        sessionId: getAttributeString(packet, RadiusAttributeType.ACCT_SESSION_ID) ?? '',
        statusType,
        nasIp,
        nasIdentifier: getAttributeString(packet, RadiusAttributeType.NAS_IDENTIFIER),
        framedIp: getAttributeString(packet, RadiusAttributeType.FRAMED_IP_ADDRESS),
        macAddress: getAttributeString(packet, RadiusAttributeType.CALLING_STATION_ID),
        sessionTime: getAttributeNumber(packet, RadiusAttributeType.ACCT_SESSION_TIME),
        inputOctets,
        outputOctets,
        inputPackets: getAttributeNumber(packet, RadiusAttributeType.ACCT_INPUT_PACKETS),
        outputPackets: getAttributeNumber(packet, RadiusAttributeType.ACCT_OUTPUT_PACKETS),
        terminateCause: getAttributeNumber(packet, RadiusAttributeType.ACCT_TERMINATE_CAUSE),
        eventTimestamp: getAttributeNumber(packet, RadiusAttributeType.EVENT_TIMESTAMP),
    };
}

/**
 * Handle Accounting-Start: Create new session
 */
async function handleAccountingStart(context: AccountingContext, secret: string): Promise<void> {
    // Find NAS
    const nas = await prisma.nAS.findFirst({
        where: {
            OR: [
                { ipAddress: context.nasIp },
                { vpnIp: context.nasIp },
            ],
        },
    });

    if (!nas) {
        logger.warn({ nasIp: context.nasIp }, 'Accounting-Start: Unknown NAS');
        return;
    }

    // Find customer
    const customer = await prisma.customer.findFirst({
        where: {
            username: context.username,
            tenantId: nas.tenantId,
            deletedAt: null,
        },
    });

    // Create or update session
    await prisma.session.upsert({
        where: { sessionId: context.sessionId },
        create: {
            sessionId: context.sessionId,
            username: context.username,
            nasIpAddress: context.nasIp,
            framedIp: context.framedIp,
            macAddress: context.macAddress,
            startTime: new Date(),
            customerId: customer?.id,
            nasId: nas.id,
            tenantId: nas.tenantId,
        },
        update: {
            framedIp: context.framedIp,
            macAddress: context.macAddress,
            stopTime: null, // Clear in case of reconnect
        },
    });

    // Update NAS last seen
    await prisma.nAS.update({
        where: { id: nas.id },
        data: { lastSeen: new Date(), status: 'ONLINE' },
    });

    logger.info({
        sessionId: context.sessionId,
        username: context.username,
        ip: context.framedIp,
        mac: context.macAddress,
    }, 'Session started');
}

/**
 * Handle Accounting-Interim-Update: Update session data
 */
async function handleAccountingInterim(context: AccountingContext): Promise<void> {
    const session = await prisma.session.findUnique({
        where: { sessionId: context.sessionId },
    });

    if (!session) {
        logger.warn({ sessionId: context.sessionId }, 'Interim update for unknown session');
        return;
    }

    await prisma.session.update({
        where: { sessionId: context.sessionId },
        data: {
            framedIp: context.framedIp || session.framedIp,
            inputOctets: context.inputOctets,
            outputOctets: context.outputOctets,
            sessionTime: context.sessionTime ?? session.sessionTime,
        },
    });

    logger.debug({
        sessionId: context.sessionId,
        inputOctets: context.inputOctets?.toString(),
        outputOctets: context.outputOctets?.toString(),
        sessionTime: context.sessionTime,
    }, 'Session updated');
}

/**
 * Handle Accounting-Stop: Close session
 */
async function handleAccountingStop(context: AccountingContext): Promise<void> {
    const session = await prisma.session.findUnique({
        where: { sessionId: context.sessionId },
        include: { customer: true },
    });

    if (!session) {
        logger.warn({ sessionId: context.sessionId }, 'Stop for unknown session');
        return;
    }

    // Update session with final values
    await prisma.session.update({
        where: { sessionId: context.sessionId },
        data: {
            stopTime: new Date(),
            inputOctets: context.inputOctets,
            outputOctets: context.outputOctets,
            sessionTime: context.sessionTime ?? session.sessionTime,
            terminateCause: context.terminateCause ? AcctTerminateCause[context.terminateCause] : null,
        },
    });

    // Update customer total spent data (if tracking)
    if (session.customer && (context.inputOctets || context.outputOctets)) {
        const totalBytes = (context.inputOctets ?? BigInt(0)) + (context.outputOctets ?? BigInt(0));
        // Could update customer.dataUsed or similar field here
    }

    logger.info({
        sessionId: context.sessionId,
        username: context.username,
        sessionTime: context.sessionTime,
        inputMB: context.inputOctets ? Number(context.inputOctets / BigInt(1048576)) : 0,
        outputMB: context.outputOctets ? Number(context.outputOctets / BigInt(1048576)) : 0,
        terminateCause: context.terminateCause ? AcctTerminateCause[context.terminateCause] : 'unknown',
    }, 'Session stopped');
}

/**
 * Handle NAS restart: Close all active sessions for this NAS
 */
async function handleNasRestart(nasIp: string): Promise<void> {
    const nas = await prisma.nAS.findFirst({
        where: {
            OR: [
                { ipAddress: nasIp },
                { vpnIp: nasIp },
            ],
        },
    });

    if (!nas) return;

    // Close all active sessions for this NAS
    const result = await prisma.session.updateMany({
        where: {
            nasId: nas.id,
            stopTime: null,
        },
        data: {
            stopTime: new Date(),
            terminateCause: 'NAS_REBOOT',
        },
    });

    if (result.count > 0) {
        logger.info({ nasIp, closedSessions: result.count }, 'NAS restart - closed active sessions');
    }
}
