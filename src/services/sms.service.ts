/**
 * SMS Service - Unified multi-provider SMS gateway
 * Supports: TextSMS, Talksasa, Hostpinnacle, Celcom, Bytewave, Blessedtext, Advanta
 */

import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

// Provider interface that all adapters must implement
export interface SmsProviderAdapter {
    sendSms(phone: string, message: string): Promise<SmsResult>;
    getBalance(): Promise<BalanceResult>;
    getDeliveryStatus(messageId: string): Promise<DeliveryStatusResult>;
}

export interface SmsResult {
    success: boolean;
    messageId?: string;
    error?: string;
}

export interface DeliveryStatusResult {
    success: boolean;
    status: string;
    description?: string;
    error?: string;
}

export interface BalanceResult {
    success: boolean;
    balance?: number;
    error?: string;
}

// Provider configuration types
export interface TextSmsConfig {
    apikey: string;
    partnerID: string;
    shortcode: string;
}

export interface TalksasaConfig {
    proxyApiKey: string;
    senderId: string;
}

export interface HostpinnacleConfig {
    apiKey?: string;
    userId?: string;
    password?: string;
    senderId: string;
}

export interface CelcomConfig {
    apikey: string;
    partnerID: string;
    shortcode: string;
}

export interface BytewaveConfig {
    apiToken: string;
    senderId: string;
}

export interface BlessedtextConfig {
    apiKey: string;
    senderId: string;
}

export interface AdvantaConfig {
    apikey: string;
    partnerID: string;
    shortcode: string;
}

// Union type for all configs
export type SmsConfig =
    | TextSmsConfig
    | TalksasaConfig
    | HostpinnacleConfig
    | CelcomConfig
    | BytewaveConfig
    | BlessedtextConfig
    | AdvantaConfig;

// ==================== Provider Adapters ====================

class TextSmsAdapter implements SmsProviderAdapter {
    constructor(private config: TextSmsConfig) { }

    async sendSms(phone: string, message: string): Promise<SmsResult> {
        try {
            const response = await fetch('https://sms.textsms.co.ke/api/services/sendsms/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apikey: this.config.apikey,
                    partnerID: this.config.partnerID,
                    message,
                    shortcode: this.config.shortcode,
                    mobile: phone,
                }),
            });
            const data = await response.json() as any;
            if (data.responses?.[0]?.['respose-code'] === 200) {
                return { success: true, messageId: String(data.responses[0].messageid) };
            }
            return { success: false, error: data.responses?.[0]?.['response-description'] || 'Unknown error' };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    async getBalance(): Promise<BalanceResult> {
        try {
            const response = await fetch('https://sms.textsms.co.ke/api/services/getbalance/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apikey: this.config.apikey,
                    partnerID: this.config.partnerID,
                }),
            });
            const data = await response.json() as any;
            return { success: true, balance: parseFloat(data.credit || data.balance || 0) };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }
    async getDeliveryStatus(messageId: string): Promise<DeliveryStatusResult> {
        try {
            const response = await fetch('https://sms.textsms.co.ke/api/services/getdlr/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apikey: this.config.apikey,
                    partnerID: this.config.partnerID,
                    messageID: messageId,
                }),
            });
            const data = await response.json() as any;
            const item = data.responses?.[0];
            if (item) {
                return { success: true, status: item['delivery-status'] || 'Unknown', description: item['response-description'] };
            }
            return { success: false, status: 'Unknown', error: 'No data returned' };
        } catch (error: any) {
            return { success: false, status: 'Error', error: error.message };
        }
    }
}

class TalksasaAdapter implements SmsProviderAdapter {
    constructor(private config: TalksasaConfig) { }

    async sendSms(phone: string, message: string): Promise<SmsResult> {
        try {
            const response = await fetch('https://ladybird.talksasa.com/send-sms', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.config.proxyApiKey}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify({
                    recipient: phone,
                    sender_id: this.config.senderId,
                    type: 'plain',
                    message,
                }),
            });
            const data = await response.json() as any;
            if (data.status === 'success') {
                return { success: true, messageId: data.task_id };
            }
            return { success: false, error: data.message || 'Unknown error' };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    async getBalance(): Promise<BalanceResult> {
        // Talksasa doesn't have a balance endpoint in the docs
        return { success: false, error: 'Balance check not supported for Talksasa' };
    }
    async getDeliveryStatus(messageId: string): Promise<DeliveryStatusResult> {
        return { success: false, status: 'Not Supported', error: 'Delivery status not supported for Talksasa' };
    }
}

