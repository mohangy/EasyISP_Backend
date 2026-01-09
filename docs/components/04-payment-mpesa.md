# Payment & M-Pesa Integration Module

## Overview

The Payment & M-Pesa Integration module handles all financial transactions in the EasyISP system, with deep integration into Kenya's M-Pesa mobile money platform. It supports multiple payment methods, per-tenant M-Pesa configurations, STK Push payments, and automatic customer creation from hotspot payments.

---

## What It Does in the System

### Core Functionality

1. **Multi-Method Payment Tracking**
   - M-Pesa (Lipa Na M-Pesa)
   - Cash
   - Bank Transfer
   - Card payments
   - Other methods

2. **M-Pesa Integration**
   - **STK Push** (Lipa Na M-Pesa popup on customer phone)
   - **Transaction status queries**
   - **SMS message parsing** (extract M-Pesa codes from SMS)
   - **OAuth token management** (cached per tenant)
   - Support for **Paybill**, **Buy Goods (Till)**, and **Bank** account types

3. **Multi-Tenant M-Pesa Configuration**
   - Each ISP tenant has own M-Pesa credentials
   - Multiple payment gateways per tenant
   - Separate gateways for Hotspot vs PPPoE
   - Sandbox and production environment support

4. **Hotspot Self-Service Payments**
   - Customers pay via M-Pesa directly from captive portal
   - Auto-creates customer account on successful payment
   - M-Pesa transaction code becomes username/password
   - MAC address binding for auto-login

5. **Pending Payment Management**
   - Tracks pending M-Pesa STK Push requests
   - 5-minute expiry window
   - Auto-completion on successful callback
   - Failure handling

---

## M-Pesa Configuration Types

### 1. **Paybill (Business Shortcode)**
Most common for companies with registered paybills.

```json
{
  "type": "MPESA_API",
  "subType": "PAYBILL",
  "shortcode": "123456",
  "consumerKey": "abc123...",
  "consumer Secret": "xyz789...",
  "passkey": "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919",
  "env": "production"
}
```

**How it works**:
- Customer pays to `Paybill 123456`
- Account number: Any reference (customer ID, phone, etc.)
- Both `BusinessShortCode` and `PartyB` = shortcode in API calls

---

###2. **Buy Goods (Till Number)**
For merchants with Buy Goods tills.

```json
{
  "type": "MPESA_API",
  "subType": "BUYGOODS",
  "shortcode": "7654321",  // Till Number
  "storeNumber": "123456",  // Head Office Store Number
  "consumerKey": "abc123...",
  "consumerSecret": "xyz789...",
  "passkey": "bfb279...",
  "env": "production"
}
```

**How it works**:
- Customer pays to `Buy Goods Till 7654321`
- `BusinessShortCode` = storeNumber (Head Office)
- `PartyB` = shortcode (Till Number)

**Critical**: Buy Goods requires both till number AND store number.

---

### 3. **Bank Account**
For direct bank account deposits (no API, manual reconciliation).

```json
{
  "type": "MPESA_NO_API",
  "subType": "BANK",
  "accountNumber": "1234567890",
  "shortcode": "Bank Name"
}
```

**How it works**:
- Customer sends money to paybill/till of BANK
- Account number: ISP's bank account
- No automated confirmation
- Manual SMS parsing or bank statement reconciliation

---

## API Endpoints

### Payment Tracking Endpoints

#### GET `/api/payments`
**Purpose**: List all payments with filtering

**Auth**: Required  
**Permissions**: `finance:payments_view`

**Query Parameters**:
- `page`, `pageSize`
- `status` - Filter by status (pending, completed, failed, refunded)
- `method` - Filter by method (mpesa, cash, bank_transfer, card)
- `customerId` - Filter by customer
- `startDate`, `endDate` - Date range

**Response** (200):
```json
{
  "payments": [
    {
      "id": "uuid",
      "amount": 2000,
      "method": "MPESA",
      "status": "COMPLETED",
      "transactionId": "RCB123456",
      "phone": "+254700000000",
      "account": "customer001",
      "description": "Monthly subscription payment",
      "customer": {
        "id": "uuid",
        "name": "John Doe"
      },
      "createdAt": "2026-01-01T10:30:00Z",
      "updatedAt": "2026-01-01T10:31:00Z"
    }
  ],
  "total": 450,
  "page": 1,
  "pageSize": 20
}
```

---

### M-Pesa STK Push Endpoints

#### POST `/api/portal/mpesa/initiate`
**Purpose**: Initiate M-Pesa STK Push for hotspot payment (PUBLIC endpoint)

**Auth**: NOT required (public for captive portal)

**Request Body**:
```json
{
  "tenantId": "uuid",
  "phone": "254700000000",  // Must start with 254
  "packageId": "uuid",
  "macAddress": "00:11:22:33:44:55",  // Optional: for auto-login
  "nasIp": "192.168.1.1"  // Optional: router IP
}
```

