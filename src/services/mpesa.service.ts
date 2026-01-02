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
        if (!config.storeNumber) errors.push('Store Number (Head Office) is required for BuyGoods STK Push');
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

    if (!gateway || !gateway.consumerKey || !gateway.consumerSecret || !gateway.shortcode) {
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
 * 
 * Based on PHP reference implementation from BillNasi:
 * - For PAYBILL: BusinessShortCode = Paybill, PartyB = Paybill
 * - For BUYGOODS: BusinessShortCode = StoreNumber (Head Office), PartyB = Till Number
 * - For BANK: BusinessShortCode = Bank Paybill, AccountReference = Target Account
 * 
 * Password is ALWAYS: base64(BusinessShortCode + passkey + timestamp)
 */
export async function initiateSTKPush(
    tenantId: string,
    phone: string,
    amount: number,
    accountReference: string,
    transactionDesc: string = 'Payment',
    options?: {
        packageId?: string;  // For amount validation
        validateAmount?: boolean;
        purpose?: 'HOTSPOT' | 'PPPOE';
    }
): Promise<STKPushResponse> {
    const mpesaConfig = await getTenantMpesaConfig(tenantId, options?.purpose);
    if (!mpesaConfig) {
        throw new Error('M-Pesa not configured for this tenant');
    }

    // Validate configuration before proceeding
    const validation = validateBuyGoodsConfig(mpesaConfig);
    if (!validation.valid) {
        const errorMsg = `M-Pesa configuration invalid: ${validation.errors.join(', ')}`;
        logger.error({ tenantId, errors: validation.errors, configType: validation.configType }, errorMsg);
        throw new Error(errorMsg);
    }

    // Amount validation (optional, based on PHP reference)
    if (options?.validateAmount && options?.packageId) {
        const pkg = await prisma.package.findUnique({
            where: { id: options.packageId },
            select: { price: true, name: true }
        });

        if (pkg && pkg.price !== amount) {
            logger.warn({
                tenantId,
                packageId: options.packageId,
                expectedAmount: pkg.price,
                receivedAmount: amount
            }, 'Amount mismatch - using package price');
            amount = pkg.price;
        }
    }

    // Ensure amount is valid
    amount = Math.max(1, Math.round(amount));

    const token = await getAccessToken(tenantId, options?.purpose);
    const baseUrl = getBaseUrl(mpesaConfig.env);
    const timestamp = generateTimestamp();
    const formattedPhone = formatPhoneNumber(phone);

    // ============================================
    // CRITICAL: Parameter determination per PHP reference
    // ============================================
    let businessShortCode: string;
    let partyB: string;
    let transactionType: string;
    let finalAccountRef: string;

    if (mpesaConfig.subType === 'BUYGOODS') {
        /**
         * BuyGoods (Till) Configuration - FROM PHP:
         * 
         * Two scenarios supported:
         * 1. Till has its OWN API credentials (Consumer Key, Secret, Passkey)
         *    -> BusinessShortCode = Till number (same as PartyB)
         *    -> No storeNumber needed
         * 
         * 2. Using a SEPARATE authorized shortcode (e.g., Head Office Paybill with API access)
         *    -> BusinessShortCode = storeNumber (has API creds, used for password)
         *    -> PartyB = Till number (where money goes)
         * 
         * PHP: $BusinessShortCode = empty($BusinessShortCode) ? $PartyB : $BusinessShortCode;
         * Password = base64(BusinessShortCode + passKey + Timestamp)
         * TransactionType = "CustomerBuyGoodsOnline"
         */

        // BusinessShortCode: Use storeNumber if available, otherwise fall back to Till (shortcode)
        businessShortCode = mpesaConfig.storeNumber || mpesaConfig.shortcode;
        partyB = mpesaConfig.shortcode;  // Till Number
        transactionType = 'CustomerBuyGoodsOnline';
        finalAccountRef = accountReference;  // Not typically used for BuyGoods but required by API

        logger.info({
            tenantId,
            type: 'BUYGOODS',
            businessShortCode,  // May be storeNumber or Till (fallback)
            storeNumber: mpesaConfig.storeNumber || '(using Till as fallback)',
            tillNumber: partyB,
            amount
        }, 'BuyGoods STK Push parameters');

    } else if (mpesaConfig.subType === 'BANK') {
        /**
         * Bank Configuration - FROM PHP:
         * 
         * $TransactionType = "CustomerPayBillOnline";
         * $BusinessShortCode = Bank Paybill
         * $AccountReference = Bank Account Number
         */
        businessShortCode = mpesaConfig.shortcode;  // Bank Paybill
        partyB = mpesaConfig.shortcode;  // Same as BusinessShortCode for banks
        transactionType = 'CustomerPayBillOnline';
        finalAccountRef = mpesaConfig.accountNumber || accountReference;

        logger.info({
            tenantId,
            type: 'BANK',
            paybill: businessShortCode,
            accountNumber: finalAccountRef,
            amount
        }, 'Bank STK Push parameters');

    } else {
        /**
         * PayBill Configuration - FROM PHP:
         * 
         * $TransactionType = "CustomerPayBillOnline";
         * $BusinessShortCode = Paybill Number
         * $PartyB = Paybill Number (same)
         */
        businessShortCode = mpesaConfig.shortcode;  // Paybill
        partyB = mpesaConfig.shortcode;  // Same as BusinessShortCode
        transactionType = 'CustomerPayBillOnline';
        finalAccountRef = accountReference;

        logger.info({
            tenantId,
            type: 'PAYBILL',
            paybill: businessShortCode,
            accountReference: finalAccountRef,
            amount
        }, 'PayBill STK Push parameters');
    }

    // Generate password using BusinessShortCode (critical for BuyGoods!)
    const password = generatePassword(businessShortCode, mpesaConfig.passkey, timestamp);

    // Build the STK Push payload
    const payload = {
        BusinessShortCode: businessShortCode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: transactionType,
        Amount: amount,
        PartyA: formattedPhone,
        PartyB: partyB,
        PhoneNumber: formattedPhone,
        CallBackURL: mpesaConfig.callbackUrl,
        AccountReference: finalAccountRef.substring(0, 12),  // Max 12 chars
        TransactionDesc: transactionDesc.substring(0, 13),   // Max 13 chars
    };

    logger.info({
        phone: formattedPhone,
        amount,
        tenantId,
        transactionType,
        businessShortCode,
        partyB
    }, 'Initiating STK Push');

    // Make the request with timeout (60 seconds like PHP)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
        const response = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const responseText = await response.text();
        let data: STKPushResponse & { errorMessage?: string; errorCode?: string };

        try {
            data = JSON.parse(responseText);
        } catch (parseError) {
            logger.error({ responseText, tenantId }, 'Failed to parse M-Pesa STK response');
            throw new Error('Invalid response from M-Pesa API');
        }

        // Check for error response
        if (data.errorMessage) {
            logger.error({
                errorMessage: data.errorMessage,
                errorCode: data.errorCode,
                tenantId,
                payload: { ...payload, Password: '[REDACTED]' }
            }, 'M-Pesa STK Push error response');
            throw new Error(`M-Pesa Error: ${data.errorMessage}`);
        }

        if (data.ResponseCode !== '0') {
            logger.error({ data, tenantId }, 'STK Push failed');
            throw new Error(data.ResponseDescription || data.CustomerMessage || 'STK Push failed');
        }

        logger.info({
            checkoutRequestId: data.CheckoutRequestID,
            merchantRequestId: data.MerchantRequestID,
            tenantId
        }, 'STK Push initiated successfully');

        return data;

    } catch (error: any) {
        clearTimeout(timeoutId);

        if (error.name === 'AbortError') {
            logger.error({ tenantId, phone: formattedPhone }, 'STK Push request timed out');
            throw new Error('M-Pesa request timed out. Please try again.');
        }

        throw error;
    }
}

/**
 * Query STK Push status
 * 
 * Note: For BuyGoods, must use storeNumber as BusinessShortCode (same as initiateSTKPush)
 */
export async function querySTKStatus(
    tenantId: string,
    checkoutRequestId: string
): Promise<STKQueryResponse> {
    const mpesaConfig = await getTenantMpesaConfig(tenantId);
    if (!mpesaConfig) {
        throw new Error('M-Pesa not configured for this tenant');
    }

    const token = await getAccessToken(tenantId);
    const baseUrl = getBaseUrl(mpesaConfig.env);
    const timestamp = generateTimestamp();

    // Use correct BusinessShortCode based on subType (same logic as initiateSTKPush)
    let businessShortCode = mpesaConfig.shortcode;
    if (mpesaConfig.subType === 'BUYGOODS' && mpesaConfig.storeNumber) {
        businessShortCode = mpesaConfig.storeNumber;
    }

    const password = generatePassword(businessShortCode, mpesaConfig.passkey, timestamp);

    const payload = {
        BusinessShortCode: businessShortCode,
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
