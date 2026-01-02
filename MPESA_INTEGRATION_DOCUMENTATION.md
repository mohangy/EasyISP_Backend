# M-Pesa Gateway Integration Documentation

This document provides a comprehensive overview of where and how M-Pesa payment gateway has been integrated in the EasyISP Backend system.

## Table of Contents
1. [Core Service Implementation](#core-service-implementation)
2. [API Routes and Endpoints](#api-routes-and-endpoints)
3. [Database Schema](#database-schema)
4. [Configuration](#configuration)
5. [Frontend Integration](#frontend-integration)
6. [Webhook Handlers](#webhook-handlers)

---

## Core Service Implementation

### File: `src/services/mpesa.service.ts`
This is the primary M-Pesa service file containing all core M-Pesa functionality.

**Key Functions:**

1. **Authentication & Configuration**
   - `getTenantMpesaConfig(tenantId, purpose?)` - Retrieves M-Pesa configuration for a specific tenant
   - `getAccessToken(tenantId, purpose?)` - Gets OAuth access token (with caching)
   - `validateBuyGoodsConfig(config)` - Validates M-Pesa BuyGoods configuration
   - `testGateway(gatewayId)` - Tests M-Pesa gateway connection

2. **Payment Processing**
   - `initiateSTKPush(tenantId, phone, amount, accountReference, transactionDesc)` - Initiates STK Push request
   - `querySTKStatus(tenantId, checkoutRequestId)` - Queries STK Push payment status
   - `formatPhoneNumber(phone)` - Formats phone numbers to M-Pesa format (254XXXXXXXXX)

3. **SMS & Transaction Parsing**
   - `parseMpesaSms(smsText)` - Parses M-Pesa SMS to extract transaction codes
   - `createHotspotCustomerFromPayment(tenantId, transactionCode, phone, packageId, amount)` - Creates hotspot customer from payment

**Supported Payment Types:**
- PayBill
- BuyGoods (with Till Number)
- Bank Transfer

**Features:**
- Multi-tenant support (per-tenant M-Pesa configurations)
- Token caching for performance
- Sandbox and production environment support
- Comprehensive validation and error handling
- Security features (duplicate transaction prevention)

---

## API Routes and Endpoints

### 1. Payment Gateway Routes (`src/routes/payment-gateway.routes.ts`)

**Base Path:** `/api/payment-gateways`

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/` | List all payment gateways for tenant | Admin/Super Admin |
| POST | `/` | Create new payment gateway | Admin/Super Admin |
| PUT | `/:id` | Update payment gateway | Admin/Super Admin |
| DELETE | `/:id` | Delete payment gateway | Admin/Super Admin |
| POST | `/:id/default` | Set gateway as default | Admin/Super Admin |
| POST | `/:id/test` | Test gateway connection | Admin/Super Admin |

**Features:**
- Auto-migration from legacy M-Pesa config
- Multiple gateways per tenant (for Hotspot/PPPoE)
- Gateway testing functionality

### 2. Payment Routes (`src/routes/payment.routes.ts`)

**Base Path:** `/api/payments`

#### Authenticated Routes:
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/electronic` | List M-Pesa transactions | Yes (payments:view_electronic) |
| GET | `/mpesa/stats` | Get M-Pesa statistics | Yes (payments:view_electronic) |
| GET | `/manual` | List manual payments | Yes (payments:view_manual) |
| POST | `/manual` | Record manual payment | Yes (payments:view_manual) |
| DELETE | `/manual` | Clear manual payments | Yes (payments:view_manual) |

#### Webhook Routes (No Auth - API Key Based):
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/webhooks/mpesa` | M-Pesa callback webhook | API Key |

**M-Pesa Statistics Include:**
- Today's received amount and transaction count
- This month's received amount and transaction count
- Success rate percentage
- Pending confirmations count
- Last sync timestamp

### 3. Portal Routes (`src/routes/portal.routes.ts`)

**Base Path:** `/api/portal`

Public routes for hotspot portal M-Pesa integration:

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/mpesa/check` | Check if tenant has M-Pesa configured | No |
| GET | `/mpesa/validate` | Validate M-Pesa configuration | No |
| POST | `/mpesa/initiate` | Initiate STK push for package purchase | No |
| GET | `/mpesa/status` | Check payment status by CheckoutRequestID | No |
| POST | `/mpesa/verify-sms` | Verify payment from pasted SMS message | No |
| GET | `/mpesa/callback` | M-Pesa callback URL verification (GET) | No |
| POST | `/mpesa/callback` | M-Pesa webhook callback from Safaricom | No |

**Portal Features:**
- Package listing for hotspot purchases
- STK Push initiation for instant payments
- Payment status polling
- SMS verification (manual payment confirmation)
- Automatic customer creation upon successful payment
- MAC address tracking for session management

---

## Database Schema

### File: `prisma/schema.prisma`

### 1. **Tenant Model** (Legacy M-Pesa fields)
```prisma
model Tenant {
  // Legacy M-Pesa Settings (deprecated in favor of PaymentGateway)
  mpesaConsumerKey     String?
  mpesaConsumerSecret  String?
  mpesaShortcode       String?
  mpesaPasskey         String?
  mpesaCallbackUrl     String?
  mpesaEnv             String?   @default("production")
  
  // Relations
  paymentGateways PaymentGateway[]
}
```

### 2. **PaymentGateway Model** (New Multi-Gateway Support)
```prisma
model PaymentGateway {
  id              String   @id @default(uuid())
  tenantId        String
  tenant          Tenant   @relation(...)
  
  type            String   // "MPESA_API", "MPESA_NO_API"
  subType         String   @default("PAYBILL") // "PAYBILL", "BUYGOODS", "BANK"
  name            String?  // e.g. "Main Paybill"
  shortcode       String
  storeNumber     String?  // For Buy Goods (Head Office)
  accountNumber   String?  // For Bank (Target Account)
  consumerKey     String?
  consumerSecret  String?
  passkey         String?
  env             String   @default("production")
  
  isDefault       Boolean  @default(false)
  forHotspot      Boolean  @default(false)
  forPppoe        Boolean  @default(false)
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

### 3. **Payment Model**
```prisma
model Payment {
  id              String    @id @default(uuid())
  amount          Float
  method          PaymentMethod  // MPESA, CASH, BANK_TRANSFER, CARD, OTHER
  status          PaymentStatus  // PENDING, COMPLETED, FAILED, REFUNDED
  transactionId   String?   // M-Pesa receipt number
  phone           String?
  account         String?
  description     String?
  
  customerId      String?
  customer        Customer?  @relation(...)
  tenantId        String
  tenant          Tenant     @relation(...)
  
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt
}

enum PaymentMethod {
  MPESA
  CASH
  BANK_TRANSFER
  CARD
  OTHER
}

enum PaymentStatus {
  PENDING
  COMPLETED
  FAILED
  REFUNDED
}
```

### 4. **PendingHotspotPayment Model**
```prisma
model PendingHotspotPayment {
  id                  String   @id @default(uuid())
  tenantId            String
  tenant              Tenant   @relation(...)
  
  checkoutRequestId   String   @unique
  phone               String
  amount              Float
  packageId           String
  package             Package  @relation(...)
  macAddress          String?
  nasIp               String?
  
  status              String   @default("PENDING") // PENDING, COMPLETED, FAILED
  transactionCode     String?
  customerId          String?
  
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}
```

---

## Configuration

### File: `src/lib/config.ts`

**Environment Variables for M-Pesa:**

```typescript
mpesa: {
  env: 'MPESA_ENV',                     // 'sandbox' or 'production'
  consumerKey: 'MPESA_CONSUMER_KEY',
  consumerSecret: 'MPESA_CONSUMER_SECRET',
  shortcode: 'MPESA_SHORTCODE',
  passkey: 'MPESA_PASSKEY',
  callbackUrl: 'MPESA_CALLBACK_URL',
  webhookKey: 'MPESA_WEBHOOK_KEY',      // For webhook authentication
}
```

**Required Environment Variables:**
- `MPESA_ENV` - Environment (sandbox/production), default: 'sandbox'
- `MPESA_CONSUMER_KEY` - M-Pesa API consumer key
- `MPESA_CONSUMER_SECRET` - M-Pesa API consumer secret
- `MPESA_SHORTCODE` - M-Pesa business shortcode (PayBill/Till number)
- `MPESA_PASSKEY` - M-Pesa API passkey
- `MPESA_CALLBACK_URL` - Callback URL for M-Pesa notifications
- `MPESA_WEBHOOK_KEY` - Secret key for webhook authentication

---

## Frontend Integration

### File: `captive-portal/script.js`

The captive portal includes M-Pesa integration for hotspot package purchases.

**Key Functions:**

1. **Configuration Check**
   - `checkMpesaConfigured()` - Checks if M-Pesa is configured for tenant
   - Called during portal initialization

2. **Payment Initiation**
   - `initiateMpesaPayment(packageId, phone)` - Initiates STK Push
   - Shows payment modal with status updates
   - Handles user phone input and validation

3. **Payment Status Polling**
   - `pollPaymentStatus(checkoutRequestId)` - Polls for payment completion
   - Updates UI with real-time status
   - Automatically stops polling on success/failure

4. **SMS Verification**
   - `verifySms()` - Verifies payment using pasted M-Pesa SMS
   - Alternative payment confirmation method
   - Extracts transaction code from SMS text

**UI Elements:**
- M-Pesa tab in payment options
- Phone number input field
- Payment status modal
- SMS verification section
- Success/error message displays

---

## Webhook Handlers

### 1. General M-Pesa Webhook (`/api/webhooks/mpesa`)
**File:** `src/routes/payment.routes.ts`

**Purpose:** Handles M-Pesa callbacks for general customer payments

**Authentication:** API Key based (`X-API-Key` header or `key` query parameter)

**Process Flow:**
1. Validates API key against `MPESA_WEBHOOK_KEY` env variable
2. Parses STK callback data
3. Extracts payment metadata (amount, receipt number, phone)
4. Checks for duplicate transactions
5. Finds customer by phone number
6. Creates payment record
7. Updates customer wallet balance
8. Returns acknowledgment to M-Pesa

**Security Features:**
- API key validation
- Duplicate transaction prevention
- Graceful error handling (always returns success to M-Pesa)

### 2. Hotspot M-Pesa Webhook (`/api/portal/mpesa/callback`)
**File:** `src/routes/portal.routes.ts`

**Purpose:** Handles M-Pesa callbacks specifically for hotspot portal purchases

**Authentication:** None (public endpoint, verified by CheckoutRequestID)

**Process Flow:**
1. Receives M-Pesa STK callback
2. Finds pending payment by CheckoutRequestID
3. Validates payment amount matches package price
4. Checks for duplicate receipt numbers (replay attack prevention)
5. Creates hotspot customer automatically
6. Records payment transaction
7. Updates pending payment status
8. Returns acknowledgment to M-Pesa

**Security Features:**
- CheckoutRequestID validation
- Amount verification
- Duplicate receipt prevention
- Automatic customer provisioning

**Special Features:**
- Automatic username/password generation (using transaction code)
- Package expiry calculation
- MAC address tracking
- NAS IP recording

---

## Integration Flow Diagrams

### STK Push Flow (Hotspot Portal)
```
User Selects Package → Enter Phone → Initiate STK Push
     ↓
Backend initiates STK Push via M-Pesa API
     ↓
User receives M-Pesa prompt on phone → User enters PIN
     ↓
M-Pesa processes payment
     ↓
M-Pesa sends callback to backend webhook
     ↓
Backend creates customer account & records payment
     ↓
User receives credentials and can login
```

### SMS Verification Flow (Hotspot Portal)
```
User receives M-Pesa SMS → User copies SMS text
     ↓
User pastes SMS in portal → Click Verify
     ↓
Backend parses SMS to extract transaction code
     ↓
Backend validates transaction is not duplicate
     ↓
Backend creates customer account & records payment
     ↓
User receives credentials and can login
```

---

## API Endpoints Summary

### M-Pesa Integration Endpoints:

**Gateway Management:**
- `GET /api/payment-gateways` - List gateways
- `POST /api/payment-gateways` - Create gateway
- `PUT /api/payment-gateways/:id` - Update gateway
- `DELETE /api/payment-gateways/:id` - Delete gateway
- `POST /api/payment-gateways/:id/test` - Test connection
- `POST /api/payment-gateways/:id/default` - Set as default

**Payment Tracking:**
- `GET /api/payments/electronic` - List M-Pesa transactions
- `GET /api/payments/mpesa/stats` - Get M-Pesa statistics
- `POST /api/webhooks/mpesa` - M-Pesa webhook callback

**Hotspot Portal:**
- `GET /api/portal/mpesa/check` - Check M-Pesa configuration
- `GET /api/portal/mpesa/validate` - Validate configuration
- `POST /api/portal/mpesa/initiate` - Initiate STK Push
- `GET /api/portal/mpesa/status` - Check payment status
- `POST /api/portal/mpesa/verify-sms` - Verify via SMS
- `POST /api/portal/mpesa/callback` - Hotspot webhook

---

## Key Features Summary

1. **Multi-Tenant Support** - Each tenant can have their own M-Pesa configuration
2. **Multiple Gateway Types** - Supports PayBill, BuyGoods, and Bank transfers
3. **Purpose-Specific Gateways** - Different gateways for Hotspot vs PPPoE
4. **Automatic Customer Provisioning** - Hotspot customers created automatically on payment
5. **Duplicate Prevention** - Prevents processing duplicate transactions
6. **Token Caching** - OAuth tokens cached for performance
7. **Sandbox & Production** - Supports both M-Pesa environments
8. **SMS Verification** - Alternative payment confirmation method
9. **Real-time Status** - Payment status polling for user feedback
10. **Security** - API key authentication, amount validation, replay attack prevention

---

## Environment Setup

To enable M-Pesa integration, configure these environment variables in `.env`:

```env
# M-Pesa Configuration
MPESA_ENV=production                    # or 'sandbox'
MPESA_CONSUMER_KEY=your_consumer_key
MPESA_CONSUMER_SECRET=your_consumer_secret
MPESA_SHORTCODE=your_shortcode
MPESA_PASSKEY=your_passkey
MPESA_CALLBACK_URL=https://yourdomain.com/api/portal/mpesa/callback
MPESA_WEBHOOK_KEY=your_secret_webhook_key
```

---

## Files Reference

### Core Implementation:
- `src/services/mpesa.service.ts` - M-Pesa service layer

### API Routes:
- `src/routes/payment-gateway.routes.ts` - Gateway management endpoints
- `src/routes/payment.routes.ts` - Payment tracking & webhook endpoints
- `src/routes/portal.routes.ts` - Hotspot portal M-Pesa endpoints

### Configuration:
- `src/lib/config.ts` - Environment configuration
- `prisma/schema.prisma` - Database schema

### Frontend:
- `captive-portal/script.js` - Captive portal M-Pesa integration
- `captive-portal/login.html` - Portal HTML with M-Pesa UI

### Documentation:
- `API_ENDPOINTS.md` - API documentation

---

## Notes

1. The system has both **legacy** M-Pesa configuration (stored in Tenant model) and **new** multi-gateway support (PaymentGateway model). The legacy configuration is maintained for backward compatibility but new deployments should use the PaymentGateway model which provides better flexibility with multi-gateway and per-purpose support.
2. The gateway routes automatically migrate legacy configurations on first access
3. M-Pesa webhook endpoints always return success to prevent retries
4. Transaction codes from M-Pesa are used as both username and password for hotspot customers
5. The system supports both STK Push (automatic) and SMS verification (manual) payment methods