**Response** (200):
```json
{
  "success": true,
  "checkoutRequestId": "ws_CO_01012026103000123456789",
  "merchantRequestId": "1234-5678-9012",
  "message": "Payment request sent to 0700000000. Enter your PIN to complete."
}
```

**What Happens**:
1. Validates tenant has M-Pesa gateway configured
2. Validates phone number format (254XXXXXXXXX)
3. Gets package details and price
4. Gets OAuth access token (cached)
5. Sends STK Push to M-Pesa API
6. Creates `PendingHotspotPayment` record
7. Sets expiry to 5 minutes from now
8. Returns checkout request ID for status tracking

---

#### GET `/api/portal/mpesa/status/:checkoutRequestId`
**Purpose**: Check M-Pesa payment status (PUBLIC endpoint)

**Auth**: NOT required

**Response** (200) - Pending:
```json
{
  "status": "PENDING",
  "message": "Waiting for customer to enter PIN"
}
```

**Response** (200) - Success:
```json
{
  "status": "COMPLETED",
  "message": "Payment successful",
  "customer": {
    "username": "RCB123456",
    "password": "RCB123456",
    "expiresAt": "2026-02-01T10:30:00Z"
  },
  "package": {
    "name": "5 Mbps - 1GB",
    "speed": "5/5 Mbps",
    "data": "1 GB"
  }
}
```

**Response** (200) - Failed:
```json
{
  "status": "FAILED",
  "message": "Payment cancelled by user"
}
```

---

#### POST `/api/portal/mpesa/verify-sms`
**Purpose**: Verify payment via M-Pesa SMS (for no-API setup)

**Auth**: NOT required

**Request Body**:
```json
{
  "tenantId": "uuid",
  "smsText": "RCB123456 Confirmed. Ksh500.00 sent to COMPANY LTD...",
  "packageId": "uuid",
  "macAddress": "00:11:22:33:44:55"
}
```

**Response** (200):
```json
{
  "success": true,
  "transactionCode": "RCB123456",
  "amount": 500,
  "customer": {
    "username": "RCB123456",
    "password": "RCB123456"
  }
}
```

**What Happens**:
1. Parses SMS text using regex
2. Extracts transaction code (e.g., "RCB123456")
3. Extracts amount (e.g., "500.00")
4. Validates amount matches package price
5. Creates customer with transaction code as username/password
6. Returns credentials for auto-login

**Supported SMS Formats**:
```
RCB123456 Confirmed. Ksh500.00 sent to COMPANY LTD...
SJK4H7L2PQ Confirmed. You have sent Ksh500.00 to...
```

---

### M-Pesa Management Endpoints

#### GET `/api/payment-gateways`
**Purpose**: List tenant's M-Pesa gateways

**Auth**: Required

**Response** (200):
```json
{
  "gateways": [
    {
      "id": "uuid",
      "type": "MPESA_API",
      "subType": "PAYBILL",
      "name": "Main Paybill",
      "shortcode": "123456",
      "isDefault": true,
      "forHotspot": true,
      "forPppoe": false,
      "env": "production",
      "createdAt": "2026-01-01T00:00:00Z"
    },
    {
      "id": "uuid2",
      "type": "MPESA_API",
      "subType": "BUYGOODS",
      "name": "Buy Goods Till",
      "shortcode": "7654321",
      "storeNumber": "123456",
      "isDefault": false,
      "forHotspot": false,
      "forPppoe": true,
      "env": "production"
    }
  ]
}
```

---

#### POST `/api/payment-gateways`
**Purpose**: Add M-Pesa gateway configuration

**Auth**: Required  
**Permissions**: `finance:settings_edit`

**Request Body** (Paybill):
```json
{
  "type": "MPESA_API",
  "subType": "PAYBILL",
  "name": "Main Paybill",
  "shortcode": "123456",
  "consumerKey": "abc123...",
  "consumerSecret": "xyz789...",
  "passkey": "bfb279...",
  "env": "production",
  "isDefault": true,
  "forHotspot": true,
  "forPppoe": false
}
```

**Request Body** (Buy Goods):
```json
{
  "type": "MPESA_API",
  "subType": "BUYGOODS",
  "name": "Till for Hotspot",
  "shortcode": "7654321",  // Till Number
  "storeNumber": "123456",  // Head Office
  "consumerKey": "abc123...",
  "consumerSecret": "xyz789...",
  "passkey": "bfb279...",
  "env": "production",
  "forHotspot": true
}
```

---

#### POST `/api/payment-gateways/:id/test`
**Purpose**: Test M-Pesa gateway connection

**Auth**: Required

**Response** (200):
```json
{
  "success": true,
  "message": "Successfully connected to M-Pesa API"
}
```

