# M-Pesa Integration Code Locations - Quick Reference

## Summary
The M-Pesa gateway has been integrated throughout the EasyISP Backend system. Here's a quick reference to all the files containing M-Pesa integration code.

---

## Core Files

### 1. **M-Pesa Service Layer**
📄 **File:** `src/services/mpesa.service.ts` (500 lines)

**What it does:**
- Core M-Pesa API integration
- STK Push initiation and status checking
- OAuth token management with caching
- SMS parsing for transaction verification
- Phone number formatting
- Configuration validation
- Gateway testing

**Key Exports:**
- `initiateSTKPush()` - Start M-Pesa payment
- `querySTKStatus()` - Check payment status
- `getTenantMpesaConfig()` - Get tenant config
- `parseMpesaSms()` - Extract transaction from SMS
- `validateBuyGoodsConfig()` - Validate configuration
- `testGateway()` - Test connection
- `formatPhoneNumber()` - Format phone numbers

---

## API Routes

### 2. **Payment Gateway Management Routes**
📄 **File:** `src/routes/payment-gateway.routes.ts` (153 lines)

**Endpoints:**
- `GET /api/payment-gateways` - List gateways
- `POST /api/payment-gateways` - Create gateway
- `PUT /api/payment-gateways/:id` - Update gateway
- `DELETE /api/payment-gateways/:id` - Delete gateway
- `POST /api/payment-gateways/:id/default` - Set default
- `POST /api/payment-gateways/:id/test` - Test connection

**What it does:**
- CRUD operations for M-Pesa payment gateways
- Multi-gateway support per tenant
- Gateway connection testing
- Auto-migration from legacy config

### 3. **Payment Tracking & Webhook Routes**
📄 **File:** `src/routes/payment.routes.ts` (407 lines)

**Endpoints:**
- `GET /api/payments/electronic` - List M-Pesa transactions
- `GET /api/payments/mpesa/stats` - M-Pesa statistics
- `POST /api/webhooks/mpesa` - M-Pesa callback webhook

**What it does:**
- Transaction listing and filtering
- Payment statistics dashboard
- Webhook handler for M-Pesa callbacks
- Automatic wallet updates
- Customer matching by phone number

### 4. **Hotspot Portal M-Pesa Routes**
📄 **File:** `src/routes/portal.routes.ts` (800+ lines, M-Pesa sections: lines 6-14, 382-758)

**Endpoints:**
- `GET /api/portal/mpesa/check` - Check M-Pesa config
- `GET /api/portal/mpesa/validate` - Validate config
- `POST /api/portal/mpesa/initiate` - Initiate STK Push
- `GET /api/portal/mpesa/status` - Check payment status
- `POST /api/portal/mpesa/verify-sms` - Verify via SMS
- `GET /api/portal/mpesa/callback` - Callback verification
- `POST /api/portal/mpesa/callback` - Callback webhook

**What it does:**
- Public API for hotspot portal
- STK Push payment initiation
- Payment status polling
- SMS verification (manual method)
- Automatic customer creation
- Webhook handling for hotspot payments

---

## Database Schema

### 5. **Database Models**
📄 **File:** `prisma/schema.prisma`

**M-Pesa Related Models:**

1. **Tenant Model** (lines 117-122)
   - Legacy M-Pesa fields (deprecated)
   - `mpesaConsumerKey`, `mpesaConsumerSecret`, `mpesaShortcode`, etc.

2. **PaymentGateway Model** (lines 526-548)
   - New multi-gateway support
   - Supports PayBill, BuyGoods, Bank
   - Per-tenant, per-purpose gateways

3. **Payment Model**
   - Payment method enum includes `MPESA`
   - Stores transaction IDs and phone numbers

4. **PendingHotspotPayment Model** (lines 512-524)
   - Tracks pending STK Push payments
   - Links CheckoutRequestID to customer creation

**Enums:**
- `PaymentMethod` - includes `MPESA` (line 59)
- `PaymentStatus` - PENDING, COMPLETED, FAILED, REFUNDED (lines 53-56)

---

## Configuration

### 6. **Environment Configuration**
📄 **File:** `src/lib/config.ts` (lines 62-71)

