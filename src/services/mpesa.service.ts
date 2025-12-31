/**
 * M-Pesa Service for Hotspot Payments
 * 
 * Handles per-tenant M-Pesa integration:
 * - OAuth token management
 * - STK Push initiation
 * - Transaction status query
 * - SMS message parsing
 */

import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

interface MpesaConfig {
    consumerKey: string;
    consumerSecret: string;
    shortcode: string;
    passkey: string;
    callbackUrl: string;
    env: 'sandbox' | 'production';
}

interface STKPushResponse {
    MerchantRequestID: string;
    CheckoutRequestID: string;
    ResponseCode: string;
    ResponseDescription: string;
    CustomerMessage: string;
}

interface STKQueryResponse {
    ResponseCode: string;
    ResponseDescription: string;
    MerchantRequestID: string;
    CheckoutRequestID: string;
    ResultCode: string;
    ResultDesc: string;
}

// Token cache per tenant
const tokenCache: Map<string, { token: string; expiresAt: number }> = new Map();

/**
 * Get M-Pesa config for a tenant
 */
export async function getTenantMpesaConfig(tenantId: string): Promise<MpesaConfig | null> {
    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
            mpesaConsumerKey: true,
            mpesaConsumerSecret: true,
            mpesaShortcode: true,
            mpesaPasskey: true,
            mpesaCallbackUrl: true,
            mpesaEnv: true,
        },
    });

    if (!tenant || !tenant.mpesaConsumerKey || !tenant.mpesaConsumerSecret || !tenant.mpesaShortcode) {
        return null;
    }

    return {
        consumerKey: tenant.mpesaConsumerKey,
        consumerSecret: tenant.mpesaConsumerSecret,
        shortcode: tenant.mpesaShortcode,
        passkey: tenant.mpesaPasskey || '',
        callbackUrl: tenant.mpesaCallbackUrl || '',
        env: (tenant.mpesaEnv as 'sandbox' | 'production') || 'production',
    };
}

/**
 * Get M-Pesa API base URL
 */
function getBaseUrl(env: 'sandbox' | 'production'): string {
    return env === 'sandbox'
        ? 'https://sandbox.safaricom.co.ke'
        : 'https://api.safaricom.co.ke';
}

/**
 * Get OAuth access token (cached)
 */
export async function getAccessToken(tenantId: string): Promise<string> {
    // Check cache
    const cached = tokenCache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.token;
    }

    const config = await getTenantMpesaConfig(tenantId);
    if (!config) {
        throw new Error('M-Pesa not configured for this tenant');
    }

    const baseUrl = getBaseUrl(config.env);
    const auth = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');

    const response = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
        method: 'GET',
        headers: {
            Authorization: `Basic ${auth}`,
        },
    });

    if (!response.ok) {
        const error = await response.text();
        logger.error({ error, tenantId }, 'Failed to get M-Pesa access token');
        throw new Error('Failed to get M-Pesa access token');
    }

    const data = await response.json() as { access_token: string; expires_in: string };

    // Cache token (expires in ~1 hour, cache for 50 minutes)
    tokenCache.set(tenantId, {
        token: data.access_token,
        expiresAt: Date.now() + 50 * 60 * 1000,
    });

    return data.access_token;
}

/**
 * Test M-Pesa Connection
 */
export async function testConnection(tenantId: string): Promise<{ success: boolean; message: string }> {
    try {
        // Force refresh of token to verify current credentials
        tokenCache.delete(tenantId);
        await getAccessToken(tenantId);
        return { success: true, message: 'Connection successful! Credentials are valid.' };
    } catch (error: any) {
        logger.error({ error, tenantId }, 'M-Pesa connection test failed');
        // Extract meaningful error message if possible
        let msg = 'Connection failed. Please check your credentials.';
        if (error.message) msg = error.message;

        try {
            // If it's a JSON string error from the API
            const parsed = JSON.parse(error.message);
            if (parsed.errorMessage) msg = parsed.errorMessage;
        } catch (e) { }

        return { success: false, message: msg };
    }
}

/**
 * Format phone number for M-Pesa (254XXXXXXXXX)
 */
export function formatPhoneNumber(phone: string): string {
    // Remove any non-digit characters
    let cleaned = phone.replace(/\D/g, '');

    // Handle different formats
    if (cleaned.startsWith('0')) {
        cleaned = '254' + cleaned.substring(1);
    } else if (cleaned.startsWith('7') || cleaned.startsWith('1')) {
        cleaned = '254' + cleaned;
    } else if (cleaned.startsWith('+254')) {
        cleaned = cleaned.substring(1);
    }

    return cleaned;
}

/**
 * Generate M-Pesa password (Base64 of Shortcode+Passkey+Timestamp)
 */
function generatePassword(shortcode: string, passkey: string, timestamp: string): string {
    return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}

/**
 * Generate timestamp in format YYYYMMDDHHmmss
 */
function generateTimestamp(): string {
    const now = new Date();
    return now.getFullYear().toString() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0');
}

/**
 * Initiate STK Push
 */