class HostpinnacleAdapter implements SmsProviderAdapter {
    constructor(private config: HostpinnacleConfig) { }

    async sendSms(phone: string, message: string): Promise<SmsResult> {
        try {
            const params = new URLSearchParams({
                sendMethod: 'quick',
                mobile: phone,
                msg: message,
                senderid: this.config.senderId,
                msgType: 'text',
                output: 'json',
            });
            if (this.config.userId) params.append('userid', this.config.userId);
            if (this.config.password) params.append('password', this.config.password);

            const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
            if (this.config.apiKey) headers['apikey'] = this.config.apiKey;

            const response = await fetch('https://smsportal.hostpinnacle.co.ke/SMSApi/send', {
                method: 'POST',
                headers,
                body: params.toString(),
            });
            const data = await response.json() as any;
            if (data.status === 'success') {
                return { success: true, messageId: data.transactionId };
            }
            return { success: false, error: data.reason || 'Unknown error' };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    async getBalance(): Promise<BalanceResult> {
        return { success: false, error: 'Balance check not supported for Hostpinnacle' };
    }

    async getDeliveryStatus(messageId: string): Promise<DeliveryStatusResult> {
        return { success: false, status: 'Not Supported', error: 'Delivery status not supported for Hostpinnacle' };
    }
}

class CelcomAdapter implements SmsProviderAdapter {
    constructor(private config: CelcomConfig) { }

    async sendSms(phone: string, message: string): Promise<SmsResult> {
        try {
            const response = await fetch('https://isms.celcomafrica.com/api/services/sendsms/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apikey: this.config.apikey,
                    partnerID: this.config.partnerID,
                    message,
                    shortcode: this.config.shortcode,
                    mobile: phone,
                }),
            });
            const data = await response.json() as any;
            if (data.responses?.[0]?.['respose-code'] === 200) {
                return { success: true, messageId: String(data.responses[0].messageid) };
            }
            return { success: false, error: data.responses?.[0]?.['response-description'] || 'Unknown error' };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    async getBalance(): Promise<BalanceResult> {
        try {
            const response = await fetch('https://isms.celcomafrica.com/api/services/getbalance/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apikey: this.config.apikey,
                    partnerID: this.config.partnerID,
                }),
            });
            const data = await response.json() as any;
            return { success: true, balance: parseFloat(data.credit || data.balance || 0) };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }
    async getDeliveryStatus(messageId: string): Promise<DeliveryStatusResult> {
        try {
            const response = await fetch('https://isms.celcomafrica.com/api/services/getdlr/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apikey: this.config.apikey,
                    partnerID: this.config.partnerID,
                    messageID: messageId,
                }),
            });
            const data = await response.json() as any;
            const item = data.responses?.[0];
            if (item) {
                return { success: true, status: item['delivery-status'] || 'Unknown', description: item['response-description'] };
            }
            return { success: false, status: 'Unknown', error: 'No data returned' };
        } catch (error: any) {
            return { success: false, status: 'Error', error: error.message };
        }
    }
}

class BytewaveAdapter implements SmsProviderAdapter {
    constructor(private config: BytewaveConfig) { }

    async sendSms(phone: string, message: string): Promise<SmsResult> {
        try {
            const response = await fetch('https://portal.bytewavenetworks.com/api/v3/sms/send', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.config.apiToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify({
                    recipient: phone,
                    sender_id: this.config.senderId,
                    type: 'plain',
                    message,
                }),
            });
            const data = await response.json() as any;
            if (data.status === 'success') {
                return { success: true, messageId: data.data?.uid };
            }
            return { success: false, error: data.message || 'Unknown error' };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    async getBalance(): Promise<BalanceResult> {
        return { success: false, error: 'Balance check not implemented for Bytewave' };
    }

    async getDeliveryStatus(messageId: string): Promise<DeliveryStatusResult> {
        return { success: false, status: 'Not Supported', error: 'Delivery status not implemented for Bytewave' };
    }
}

class BlessedtextAdapter implements SmsProviderAdapter {
    constructor(private config: BlessedtextConfig) { }

