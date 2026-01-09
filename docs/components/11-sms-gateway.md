# SMS Gateway Integration Module

## Overview

The SMS Gateway module provides a unified multi-provider SMS sending interface with adapters for 7 different Kenyan SMS providers. It uses the **Strategy/Adapter pattern** to abstract provider-specific implementations, allowing tenants to configure their preferred SMS provider.

**Source File**: `/root/easyisp/Backend/src/services/sms.service.ts` (658 lines, 24 KB)

---

## Supported Providers

| Provider | API URL | Required Fields |
|----------|---------|-----------------|
| **TextSMS** | `sms.textsms.co.ke` | `apikey`, `partnerID`, `shortcode` |
| **Talksasa** | `ladybird.talksasa.com` | `proxyApiKey`, `senderId` |
| **Hostpinnacle** | `smsportal.hostpinnacle.co.ke` | `apiKey` OR `userId`+`password`, `senderId` |
| **Celcom** | `isms.celcomafrica.com` | `apikey`, `partnerID`, `shortcode` |
| **Bytewave** | `portal.bytewavenetworks.com` | `apiToken`, `senderId` |
| **Blessedtext** | `sms.blessedtexts.com` | `apiKey`, `senderId` |
| **Advanta** | `quicksms.advantasms.com` | `apikey`, `partnerID`, `shortcode` |

---

## Architecture

### Interface Definitions

```typescript
interface SmsProviderAdapter {
    sendSms(phone: string, message: string): Promise<SmsResult>;
    getBalance(): Promise<BalanceResult>;
    getDeliveryStatus(messageId: string): Promise<DeliveryStatusResult>;
}

interface SmsResult {
    success: boolean;
    messageId?: string;
    error?: string;
}

interface BalanceResult {
    success: boolean;
    balance?: number;
    error?: string;
}

interface DeliveryStatusResult {
    success: boolean;
    status: string;
    description?: string;
    error?: string;
}
```

### Adapter Pattern

Each provider has its own adapter class implementing `SmsProviderAdapter`:

```
TextSmsAdapter      → textsms.co.ke
TalksasaAdapter     → talksasa.com
HostpinnacleAdapter → hostpinnacle.co.ke
CelcomAdapter       → celcomafrica.com
BytewaveAdapter     → bytewavenetworks.com
BlessedtextAdapter  → blessedtexts.com
AdvantaAdapter      → advantasms.com
```

---

## Provider Implementations

### TextSMS Kenya

```typescript
class TextSmsAdapter {
    async sendSms(phone: string, message: string): Promise<SmsResult> {
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
        // Success: respose-code === 200 (typo in API)
    }
    
    async getBalance(): Promise<BalanceResult>  // ✅ Supported
    async getDeliveryStatus(messageId): Promise<DeliveryStatusResult>  // ✅ Supported
}
```

### Talksasa

```typescript
class TalksasaAdapter {
    async sendSms(phone: string, message: string): Promise<SmsResult> {
        const response = await fetch('https://ladybird.talksasa.com/send-sms', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.config.proxyApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                recipient: phone,
                sender_id: this.config.senderId,
                type: 'plain',
                message,
            }),
        });
    }
    
    async getBalance(): Promise<BalanceResult>  // ❌ Not supported
    async getDeliveryStatus(): Promise<DeliveryStatusResult>  // ❌ Not supported
}
```

### Hostpinnacle

```typescript
class HostpinnacleAdapter {
    async sendSms(phone: string, message: string): Promise<SmsResult> {
        const params = new URLSearchParams({
            sendMethod: 'quick',
            mobile: phone,
            msg: message,
            senderid: this.config.senderId,
            msgType: 'text',
            output: 'json',
        });
        // Supports both apiKey OR userId+password auth
        if (this.config.apiKey) headers['apikey'] = this.config.apiKey;
    }
    
    async getBalance(): Promise<BalanceResult>  // ❌ Not supported
    async getDeliveryStatus(): Promise<DeliveryStatusResult>  // ❌ Not supported
}
```

### Provider Feature Support Matrix

| Provider | Send SMS | Balance | Delivery Status |
|----------|----------|---------|-----------------|
| TextSMS | ✅ | ✅ | ✅ |
| Talksasa | ✅ | ❌ | ❌ |
| Hostpinnacle | ✅ | ❌ | ❌ |
| Celcom | ✅ | ✅ | ✅ |
| Bytewave | ✅ | ❌ | ❌ |
| Blessedtext | ✅ | ✅ | ❌ |
| Advanta | ✅ | ✅ | ✅ |