**What Happens**:
1. Attempts to get OAuth access token
2. If successful, gateway is configured correctly
3. If failed, returns error message

---

## What's Complete ✅

1. ✅ Multi-method payment tracking (M-Pesa, Cash, Bank, Card)
2. ✅ Payment status management (Pending, Completed, Failed, Refunded)
3. ✅ M-Pesa STK Push integration
4. ✅ M-Pesa transaction status query
5. ✅ M-Pesa SMS message parsing
6. ✅ Per-tenant M-Pesa configuration
7. ✅ Multiple payment gateways per tenant
8. ✅ Paybill support
9. ✅ Buy Goods (Till) support
10. ✅ Bank account (no-API) support
11. ✅ Sandbox and production environments
12. ✅ OAuth token caching (per tenant)
13. ✅ Hotspot self-service payments
14. ✅ Auto-customer creation from M-Pesa payment
15. ✅ MAC address binding for auto-login
16. ✅ Pending payment tracking with 5-minute expiry
17. ✅ Gateway testing endpoint

---

## What's NOT Complete ⚠️

1. ⚠️ **M-Pesa Callbacks**: No callback URL handler for M-Pesa confirmation
2. ⚠️ **B2C Payments**: No bulk payouts to customers (refunds, commissions)
3. ⚠️ **Transaction Reconciliation**: No automated bank statement import
4. ⚠️ **Refund Processing**: Manual refunds only, no M-Pesa reversal API
5. ⚠️ **Payment Links**: No shareable payment links for customers
6. ⚠️ **Recurring Payments**: No auto-debit subscriptions
7. ⚠️ **Payment Reminders**: No SMS reminders before expiry
8. ⚠️ **Payment Plans**: No installment payment support
9. ⚠️ **Multi-Currency**: Only KES (Kenyan Shillings) supported
10. ⚠️ **Payment Gateway Failover**: No automatic switch between gateways

---

## What's Working ✅

All implemented features are functional:
- M-Pesa STK Push (Paybill and Buy Goods)
- Payment status tracking
- SMS parsing for no-API setups
- Hotspot self-service payments
- Customer auto-creation
- Gateway management

---

## What's NOT Working ❌

1. **M-Pesa Callback Handler**
   - Callback URL defined but no endpoint implemented
   - Must manually query status instead of waiting for callback
   - **Impact**: Slower payment confirmation, polling overhead

2. **Token Expiry Handling**
   - Cached tokens may expire mid-transaction
   - No automatic retry with fresh token
   - **Impact**: Occasional STK Push failures

---

## Security Issues 🔐

### Critical

1. **Public STK Push Endpoint**
   - **Risk**: `/api/portal/mpesa/initiate` is public (no auth)
   - **Impact**: Anyone can initiate charges to any phone number
   - **Mitigation**: Add rate limiting (5 attempts per IP per hour)

2. **No CAPTCHA on Payment**
   - **Risk**: Bots can spam STK Push requests
   - **Impact**: Customer harassment, M-Pesa API rate limits
   - **Mitigation**: Add CAPTCHA before initiating payment

3. **M-Pesa Credentials in Database**
   - **Risk**: Consumer keys, secrets, and passkeys stored as plaintext
   - **Impact**: If DB compromised, attacker can process payments
   - **Mitigation**: Encrypt sensitive fields with AES-256

4. **No Callback URL Validation**
   - **Risk**: M-Pesa sends callbacks but they're not verified
   - **Impact**: Attackers could forge payment confirmations
   - **Mitigation**: Implement callback signature verification

### Medium

5. **SMS Parsing Vulnerabilities**
   - **Risk**: Regex-based SMS parsing can be bypassed
   - **Impact**: Fake payments via crafted SMS text
   - **Mitigation**: Validate transaction codes against M-Pesa API

6. **Pending Payment Cleanup**
   - **Risk**: Expired pending payments stay in DB forever
   - **Impact**: Database bloat
   - **Mitigation**: Cron job to delete records >24 hours old

7. **Amount Validation**
   - **Risk**: Package price not strictly enforced
   - **Impact**: Customers could pay less than package price
   - **Mitigation**: Reject payments if amount !== package price

### Low

8. **Phone Number Enumeration**
   - **Risk**: Can test if phone numbers are valid via STK Push
   - **Impact**: Privacy concerns
   - **Mitigation**: Generic error messages

---

## Possible Improvements 🚀

### High Priority

1. **M-Pesa Callback Handler**
   ```typescript
   POST /api/mpesa/callback
   
   // Validate signature
   // Update PendingHotspotPayment status
   // Create customer if successful
   // Send SMS confirmation
   ```

2. **Rate Limiting on STK Push**
   ```typescript
   // 5 STK requests per phone per hour
   // 20 STK requests per IP per hour
   ```