    async sendSms(phone: string, message: string): Promise<SmsResult> {
        try {
            const response = await fetch('https://sms.blessedtexts.com/api/sms/v1/sendsms', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify({
                    api_key: this.config.apiKey,
                    sender_id: this.config.senderId,
                    message,
                    phone,
                }),
            });
            const data = await response.json() as any;
            if (Array.isArray(data) && data[0]?.status_code === '1000') {
                return { success: true, messageId: data[0].message_id };
            }
            return { success: false, error: data[0]?.status_desc || 'Unknown error' };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    async getBalance(): Promise<BalanceResult> {
        try {
            const response = await fetch('https://sms.blessedtexts.com/api/sms/v1/credit-balance', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify({ api_key: this.config.apiKey }),
            });
            const data = await response.json() as any;
            if (data.status_code === '1000') {
                return { success: true, balance: parseFloat(data.balance) };
            }
            return { success: false, error: 'Failed to get balance' };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }
    async getDeliveryStatus(messageId: string): Promise<DeliveryStatusResult> {
        return { success: false, status: 'Not Supported', error: 'Delivery status not implemented for Blessedtext' };
    }
}

class AdvantaAdapter implements SmsProviderAdapter {
    constructor(private config: AdvantaConfig) { }

    async sendSms(phone: string, message: string): Promise<SmsResult> {
        try {
            const response = await fetch('https://quicksms.advantasms.com/api/services/sendsms/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apikey: this.config.apikey,
                    partnerID: this.config.partnerID,
                    message,
                    shortcode: this.config.shortcode,
                    mobile: phone,
                }),
            });
            const data = await response.json() as any;
            if (data.responses?.[0]?.['respose-code'] === 200) {
                return { success: true, messageId: String(data.responses[0].messageid) };
            }
            return { success: false, error: data.responses?.[0]?.['response-description'] || 'Unknown error' };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    async getBalance(): Promise<BalanceResult> {
        try {
            const response = await fetch('https://quicksms.advantasms.com/api/services/getbalance/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apikey: this.config.apikey,
                    partnerID: this.config.partnerID,
                }),
            });
            const data = await response.json() as any;
            return { success: true, balance: parseFloat(data.credit || data.balance || 0) };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }
    async getDeliveryStatus(messageId: string): Promise<DeliveryStatusResult> {
        try {
            const response = await fetch('https://quicksms.advantasms.com/api/services/getdlr/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apikey: this.config.apikey,
                    partnerID: this.config.partnerID,
                    messageID: messageId,
                }),
            });
            const data = await response.json() as any;
            const item = data.responses?.[0];
            if (item) {
                return { success: true, status: item['delivery-status'] || 'Unknown', description: item['response-description'] };
            }
            return { success: false, status: 'Unknown', error: 'No data returned' };
        } catch (error: any) {
            return { success: false, status: 'Error', error: error.message };
        }
    }
}

// ==================== SMS Service ====================