---

## Service Methods

### `sendSms(tenantId, phone, message, initiator?, purpose?)`

Send SMS using tenant's configured provider.

```typescript
const result = await smsService.sendSms(
    tenantId,
    '0712345678',
    'Your WiFi code is ABC123',
    'Hotspot Payment',
    'HOTSPOT'  // Optional: Use hotspot-specific gateway
);
```

**What It Does**:
1. Gets gateway config (checks for purpose-specific gateway first)
2. Gets adapter for provider
3. Sends SMS via adapter
4. **Logs to SMSLog table** with status, provider, messageId

### `getBalance(tenantId)`

Check SMS credits for tenant's provider.

```typescript
const result = await smsService.getBalance(tenantId);
// { success: true, balance: 1250 }
```

### `getDeliveryStatus(tenantId, messageId)`

Check delivery status of previously sent message.

```typescript
const status = await smsService.getDeliveryStatus(tenantId, 'MSG123');
// { success: true, status: 'Delivered', description: 'Message delivered' }
```

### `testConnection(provider, config)`

Test if provider credentials are valid.

```typescript
const test = await smsService.testConnection('TEXTSMS', {
    apikey: 'xxx',
    partnerID: '12345',
    shortcode: 'MYISP'
});
// { success: true, message: 'Connection successful. Balance: 500' }
```

### `testGateway(gatewayId)`

Test a stored gateway configuration by ID.

### `getProviders()`

List all available providers with their required fields.

```typescript
const providers = smsService.getProviders();
// [
//   { id: 'TEXTSMS', name: 'TextSMS Kenya', fields: ['apikey', 'partnerID', 'shortcode'] },
//   { id: 'TALKSASA', name: 'Talksasa Kenya', fields: ['proxyApiKey', 'senderId'] },
//   ...
// ]
```

---

## Gateway Configuration

### Per-Purpose Gateways

Tenants can configure different gateways for different purposes:

```typescript
// In getGatewayConfig:
if (purpose) {
    gateway = await prisma.smsGateway.findFirst({
        where: {
            tenantId,
            [purpose === 'HOTSPOT' ? 'forHotspot' : 'forPppoe']: true
        }
    });
}
```

Use cases:
- **Hotspot**: Use cheaper bulk SMS provider for high volume
- **PPPoE**: Use premium provider with better delivery for billing

### Fallback Chain

1. Purpose-specific gateway (`forHotspot: true` or `forPppoe: true`)
2. Default gateway (`isDefault: true`)
3. Legacy tenant config (`tenant.smsProvider`, `tenant.smsApiKey`, etc.)

---

## SMS Logging

All sent messages are logged to the `SMSLog` table:

```typescript
await prisma.sMSLog.create({
    data: {
        tenantId,
        recipient: phone,
        message,
        status: result.success ? 'SENT' : 'FAILED',
        provider: gw.provider,
        initiator: initiator || 'system',
        providerMessageId: result.messageId,
    },
});
```

---

## What's Complete ✅

1. ✅ 7 SMS provider adapters implemented
2. ✅ Unified `sendSms()` interface
3. ✅ Balance checking (where supported)
4. ✅ Delivery status (where supported)
5. ✅ Per-tenant gateway configuration
6. ✅ Purpose-specific gateways (Hotspot vs PPPoE)
7. ✅ Fallback to legacy config
8. ✅ SMS logging to database
9. ✅ Connection testing
10. ✅ Provider listing with required fields

---

## What's NOT Complete ⚠️

1. ⚠️ **Automatic Failover** - No retry with secondary provider on failure
2. ⚠️ **SMS Templates** - No template management
3. ⚠️ **Scheduled SMS** - No delayed sending
4. ⚠️ **Bulk SMS** - No CSV import for mass sending
5. ⚠️ **Webhook Delivery Reports** - No incoming DLR webhooks
6. ⚠️ **Spending Limits** - No daily/monthly SMS caps
7. ⚠️ **Two-Way SMS** - No inbound message handling
8. ⚠️ **Unicode Detection** - No automatic message encoding

---

## What's Working ✅

All core features are functional:
- Send SMS via any of 7 providers ✓
- Balance checking (TextSMS, Celcom, Blessedtext, Advanta) ✓
- Delivery status (TextSMS, Celcom, Advanta) ✓
- SMS logging ✓