3. **Encrypt M-Pesa Credentials**
   ```typescript
   import crypto from 'crypto';
   
   const encrypt = (text: string) => {
     const cipher = crypto.createCipher('aes-256-gcm', ENCRYPTION_KEY);
     return cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
   };
   ```

4. **Payment Reconciliation Dashboard**
   ```typescript
   GET /api/finance/reconcile
   
   // Show:
   // - M-Pesa transactions from API
   // - Payments recorded in system
   // - Unmatched transactions
   // - Suggested matches
   ```

### Medium Priority

5. **B2C Payments (Payouts)**
   ```typescript
   POST /api/mpesa/b2c
   {
     phone: "254700000000",
     amount: 500,
     reason: "Refund for overpayment"
   }
   ```

6. **Payment Links**
   ```typescript
   POST /api/payments/links
   {
     customerId: "uuid",
     amount: 2000,
     description: "Monthly internet"
   }
   
   // Returns: https://isp.com/pay/abc123
   // Customer clicks → STK Push initiated
   ```

7. **Recurring Payments**
   ```typescript
   POST /api/customers/:id/auto-renew
   {
     enabled: true,
     dayOfMonth: 1  // Auto-charge on 1st of month
   }
   ```

8. **Payment Reminders**
   ```typescript
   // Cron job: Daily at 9 AM
   // Find customers expiring in 3 days
   // Send SMS: "Your internet expires in 3 days. Pay Ksh 2000 to Paybill 123456"
   ```

### Low Priority

9. **Multi-Currency Support**
   ```typescript
   {
     currency: "USD",
     amount: 20,
     exchangeRate: 150  // To KES
   }
   ```

10. **Payment Plans**
    ```typescript
    {
      totalAmount: 6000,
      installments: 3,  // 3 x 2000
      frequency: "monthly"
    }
    ```

11. **Payment Gateway Failover**
    ```typescript
    // If primary gateway fails, try secondary
    const gateways = await prisma.paymentGateway.findMany({
      where: { tenantId, isDefault: true },
      orderBy: { createdAt: 'asc' }
    });
    ```

---

## M-Pesa API Reference

### OAuth Token
```http
GET https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials
Authorization: Basic base64(consumerKey:consumerSecret)
```

### STK Push (Paybill)
```http
POST https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest
{
  "BusinessShortCode": "123456",
  "Password": "base64(shortcode + passkey + timestamp)",
  "Timestamp": "20260104103000",
  "TransactionType": "CustomerPayBillOnline",
  "Amount": 500,
  "PartyA": "254700000000",
  "PartyB": "123456",
  "PhoneNumber": "254700000000",
  "CallBackURL": "https://example.com/callback",
  "AccountReference": "Invoice123",
  "TransactionDesc": "Payment for service"
}
```

### STK Push (Buy Goods)
```http
POST https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest
{
  "BusinessShortCode": "123456",  // Store Number (Head Office)
  "Password": "base64(storeNumber + passkey + timestamp)",
  "Timestamp": "20260104103000",
  "TransactionType": "CustomerBuyGoodsOnline",
  "Amount": 500,
  "PartyA": "254700000000",
  "PartyB": "7654321",  // Till Number
  "PhoneNumber": "254700000000",
  "CallBackURL": "https://example.com/callback",
  "AccountReference": "Invoice123",
  "TransactionDesc": "Payment"
}
```

### STK Query
```http
POST https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query
{
  "BusinessShortCode": "123456",
  "Password": "base64(shortcode + passkey + timestamp)",
  "Timestamp": "20260104103000",
  "CheckoutRequestID": "ws_CO_01012026103000123456789"
}
```

---

## Related Modules

- **Customer Management**: Payments linked to customers
- **Package Management**: Package prices used in payments
- **Hotspot Portal**: Self-service M-Pesa payments
- **Finance Module**: Revenue tracking and reporting
- **SMS Gateway**: Send payment confirmations
- **Audit Logging**: Track all payment events

---

## Testing Recommendations

1. **Sandbox Testing**
   - Use M-Pesa sandbox environment
   - Test phone: 254708374149 (always succeeds)

2. **Unit Tests**
   - SMS parsing regex
   - Phone number formatting
   - Password generation

3. **Integration Tests**
   - STK Push → query status → verify pending payment
   - Successful payment → verify customer created
   - Failed payment → verify status updated

4. **Load Tests**
   - 100 concurrent STK Push requests
   - Token caching effectiveness

---

## Migration Path

1. **Immediate** (Week 1):
   - Encrypt M-Pesa credentials in database
   - Add rate limiting on STK Push endpoint
   - Implement callback handler

2. **Short-term** (Month 1):
   - Build payment reconciliation dashboard
   - Add B2C payout support
   - Create payment links feature

3. **Long-term** (Quarter 1):
   - Implement recurring payments
   - Add payment reminders
   - Build multi-currency support