**M-Pesa Configuration:**
```typescript
mpesa: {
  env: 'MPESA_ENV',
  consumerKey: 'MPESA_CONSUMER_KEY',
  consumerSecret: 'MPESA_CONSUMER_SECRET',
  shortcode: 'MPESA_SHORTCODE',
  passkey: 'MPESA_PASSKEY',
  callbackUrl: 'MPESA_CALLBACK_URL',
  webhookKey: 'MPESA_WEBHOOK_KEY',
}
```

**Environment Variables Required:**
- `MPESA_ENV` - sandbox or production
- `MPESA_CONSUMER_KEY` - API consumer key
- `MPESA_CONSUMER_SECRET` - API consumer secret
- `MPESA_SHORTCODE` - Business shortcode
- `MPESA_PASSKEY` - API passkey
- `MPESA_CALLBACK_URL` - Callback URL
- `MPESA_WEBHOOK_KEY` - Webhook authentication key

---

## Frontend Integration

### 7. **Captive Portal JavaScript**
📄 **File:** `captive-portal/script.js`

**M-Pesa Related Sections:**
- Line 55: `mpesaTab` element reference
- Line 211: `switchTab()` - Tab switching logic
- Line 281: `checkMpesaConfigured()` - Check M-Pesa availability
- Line 425: `initiateMpesaPayment()` - Initiate STK Push
- Line 465: `pollPaymentStatus()` - Poll for payment completion
- Line 540: `verifySms()` - SMS verification

**What it does:**
- M-Pesa payment tab in portal UI
- STK Push initiation with phone input
- Real-time payment status updates
- SMS verification as backup method
- User feedback and error handling

### 8. **Captive Portal HTML**
📄 **File:** `captive-portal/login.html`

**M-Pesa UI Elements:**
- M-Pesa payment tab button
- Phone number input field
- SMS verification section
- Payment status modal
- Success/error message displays

---

## Documentation

### 9. **API Documentation**
📄 **File:** `API_ENDPOINTS.md` (line 109)

**Documented Endpoints:**
- `POST /api/webhooks/mpesa` - M-Pesa callback

---

## Quick File List

**Backend Code:**
1. `src/services/mpesa.service.ts` - Core service (500 lines)
2. `src/routes/payment-gateway.routes.ts` - Gateway management (153 lines)
3. `src/routes/payment.routes.ts` - Payments & webhooks (407 lines)
4. `src/routes/portal.routes.ts` - Portal endpoints (M-Pesa sections)
5. `src/lib/config.ts` - Configuration (lines 62-71)
6. `prisma/schema.prisma` - Database schema

**Frontend Code:**
7. `captive-portal/script.js` - Portal JavaScript
8. `captive-portal/login.html` - Portal HTML

**Documentation:**
9. `API_ENDPOINTS.md` - API docs
10. `MPESA_INTEGRATION_DOCUMENTATION.md` - Full documentation (this repo)
11. `MPESA_CODE_LOCATIONS.md` - This file

---

## Search Tips

To find M-Pesa code in the repository, search for:
- `mpesa` or `Mpesa` or `MPESA` (case-insensitive)
- `STK` or `stkPush` (for STK Push references)
- `PaymentGateway` (for gateway management)
- `initiateSTKPush` (for payment initiation)
- Function imports from `mpesa.service.ts`

---

## Integration Points Summary

| Component | File | Lines of M-Pesa Code |
|-----------|------|---------------------|
| Core Service | `mpesa.service.ts` | ~500 lines |
| Gateway Routes | `payment-gateway.routes.ts` | ~150 lines |
| Payment Routes | `payment.routes.ts` | ~200 lines |
| Portal Routes | `portal.routes.ts` | ~400 lines |
| Database Schema | `schema.prisma` | ~50 lines |
| Configuration | `config.ts` | ~10 lines |
| Frontend JS | `script.js` | ~200 lines |
| Frontend HTML | `login.html` | ~100 lines |

**Total:** Approximately **1,610 lines** of M-Pesa integration code across the codebase.

---

## Key Features Implemented

✅ Multi-tenant M-Pesa support
✅ Multiple gateway types (PayBill, BuyGoods, Bank)
✅ STK Push payment initiation
✅ Payment status polling
✅ SMS verification (backup method)
✅ Automatic customer provisioning
✅ Webhook handling with security
✅ Token caching for performance
✅ Sandbox and production environments
✅ Transaction deduplication
✅ Real-time payment statistics
✅ Gateway testing functionality

---

For detailed implementation information, see `MPESA_INTEGRATION_DOCUMENTATION.md`.
