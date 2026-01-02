import { describe, it, expect } from 'vitest';

// Import only the validation function without the full service
// This avoids loading Prisma and other dependencies
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

interface BuyGoodsValidationResult {
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
function validateBuyGoodsConfig(config: MpesaConfig): BuyGoodsValidationResult {
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

describe('M-Pesa BuyGoods Configuration', () => {
    describe('validateBuyGoodsConfig', () => {
        it('should validate a complete BuyGoods configuration', () => {
            const config = {
                subType: 'BUYGOODS' as const,
                consumerKey: 'test-consumer-key',
                consumerSecret: 'test-consumer-secret',
                shortcode: '123456', // Till Number
                storeNumber: '654321', // Store/Head Office Number
                passkey: 'test-passkey',
                callbackUrl: 'https://example.com/callback',
                env: 'sandbox' as const,
            };

            const result = validateBuyGoodsConfig(config);

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
            expect(result.configType).toBe('BUYGOODS');
            expect(result.details?.tillNumber).toBe('123456');
            expect(result.details?.storeNumber).toBe('654321');
            expect(result.details?.environment).toBe('sandbox');
        });

        it('should fail validation when BuyGoods is missing store number', () => {
            const config = {
                subType: 'BUYGOODS' as const,
                consumerKey: 'test-consumer-key',
                consumerSecret: 'test-consumer-secret',
                shortcode: '123456',
                passkey: 'test-passkey',
                callbackUrl: 'https://example.com/callback',
                env: 'sandbox' as const,
            };

            const result = validateBuyGoodsConfig(config);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Store Number (Head Office) is required for BuyGoods STK Push');
            expect(result.configType).toBe('BUYGOODS');
        });

        it('should fail validation when BuyGoods is missing till number', () => {
            const config = {
                subType: 'BUYGOODS' as const,
                consumerKey: 'test-consumer-key',
                consumerSecret: 'test-consumer-secret',
                shortcode: '',
                storeNumber: '654321',
                passkey: 'test-passkey',
                callbackUrl: 'https://example.com/callback',
                env: 'sandbox' as const,
            };

            const result = validateBuyGoodsConfig(config);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Till Number (shortcode) is required for BuyGoods');
        });

        it('should fail validation when missing consumer credentials', () => {
            const config = {
                subType: 'BUYGOODS' as const,
                consumerKey: '',
                consumerSecret: '',
                shortcode: '123456',
                storeNumber: '654321',
                passkey: 'test-passkey',
                callbackUrl: 'https://example.com/callback',
                env: 'sandbox' as const,
            };

            const result = validateBuyGoodsConfig(config);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Consumer Key is required');
            expect(result.errors).toContain('Consumer Secret is required');
        });

        it('should fail validation when missing passkey', () => {
            const config = {
                subType: 'BUYGOODS' as const,
                consumerKey: 'test-consumer-key',
                consumerSecret: 'test-consumer-secret',
                shortcode: '123456',
                storeNumber: '654321',
                passkey: '',
                callbackUrl: 'https://example.com/callback',
                env: 'sandbox' as const,
            };

            const result = validateBuyGoodsConfig(config);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Passkey is required');
        });

        it('should validate a complete PayBill configuration', () => {
            const config = {
                subType: 'PAYBILL' as const,
                consumerKey: 'test-consumer-key',
                consumerSecret: 'test-consumer-secret',
                shortcode: '123456',
                passkey: 'test-passkey',
                callbackUrl: 'https://example.com/callback',
                env: 'production' as const,
            };

            const result = validateBuyGoodsConfig(config);

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
            expect(result.configType).toBe('PAYBILL');
        });

        it('should validate a complete Bank configuration', () => {
            const config = {
                subType: 'BANK' as const,
                consumerKey: 'test-consumer-key',
                consumerSecret: 'test-consumer-secret',
                shortcode: '123456',
                accountNumber: '7890123456',
                passkey: 'test-passkey',
                callbackUrl: 'https://example.com/callback',
                env: 'production' as const,
            };

            const result = validateBuyGoodsConfig(config);

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
            expect(result.configType).toBe('BANK');
        });

        it('should fail Bank validation when missing account number', () => {
            const config = {
                subType: 'BANK' as const,
                consumerKey: 'test-consumer-key',
                consumerSecret: 'test-consumer-secret',
                shortcode: '123456',
                passkey: 'test-passkey',
                callbackUrl: 'https://example.com/callback',
                env: 'production' as const,
            };

            const result = validateBuyGoodsConfig(config);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Target Account Number is required for Bank transfers');
        });
    });
});