---

## What's NOT Working ❌

No critical issues. Minor concerns:

1. **Balance/Delivery Not Supported By All**
   - Some providers return "not supported" errors
   - `testConnection()` handles this gracefully

---

## Security Issues 🔐

### Critical

1. **API Keys in Plaintext**
   - **Location**: `SmsGateway.apiKey`, `SmsGateway.config`
   - **Risk**: SMS account compromise if DB breached
   - **Mitigation**: Encrypt API keys

### Medium

2. **No Rate Limiting**
   - **Risk**: SMS spam, high costs
   - **Impact**: Depleted SMS credits
   - **Mitigation**: Add sending limits per tenant

3. **No Message Validation**
   - **Risk**: Injection attacks in message content
   - **Impact**: SMS spoofing
   - **Mitigation**: Sanitize message content

---

## Possible Improvements 🚀

### High Priority

1. **Automatic Failover**
   ```typescript
   async sendSmsWithFailover(tenantId, phone, message) {
       const gateways = await this.getAllGateways(tenantId);
       for (const gw of gateways) {
           const result = await this.trySend(gw, phone, message);
           if (result.success) return result;
           logger.warn({ provider: gw.provider }, 'SMS failed, trying next provider');
       }
       return { success: false, error: 'All providers failed' };
   }
   ```

2. **SMS Templates**
   ```typescript
   // Store templates
   model SmsTemplate {
       id       String @id
       tenantId String
       name     String  // e.g., "payment_confirmation"
       content  String  // "Hi {{name}}, payment of {{amount}} received."
   }
   
   // Use templates
   await smsService.sendFromTemplate(tenantId, phone, 'payment_confirmation', {
       name: 'John',
       amount: 'Ksh 500'
   });
   ```

3. **Spending Limits**
   ```typescript
   model SmsGateway {
       // Add fields
       dailyLimit    Int?
       monthlyLimit  Int?
       currentDaily  Int @default(0)
       currentMonthly Int @default(0)
   }
   
   // Check before sending
   if (gateway.currentDaily >= gateway.dailyLimit) {
       return { success: false, error: 'Daily SMS limit reached' };
   }
   ```

### Medium Priority

4. **Scheduled SMS**
   ```typescript
   await smsService.scheduleSms(tenantId, phone, message, {
       sendAt: new Date('2026-01-05T10:00:00Z'),
       timezone: 'Africa/Nairobi'
   });
   ```

5. **Bulk SMS**
   ```typescript
   await smsService.sendBulk(tenantId, [
       { phone: '0712345678', message: 'Hello John' },
       { phone: '0722345678', message: 'Hello Jane' },
   ]);
   ```

6. **Unicode Auto-Detection**
   ```typescript
   const isUnicode = /[^\u0000-\u007F]/.test(message);
   // Adjust character limits: GSM (160) vs Unicode (70)
   ```

---

## Related Modules

- **Customer Management** - Sends welcome/expiry SMS
- **Payment Module** - Sends payment confirmations
- **Hotspot Portal** - Sends login credentials
- **Voucher System** - Could send voucher codes

---

## Testing Recommendations

1. **Unit Tests**
   - Adapter factory (`getAdapter`)
   - Phone number formatting
   - Message truncation

2. **Integration Tests**
   - Send SMS with each provider (use test accounts)
   - Balance checking
   - Delivery status polling

3. **Mock Tests**
   - Test with mocked API responses
   - Test error handling

---

## Example Usage

```typescript
import { smsService } from '../services/sms.service.js';

// Send SMS
const result = await smsService.sendSms(
    tenantId,
    '254712345678',
    'Your WiFi code is ABC123. Valid for 24 hours.',
    'Hotspot System',
    'HOTSPOT'
);

if (result.success) {
    console.log('SMS sent:', result.messageId);
} else {
    console.error('SMS failed:', result.error);
}

// Check balance
const balance = await smsService.getBalance(tenantId);
console.log('SMS credits:', balance.balance);

// List providers for UI
const providers = smsService.getProviders();
// Use in dropdown for gateway configuration
```

---

## Migration Path

1. **Immediate** (Week 1):
   - Encrypt API keys in database
   - Add daily sending limits

2. **Short-term** (Month 1):
   - Implement automatic failover
   - Add SMS templates

3. **Long-term** (Quarter 1):
   - Add scheduled SMS
   - Implement bulk SMS
   - Add two-way SMS support
