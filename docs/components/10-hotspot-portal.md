# Hotspot Captive Portal Module

## Overview

The Hotspot Captive Portal provides public-facing API endpoints for WiFi hotspot users to authenticate, purchase packages, redeem vouchers, and make M-Pesa payments. These endpoints are accessible without authentication and designed to be called from MikroTik captive portal pages.

**Source File**: `/root/easyisp/Backend/src/routes/portal.routes.ts` (850 lines, 28 KB)

---

## What It Does in the System

1. **Package Browsing** - Display available hotspot packages with pricing
2. **Session Checking** - Auto-detect returning users by MAC address
3. **Login/Logout** - Authenticate users and manage sessions
4. **Voucher Redemption** - Activate prepaid voucher codes
5. **Tenant Branding** - Serve logo, colors, and contact info
6. **M-Pesa Integration** - STK Push payments, SMS verification, callbacks
7. **Session Status** - Real-time session info (uptime, data usage)

---

## API Endpoints

### GET `/api/portal/packages`
**Purpose**: List available hotspot packages for purchase

**Auth**: None (public)

**Query Parameters**:
- `tenantId` - Required tenant UUID

**Response** (200):
```json
{
  "packages": [
    {
      "id": "uuid",
      "name": "1 Hour WiFi",
      "price": 50,
      "speed": "10/10 Mbps",
      "duration": "1 hours",
      "data": "1.0 GB"
    },
    {
      "id": "uuid2",
      "name": "Daily WiFi",
      "price": 200,
      "speed": "20/20 Mbps",
      "duration": "1 days",
      "data": "Unlimited"
    }
  ]
}
```

**Notes**:
- Only returns `HOTSPOT` type packages
- Only returns `isActive: true` packages
- Ordered by price ascending

---

### GET `/api/portal/check-session`
**Purpose**: Check if MAC address has an active session (for auto-login)

**Auth**: None (public)

**Query Parameters**:
- `mac` - Customer's MAC address
- `tenantId` - Tenant UUID

**Response** (200) - No active session:
```json
{
  "hasActiveSession": false
}
```

**Response** (200) - Active session found:
```json
{
  "hasActiveSession": true,
  "customer": {
    "username": "QBX123ABC",
    "password": "QBX123ABC",
    "name": "John Doe",
    "packageName": "Daily WiFi",
    "expiresAt": "2026-01-05T12:00:00Z",
    "remainingMinutes": 720
  }
}
```

**How It Works**:
1. Normalizes MAC address (uppercase, colon-separated)
2. Finds customer with matching `lastMac`, connection type `HOTSPOT`, status `ACTIVE`
3. Checks `expiresAt > now()` (not expired)
4. Returns credentials for auto-login

**Security Note**: Returns password for auto-login. This is intentional for seamless hotspot re-connection.

---

### POST `/api/portal/login`
**Purpose**: Authenticate hotspot user

**Auth**: None (public)

**Request Body**:
```json
{
  "username": "john123",
  "password": "secret",
  "nasId": "router-uuid",
  "macAddress": "AA:BB:CC:DD:EE:FF",
  "ip": "10.10.10.50"
}
```

**Response** (200):
```json
{
  "success": true,
  "sessionId": "HS-1704369600000-abc123",
  "customer": {
    "name": "John Doe",
    "package": "Daily WiFi",
    "expiresAt": "2026-01-05T12:00:00Z"
  },
  "quota": {
    "speed": "20/20 Mbps",
    "data": "Unlimited",
    "time": "1 days"
  }
}
```

**What It Does**:
1. Finds customer by username OR phone number
2. Checks status is `ACTIVE`
3. Checks subscription not expired
4. Creates session record in database
5. **TODO**: Password verification not implemented (see line 151)

**Error Cases**:
- 401: Invalid credentials (username not found)
- 403: Account suspended/disabled/expired

---

### POST `/api/portal/logout`
**Purpose**: End hotspot session

**Auth**: None (public)

**Request Body**:
```json
{
  "sessionId": "HS-1704369600000-abc123",
  "username": "john123",
  "macAddress": "AA:BB:CC:DD:EE:FF"
}
```

**Response** (200):
```json
{
  "success": true
}
```