export const smsService = {
    /**
     * Get provider adapter for a tenant
     */
    getAdapter(provider: string, config: any): SmsProviderAdapter | null {
        switch (provider.toUpperCase()) {
            case 'TEXTSMS':
                return new TextSmsAdapter(config as TextSmsConfig);
            case 'TALKSASA':
                return new TalksasaAdapter(config as TalksasaConfig);
            case 'HOSTPINNACLE':
                return new HostpinnacleAdapter(config as HostpinnacleConfig);
            case 'CELCOM':
                return new CelcomAdapter(config as CelcomConfig);
            case 'BYTEWAVE':
                return new BytewaveAdapter(config as BytewaveConfig);
            case 'BLESSEDTEXT':
                return new BlessedtextAdapter(config as BlessedtextConfig);
            case 'ADVANTA':
                return new AdvantaAdapter(config as AdvantaConfig);
            default:
                return null;
        }
    },

    /**
     * Send SMS using tenant's configured provider
     */
    async sendSms(tenantId: string, phone: string, message: string, initiator?: string): Promise<SmsResult> {
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { smsProvider: true, smsConfig: true, smsSenderId: true, smsApiKey: true },
        });

        if (!tenant?.smsProvider) {
            return { success: false, error: 'No SMS provider configured' };
        }

        // Build config from both smsConfig (JSON) and legacy fields
        const config = {
            ...(tenant.smsConfig as object || {}),
            apiKey: tenant.smsApiKey,
            senderId: tenant.smsSenderId,
        };

        const adapter = this.getAdapter(tenant.smsProvider, config);
        if (!adapter) {
            return { success: false, error: `Unsupported SMS provider: ${tenant.smsProvider}` };
        }

        const result = await adapter.sendSms(phone, message);

        // Log the SMS
        try {
            await prisma.sMSLog.create({
                data: {
                    tenantId,
                    recipient: phone,
                    message,
                    status: result.success ? 'SENT' : 'FAILED',
                    provider: tenant.smsProvider,
                    initiator: initiator || 'system',
                    providerMessageId: result.messageId,
                },
            });
        } catch (logError: any) {
            logger.warn({ error: logError?.message }, 'Failed to log SMS');
        }

        return result;
    },

    /**
     * Get SMS balance for tenant's provider
     */
    async getBalance(tenantId: string): Promise<BalanceResult> {
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { smsProvider: true, smsConfig: true, smsApiKey: true },
        });

        if (!tenant?.smsProvider) {
            return { success: false, error: 'No SMS provider configured' };
        }

        const config = {
            ...(tenant.smsConfig as object || {}),
            apiKey: tenant.smsApiKey,
        };

        const adapter = this.getAdapter(tenant.smsProvider, config);
        if (!adapter) {
            return { success: false, error: `Unsupported SMS provider: ${tenant.smsProvider}` };
        }

        return adapter.getBalance();
    },

    /**
     * Get delivery status
     */
    async getDeliveryStatus(tenantId: string, messageId: string): Promise<DeliveryStatusResult> {
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { smsProvider: true, smsConfig: true, smsApiKey: true },
        });

        if (!tenant?.smsProvider) {
            return { success: false, status: 'Error', error: 'No SMS provider configured' };
        }

        const config = {
            ...(tenant.smsConfig as object || {}),
            apiKey: tenant.smsApiKey,
        };

        const adapter = this.getAdapter(tenant.smsProvider, config);
        if (!adapter) {
            return { success: false, status: 'Error', error: `Unsupported SMS provider: ${tenant.smsProvider}` };
        }

        return adapter.getDeliveryStatus(messageId);
    },

    /**
     * Test SMS provider configuration
     */
    async testConnection(provider: string, config: any): Promise<{ success: boolean; message: string }> {
        const adapter = this.getAdapter(provider, config);
        if (!adapter) {
            return { success: false, message: `Unsupported provider: ${provider}` };
        }

        const balanceResult = await adapter.getBalance();
        if (balanceResult.success) {
            return { success: true, message: `Connection successful. Balance: ${balanceResult.balance}` };
        }

        // If balance check not supported, try sending to a test number
        return { success: false, message: balanceResult.error || 'Connection test failed' };
    },

    /**
     * List available providers
     */
    getProviders(): { id: string; name: string; fields: string[] }[] {
        return [
            { id: 'TEXTSMS', name: 'TextSMS Kenya', fields: ['apikey', 'partnerID', 'shortcode'] },
            { id: 'TALKSASA', name: 'Talksasa Kenya', fields: ['proxyApiKey', 'senderId'] },
            { id: 'HOSTPINNACLE', name: 'Hostpinnacle Kenya', fields: ['apiKey', 'senderId'] },
            { id: 'CELCOM', name: 'Celcom Africa', fields: ['apikey', 'partnerID', 'shortcode'] },
            { id: 'BYTEWAVE', name: 'Bytewave Kenya', fields: ['apiToken', 'senderId'] },
            { id: 'BLESSEDTEXT', name: 'Blessedtext Kenya', fields: ['apiKey', 'senderId'] },
            { id: 'ADVANTA', name: 'Advanta Africa', fields: ['apikey', 'partnerID', 'shortcode'] },
        ];
    },
};
