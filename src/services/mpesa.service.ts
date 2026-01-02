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
import { config } from '../lib/config.js';

interface MpesaConfig {
    subType: 'PAYBILL' | 'BUYGOODS' | 'BANK';
    consumerKey: string;
    consumerSecret: string;
    shortcode: string;
    storeNumber?: string;
    accountNumber?: string;
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

export interface BuyGoodsValidationResult {
    valid: boolean;
    errors: string[];
    configType: 'PAYBILL' | 'BUYGOODS' | 'BANK';
    details?: {
        tillNumber?: string;
        storeNumber?: string;
        environment?: string;
    };
}

/**
 * Validate M-Pesa BuyGoods configuration
 * Ensures all required fields are present for BuyGoods transactions
 */
export function validateBuyGoodsConfig(config: MpesaConfig): BuyGoodsValidationResult {
    const errors: string[] = [];

    // Common validations
    if (!config.consumerKey) errors.push('Consumer Key is required');
    if (!config.consumerSecret) errors.push('Consumer Secret is required');
    if (!config.passkey) errors.push('Passkey is required');
    if (!config.callbackUrl) errors.push('Callback URL is required');

    // BuyGoods-specific validations
    if (config.subType === 'BUYGOODS') {
        if (!config.shortcode) errors.push('Till Number (shortcode) is required for BuyGoods');
        // Store number is optional - will fallback to till number if not provided
    } else if (config.subType === 'PAYBILL') {
        if (!config.shortcode) errors.push('Paybill Number (shortcode) is required');
    } else if (config.subType === 'BANK') {
        if (!config.shortcode) errors.push('Bank Paybill Number is required');
        if (!config.accountNumber) errors.push('Target Account Number is required for Bank transfers');
    }

    return {
        valid: errors.length === 0,
        errors,
        configType: config.subType,
        details: {
            tillNumber: config.subType === 'BUYGOODS' ? config.shortcode : undefined,
            storeNumber: config.storeNumber,
            environment: config.env,
        }
    };
}

// Token cache per tenant
const tokenCache: Map<string, { token: string; expiresAt: number }> = new Map();

/**
 * Get M-Pesa config for a tenant
 * Falls back to default BuyGoods credentials (consumer key, secret, passkey) if tenant hasn't set their own
 * NOTE: Till Number (shortcode) must be tenant-specific. Store Number is optional (will use till number if not provided)
 */
export async function getTenantMpesaConfig(tenantId: string, purpose?: 'HOTSPOT' | 'PPPOE'): Promise<MpesaConfig | null> {
    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { mpesaCallbackUrl: true }
    });

    let gateway = null;
    if (purpose) {
        // Find gateway specifically for this purpose
        gateway = await prisma.paymentGateway.findFirst({
            where: {
                tenantId,
                [purpose === 'HOTSPOT' ? 'forHotspot' : 'forPppoe']: true
            }
        });
    }

    // Fallback to default if no specific gateway found
    if (!gateway) {
        gateway = await prisma.paymentGateway.findFirst({
            where: { tenantId, isDefault: true }
        });
    }

    if (!gateway || !gateway.shortcode) {
        return null;
    }

    // For BuyGoods: Use system defaults for API credentials if tenant hasn't configured their own
    // Till number (shortcode) must always be tenant-specific
    // Store number is optional - will fallback to till number if not provided
    const isBuyGoods = gateway.subType === 'BUYGOODS';
    const useDefaultCredentials = isBuyGoods && (
        !gateway.consumerKey || 
        !gateway.consumerSecret || 
        !gateway.passkey
    );

    if (useDefaultCredentials) {
        logger.info({ tenantId, gatewayId: gateway.id }, 'Using default BuyGoods API credentials for tenant');
        
        return {
            subType: 'BUYGOODS',
            consumerKey: gateway.consumerKey || config.mpesa.buyGoods.consumerKey,
            consumerSecret: gateway.consumerSecret || config.mpesa.buyGoods.consumerSecret,
            shortcode: gateway.shortcode, // Tenant's till number (never defaulted)
            storeNumber: gateway.storeNumber || undefined, // Optional - undefined if not provided, fallback to till number during STK Push
            accountNumber: gateway.accountNumber || undefined,
            passkey: gateway.passkey || config.mpesa.buyGoods.passkey,
            callbackUrl: (tenant as any)?.mpesaCallbackUrl || config.mpesa.callbackUrl || '',
            env: (gateway.env as 'sandbox' | 'production') || config.mpesa.env,
        };
    }

    // For non-BuyGoods or fully configured BuyGoods, use gateway config as-is
    if (!gateway.consumerKey || !gateway.consumerSecret) {
        return null;
    }

    return {
        subType: (gateway.subType as 'PAYBILL' | 'BUYGOODS' | 'BANK') || 'PAYBILL',
        consumerKey: gateway.consumerKey,
        consumerSecret: gateway.consumerSecret,
        shortcode: gateway.shortcode,
        storeNumber: gateway.storeNumber || undefined,
        accountNumber: gateway.accountNumber || undefined,
        passkey: gateway.passkey || '',
        callbackUrl: (tenant as any)?.mpesaCallbackUrl || config.mpesa.callbackUrl || '',
        env: (gateway.env as 'sandbox' | 'production') || 'production',
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
export async function getAccessToken(tenantId: string, purpose?: 'HOTSPOT' | 'PPPOE'): Promise<string> {
    const config = await getTenantMpesaConfig(tenantId, purpose);
    if (!config) {
        throw new Error('M-Pesa not configured for this tenant');
    }

    // Cache key specific to this set of credentials
    const cacheKey = `${tenantId}:${config.consumerKey}`;
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.token;
    }

    const baseUrl = getBaseUrl(config.env);
    const consumerKey = config.consumerKey.trim();
    const consumerSecret = config.consumerSecret.trim();
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

    const response = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
        method: 'GET',
        headers: {
            Authorization: `Basic ${auth}`,
        },
    });

    if (!response.ok) {
        const error = await response.text();
        logger.error({ error, tenantId }, 'Failed to get M-Pesa access token');
        throw new Error(`Failed to get M-Pesa access token: ${error}`);
    }

    const data = await response.json() as { access_token: string; expires_in: string };

    // Cache token (expires in ~1 hour, cache for 50 minutes)
    tokenCache.set(cacheKey, {
        token: data.access_token,
        expiresAt: Date.now() + 50 * 60 * 1000,
    });

    return data.access_token;
}