**What It Does**:
1. Finds active session by sessionId, username, or macAddress
2. Sets `stopTime` to now
3. Sets `terminateCause` to "User-Logout"

---

### GET `/api/portal/status`
**Purpose**: Get current session status

**Auth**: None (public)

**Query Parameters**:
- `sessionId` - Session ID
- `mac` - MAC address (alternative)

**Response** (200):
```json
{
  "active": true,
  "sessionId": "HS-1704369600000-abc123",
  "uptime": "2h 30m 15s",
  "uptimeSeconds": 9015,
  "bytesIn": 524288000,
  "bytesOut": 104857600,
  "customer": {
    "name": "John Doe",
    "package": "Daily WiFi"
  }
}
```

---

### POST `/api/portal/voucher`
**Purpose**: Redeem voucher code

**Auth**: None (public)

**Request Body**:
```json
{
  "code": "WIFI-ABCD-1234",
  "macAddress": "AA:BB:CC:DD:EE:FF",
  "nasId": "router-uuid"
}
```

**Response** (200):
```json
{
  "success": true,
  "sessionId": "VCH-1704369600000",
  "package": {
    "name": "1 Hour WiFi",
    "speed": "10/10 Mbps",
    "duration": "1 hours"
  }
}
```

**What It Does**:
1. Finds voucher with status `AVAILABLE`
2. Creates temporary username: `V-{CODE}`
3. Marks voucher as `USED` with timestamp
4. Creates session record

**Error Cases**:
- 404: Invalid or unavailable voucher

---

### GET `/api/portal/tenant`
**Purpose**: Get tenant branding info

**Auth**: None (public)

**Query Parameters**:
- `tenantId` - Tenant UUID
- `nasIp` - Alternative: look up tenant by router IP

**Response** (200):
```json
{
  "id": "uuid",
  "name": "MyISP Network",
  "logo": "https://storage.example.com/logo.png",
  "primaryColor": "#0ea5e9",
  "contact": {
    "phone": "+254700000000",
    "email": "support@myisp.com"
  }
}
```

---

## M-Pesa Hotspot Endpoints

### GET `/api/portal/mpesa/check`
**Purpose**: Check if tenant has M-Pesa configured

**Query**: `tenantId`

**Response**:
```json
{
  "configured": true
}
```

---

### GET `/api/portal/mpesa/validate`
**Purpose**: Validate M-Pesa configuration (BuyGoods/PayBill)

**Query**: `tenantId`

**Response**:
```json
{
  "configured": true,
  "valid": true,
  "configType": "BUYGOODS",
  "errors": [],
  "details": {
    "tillNumber": "7654321",
    "paybillNumber": null,
    "storeNumber": "123***",
    "environment": "production",
    "hasPasskey": true,
    "hasCredentials": true
  }
}
```

---

### POST `/api/portal/mpesa/initiate`
**Purpose**: Initiate M-Pesa STK Push for package purchase

**Request Body**:
```json
{
  "tenantId": "uuid",
  "phone": "0712345678",
  "packageId": "uuid",
  "macAddress": "AA:BB:CC:DD:EE:FF",
  "nasIp": "192.168.1.1"
}
```

**Response** (200):
```json
{
  "success": true,
  "checkoutRequestId": "ws_CO_04012026120000123456",
  "message": "Success. Request accepted for processing"
}
```

**What It Does**:
1. Validates package exists and is active
2. Calls STK Push with package price
3. Creates `PendingHotspotPayment` record with 5-minute expiry
4. Returns checkout ID for polling

---

### GET `/api/portal/mpesa/status`
**Purpose**: Poll payment status by checkout ID

**Query Parameters**:
- `checkoutRequestId` - From initiate response
- `tenantId` - Tenant UUID

**Response States**:

```json
// Completed
{
  "status": "completed",
  "username": "QBX123ABC",
  "password": "QBX123ABC",
  "package": "Daily WiFi"
}

// Pending
{
  "status": "pending"
}

// Failed
{
  "status": "failed",
  "message": "Request cancelled by user"
}

// Expired (5 minutes timeout)
{
  "status": "expired"
}
```