export async function initiateSTKPush(
    tenantId: string,
    phone: string,
    amount: number,
    accountReference: string,
    transactionDesc: string = 'Hotspot Payment'
): Promise<STKPushResponse> {
    const config = await getTenantMpesaConfig(tenantId);
    if (!config) {
        throw new Error('M-Pesa not configured for this tenant');
    }

    const token = await getAccessToken(tenantId);
    const baseUrl = getBaseUrl(config.env);
    const timestamp = generateTimestamp();
    const password = generatePassword(config.shortcode, config.passkey, timestamp);
    const formattedPhone = formatPhoneNumber(phone);

    const payload = {
        BusinessShortCode: config.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(amount),
        PartyA: formattedPhone,
        PartyB: config.shortcode,
        PhoneNumber: formattedPhone,
        CallBackURL: config.callbackUrl,
        AccountReference: accountReference,
        TransactionDesc: transactionDesc,
    };

    logger.info({ phone: formattedPhone, amount, tenantId }, 'Initiating STK Push');

    const response = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    const data = await response.json() as STKPushResponse;

    if (data.ResponseCode !== '0') {
        logger.error({ data, tenantId }, 'STK Push failed');
        throw new Error(data.ResponseDescription || 'STK Push failed');
    }

    logger.info({ checkoutRequestId: data.CheckoutRequestID, tenantId }, 'STK Push initiated successfully');
    return data;
}

/**
 * Query STK Push status
 */
export async function querySTKStatus(
    tenantId: string,
    checkoutRequestId: string
): Promise<STKQueryResponse> {
    const config = await getTenantMpesaConfig(tenantId);
    if (!config) {
        throw new Error('M-Pesa not configured for this tenant');
    }

    const token = await getAccessToken(tenantId);
    const baseUrl = getBaseUrl(config.env);
    const timestamp = generateTimestamp();
    const password = generatePassword(config.shortcode, config.passkey, timestamp);

    const payload = {
        BusinessShortCode: config.shortcode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
    };

    const response = await fetch(`${baseUrl}/mpesa/stkpushquery/v1/query`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    const data = await response.json() as STKQueryResponse;
    return data;
}

/**
 * Parse M-Pesa SMS message to extract transaction code
 * 
 * Example messages:
 * - "SJK4H7L2PQ Confirmed. Ksh500.00 sent to..."
 * - "RCB123456 confirmed. You have received Ksh500.00 from..."
 */
export function parseMpesaSms(smsText: string): { code: string; amount?: number } | null {
    // Pattern 1: Transaction code at start followed by "Confirmed"
    const pattern1 = /^([A-Z0-9]{10})\s+Confirmed/i;

    // Pattern 2: Any 10-character alphanumeric code followed by "confirmed"
    const pattern2 = /([A-Z0-9]{10})\s+confirmed/i;

    // Try pattern 1 first
    let match = smsText.match(pattern1);
    if (match) {
        const code = match[1].toUpperCase();

        // Try to extract amount
        const amountMatch = smsText.match(/Ksh\s*([\d,]+(?:\.\d{2})?)/i);
        const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : undefined;

        return { code, amount };
    }

    // Try pattern 2
    match = smsText.match(pattern2);
    if (match) {
        const code = match[1].toUpperCase();
        const amountMatch = smsText.match(/Ksh\s*([\d,]+(?:\.\d{2})?)/i);
        const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : undefined;

        return { code, amount };
    }

    return null;
}

/**
 * Create hotspot customer from M-Pesa payment
 */
export async function createHotspotCustomerFromPayment(
    tenantId: string,
    transactionCode: string,
    phone: string,
    packageId: string,
    amount: number
): Promise<{ customerId: string; username: string; password: string; expiresAt: Date }> {
    // Get the package details
    const pkg = await prisma.package.findFirst({
        where: { id: packageId, tenantId },
    });

    if (!pkg) {
        throw new Error('Package not found');
    }

    // Calculate expiry based on package sessionTime (in minutes, but we'll use as days for hotspot data packages)
    // For hotspot packages, sessionTime represents validity in days
    const validityDays = pkg.sessionTime ? Math.max(1, Math.floor(pkg.sessionTime / (24 * 60))) : 30;
    const expiresAt = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);

    // Create customer with transaction code as username and password
    const customer = await prisma.customer.create({
        data: {
            username: transactionCode,
            password: transactionCode,
            name: `Hotspot-${transactionCode}`,
            phone: phone,
            connectionType: 'HOTSPOT',
            status: 'ACTIVE',
            packageId: pkg.id,
            tenantId: tenantId,
            expiresAt: expiresAt,
        },
    });

    // Record the payment
    await prisma.payment.create({
        data: {
            amount: amount,
            method: 'MPESA',
            status: 'COMPLETED',
            transactionId: transactionCode,
            phone: phone,
            account: transactionCode,
            customerId: customer.id,
            tenantId: tenantId,
            description: `Hotspot package: ${pkg.name}`,
        },
    });

    logger.info({
        customerId: customer.id,
        username: transactionCode,
        expiresAt,
        packageName: pkg.name
    }, 'Hotspot customer created from M-Pesa payment');

    return {
        customerId: customer.id,
        username: transactionCode,
        password: transactionCode,
        expiresAt: expiresAt,
    };
}