/**
 * Test Specific Gateway Connection
 */
export async function testGateway(gatewayId: string): Promise<{ success: boolean; message: string }> {
    try {
        const gw = await prisma.paymentGateway.findUnique({ where: { id: gatewayId } });
        if (!gw) throw new Error("Gateway not found");
        if (!gw.consumerKey || !gw.consumerSecret) throw new Error("Gateway is missing API credentials");

        const baseUrl = getBaseUrl(gw.env as 'sandbox' | 'production');
        const auth = Buffer.from(`${gw.consumerKey}:${gw.consumerSecret}`).toString('base64');

        const response = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
            method: 'GET',
            headers: { Authorization: `Basic ${auth}` },
        });

        if (!response.ok) {
            const text = await response.text();
            let msg = 'Connection failed';
            try {
                const parsed = JSON.parse(text);
                if (parsed.errorMessage) msg = parsed.errorMessage;
            } catch (e) { }
            return { success: false, message: msg };
        }

        return { success: true, message: 'Connection successful! Credentials are valid.' };
    } catch (error: any) {
        logger.error({ error, gatewayId }, 'Gateway connection test failed');
        return { success: false, message: error.message || 'Connection failed' };
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

    // Validate configuration before proceeding
    const validation = validateBuyGoodsConfig(config);
    if (!validation.valid) {
        const errorMsg = `M-Pesa configuration invalid: ${validation.errors.join(', ')}`;
        logger.error({ tenantId, errors: validation.errors, configType: validation.configType }, errorMsg);
        throw new Error(errorMsg);
    }

    logger.info({
        tenantId,
        configType: validation.configType,
        tillNumber: validation.details?.tillNumber,
        storeNumber: validation.details?.storeNumber
    }, 'Initiating STK Push with validated config');

    const token = await getAccessToken(tenantId);
    const baseUrl = getBaseUrl(config.env);
    const timestamp = generateTimestamp();
    // Determine parameters based on subType
    let businessShortCode = config.shortcode;
    let partyB = config.shortcode;
    let transactionType = 'CustomerPayBillOnline';
    let finalAccountRef = accountReference;

    if (config.subType === 'BUYGOODS') {
        // BuyGoods: BusinessShortCode uses store number if provided, otherwise defaults to till number; PartyB is till number
        businessShortCode = config.storeNumber || config.shortcode;
        partyB = config.shortcode;
        transactionType = 'CustomerBuyGoodsOnline';
    } else if (config.subType === 'BANK') {
        // Bank: BusinessShortCode is Bank Paybill, AccountRef is Target Account
        businessShortCode = config.shortcode;
        partyB = config.shortcode;
        finalAccountRef = config.accountNumber || accountReference;
        transactionType = 'CustomerPayBillOnline';
    }

    const password = generatePassword(businessShortCode, config.passkey, timestamp);
    const formattedPhone = formatPhoneNumber(phone);

    const payload = {
        BusinessShortCode: businessShortCode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: transactionType,
        Amount: Math.round(amount),
        PartyA: formattedPhone,
        PartyB: partyB,
        PhoneNumber: formattedPhone,
        CallBackURL: config.callbackUrl,
        AccountReference: finalAccountRef,
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