**What It Does**:
1. Checks database for pending payment
2. If already completed, returns credentials
3. If expired, marks as `EXPIRED`
4. Queries M-Pesa API for status (fallback if callback not received)
5. If M-Pesa shows success, creates customer and returns credentials

---

### POST `/api/portal/mpesa/verify-sms`
**Purpose**: Verify payment by pasting M-Pesa SMS

**Request Body**:
```json
{
  "tenantId": "uuid",
  "smsText": "QBX123ABC Confirmed. Ksh500.00 paid to MyISP...",
  "packageId": "uuid",
  "macAddress": "AA:BB:CC:DD:EE:FF",
  "nasIp": "192.168.1.1"
}
```

**Response** (200):
```json
{
  "success": true,
  "username": "QBX123ABC",
  "password": "QBX123ABC",
  "expiresAt": "2026-01-05T12:00:00Z",
  "package": "Daily WiFi"
}
```

**What It Does**:
1. Parses M-Pesa SMS to extract transaction code and amount
2. Checks transaction code not already used (duplicate prevention)
3. Validates amount >= package price
4. Creates hotspot customer with transaction code as username/password

---

### POST `/api/portal/mpesa/callback`
**Purpose**: M-Pesa webhook callback (called by Safaricom)

**Request Body**: Standard M-Pesa STK callback format

**What It Does**:
1. Extracts `CheckoutRequestID`, `ResultCode`, `CallbackMetadata`
2. Finds pending payment by checkout ID
3. If `ResultCode !== 0`, marks as `FAILED`
4. **Security Checks**:
   - Duplicate receipt detection (replay attack prevention)
   - Amount validation (must be >= package price)
5. Creates hotspot customer via `createHotspotCustomerFromPayment()`
6. Updates pending payment with transaction code and customer ID

**Security Logging**:
```typescript
// Lines 756-766: Duplicate receipt check
const existingPayment = await prisma.payment.findFirst({
    where: { transactionId: mpesaReceiptNumber },
});
if (existingPayment) {
    logger.warn({...}, 'Duplicate M-Pesa receipt detected - possible replay attack');
    return;
}

// Lines 770-784: Amount validation
if (amount < pendingPayment.package.price) {
    logger.error({...}, 'Payment amount less than package price - rejecting');
    await prisma.pendingHotspotPayment.update({...status: 'FAILED'});
    return;
}
```

---

## What's Complete ✅

1. ✅ Package listing with formatting
2. ✅ MAC-based session detection (auto-login)
3. ✅ Login with session creation
4. ✅ Logout with session closure
5. ✅ Session status with uptime/data
6. ✅ Voucher redemption
7. ✅ Tenant branding lookup (by ID or NAS IP)
8. ✅ M-Pesa config check and validation
9. ✅ M-Pesa STK Push initiation
10. ✅ M-Pesa status polling (with fallback)
11. ✅ M-Pesa SMS verification
12. ✅ **M-Pesa callback handler** ✅ (was marked incomplete!)
13. ✅ Duplicate payment detection
14. ✅ Amount validation
15. ✅ Customer creation from payment

---

## What's NOT Complete ⚠️

1. ⚠️ **Password Verification** - Line 151: `// TODO: Verify password`
   - Login currently doesn't verify password
   - Should use bcrypt comparison

2. ⚠️ **CAPTCHA** - No bot protection on public endpoints

3. ⚠️ **Rate Limiting** - No limits on login attempts, payment initiations

4. ⚠️ **IP Validation** - Callbacks not validated by source IP

5. ⚠️ **Social Login** - No Facebook/Google authentication

6. ⚠️ **QR Code Payments** - No QR-based payment option

7. ⚠️ **Usage Analytics** - No tracking of portal conversions

---

## What's Working ✅

All implemented features are fully functional:
- Package browsing ✓
- Auto-login by MAC ✓
- Voucher redemption ✓
- M-Pesa STK Push ✓
- M-Pesa callback processing ✓
- Customer creation from payment ✓

---

## What's NOT Working ❌

1. **Password Verification on Login**
   - Users can login with any password
   - **Fix Required**:
   ```typescript
   // Line 151
   if (customer.password !== password) {
       throw new AppError(401, 'Invalid credentials');
   }
   ```

---

## Security Issues 🔐

### Critical

1. **No Password Verification**
   - **Location**: POST `/api/portal/login`, line 151
   - **Risk**: Anyone can login as any user without password
   - **Impact**: Complete authentication bypass
   - **Mitigation**: Implement password check

2. **Password Returned in check-session**
   - **Location**: GET `/api/portal/check-session`, line 104
   - **Risk**: Password exposed in API response
   - **Impact**: Credential theft
   - **Mitigation**: Don't return password, use session tokens

### Medium

3. **No Rate Limiting**
   - **Risk**: Brute force attacks, payment spam
   - **Impact**: Account enumeration, DoS
   - **Mitigation**: Add rate limiter (5 requests/min per IP)

4. **Callback IP Not Validated**
   - **Risk**: Fake callbacks from non-Safaricom IPs
   - **Impact**: Free internet by faking successful payments
   - **Mitigation**: Whitelist Safaricom IP ranges

### Low

5. **Session ID Predictable**
   - `HS-${Date.now()}-${random}`
   - Partially predictable from timestamp
   - **Mitigation**: Use UUID

---

## Possible Improvements 🚀

### High Priority

1. **Implement Password Verification**
   ```typescript
   // In POST /api/portal/login
   import bcrypt from 'bcryptjs';
   
   const isValid = await bcrypt.compare(password, customer.passwordHash);
   if (!isValid) {
       throw new AppError(401, 'Invalid credentials');
   }
   ```

2. **Add Rate Limiting**
   ```typescript
   import { RateLimiterMemory } from 'rate-limiter-flexible';
   
   const portalLimiter = new RateLimiterMemory({
       points: 10,    // 10 requests
       duration: 60,  // per minute
   });
   
   portalRoutes.use('*', async (c, next) => {
       const ip = c.req.header('x-forwarded-for') || 'unknown';
       try {
           await portalLimiter.consume(ip);
       } catch {
           throw new AppError(429, 'Too many requests');
       }
       await next();
   });
   ```

3. **Validate Safaricom IPs**
   ```typescript
   const SAFARICOM_IPS = [
       '196.201.214.0/24',
       '196.201.212.0/24',
       // ... more ranges
   ];
   
   portalRoutes.post('/mpesa/callback', async (c) => {
       const sourceIp = c.req.header('x-forwarded-for');
       if (!isInSafaricomRange(sourceIp)) {
           logger.warn({ sourceIp }, 'Callback from non-Safaricom IP');
           return c.json({ ResultCode: 0 });
       }
       // ... process callback
   });
   ```

### Medium Priority

4. **CAPTCHA on Payments**
   - Add reCAPTCHA or hCaptcha before STK Push

5. **Session Tokens Instead of Passwords**
   - Generate JWT on login
   - Use token for session checks

6. **Usage Analytics**
   - Track package views, conversions, abandonment

---

## Helper Functions

```typescript
// Format duration (minutes to readable)
function formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes} min`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)} hours`;
    return `${Math.floor(minutes / 1440)} days`;
}

// Format bytes to readable
function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Format uptime (seconds to readable)
function formatUptime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours}h ${minutes}m ${secs}s`;
}
```

---

## Related Modules

- **Package Management** - Package data displayed
- **Voucher System** - Voucher redemption
- **Payment & M-Pesa** - Payment processing service
- **Customer Management** - Customer creation
- **Session Management** - Session tracking
- **Tenant Settings** - Branding data

---

## Testing Recommendations

1. **Unit Tests**
   - MAC address normalization
   - Duration/bytes formatting
   - SMS parsing

2. **Integration Tests**
   - Full STK Push → callback → customer creation flow
   - Voucher redemption flow
   - Session check with various MAC formats

3. **Security Tests**
   - Attempt login without password (should fail after fix)
   - Duplicate receipt rejection
   - Expired payment handling

---

## Migration Path

1. **Immediate** (Week 1):
   - Implement password verification
   - Add rate limiting
   - Stop returning passwords in responses

2. **Short-term** (Month 1):
   - Add CAPTCHA on payments
   - Validate Safaricom callback IPs
   - Implement session tokens

3. **Long-term** (Quarter 1):
   - Add social login
   - Implement usage analytics
   - Add QR code payments
