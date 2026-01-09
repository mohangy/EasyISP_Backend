# Voucher System Module

## Overview

The Voucher System enables ISPs to sell prepaid internet access codes for hotspot services. Customers purchase vouchers (scratch cards or digital codes) to access WiFi without creating permanent accounts. This is ideal for guest networks, cafes, hotels, and mobile internet services.

---

## What It Does in the System

### Core Functionality

1. **Voucher Generation**
   - Bulk generation of unique codes (up to 500 at once)
   - Customizable code prefixes (e.g., "WIFI-", "ISP-")
   - Configurable code length (6-16 characters)
   - Automatic duplicate prevention
   - Batch tracking for organization

2. **Voucher Lifecycle**
   - Four states: `AVAILABLE`, `USED`, `EXPIRED`, `REVOKED`
   - Expiry date support
   - Usage tracking (who used, when)
   - Revocation capability (invalidate unused vouchers)

3. **Package Integration**
   - Each voucher linked to a service package
   - Inherits speed, data limit, and session time from package
   - Voucher price = package price

4. **Redemption System**
   - Public redemption endpoint (no auth required)
   - Creates customer account on redemption
   - Auto-activates customer with package
   - Sets expiry based on package session time

5. **Management & Analytics**
   - List vouchers with filtering
   - Search by code
   - Statistics (available, used, expired, revoked)
   - Track which customer used each voucher

---

## API Endpoints

### GET `/api/vouchers`
**Purpose**: List all vouchers with pagination and stats

**Auth**: Required  
**Permissions**: `hotspot:view`

**Query Parameters**:
- `page` (default: 1)
- `pageSize` (default: 20)
- `status` - Filter by status (available, used, expired, revoked)
- `packageId` - Filter by package UUID
- `search` - Search voucher codes (case-insensitive)

**Response** (200):
```json
{
  "vouchers": [
    {
      "id": "uuid",
      "code": "ISP-A1B2C3D4",
      "status": "available",
      "package": {
        "id": "uuid",
        "name": "5 Mbps - 1GB",
        "price": 100
      },
      "usedBy": null,
      "usedAt": null,
      "expiresAt": "2026-12-31T23:59:59Z",
      "createdAt": "2026-01-01T00:00:00Z"
    },
    {
      "id": "uuid2",
      "code": "ISP-E5F6G7H8",
      "status": "used",
      "package": {
        "id": "uuid",
        "name": "5 Mbps - 1GB",
        "price": 100
      },
      "usedBy": {
        "id": "customer-uuid",
        "name": "John Doe"
      },
      "usedAt": "2026-01-02T10:30:00Z",
      "expiresAt": null,
      "createdAt": "2026-01-01T00:00:00Z"
    }
  ],
  "stats": {
    "total": 1000,
    "available": 750,
    "used": 200,
    "expired": 30,
    "revoked": 20
  },
  "total": 1000,
  "page": 1,
  "pageSize": 20
}
```

---

### POST `/api/vouchers`
**Purpose**: Generate batch of vouchers

**Auth**: Required  
**Permissions**: `hotspot:add_user`

**Request Body**:
```json
{
  "packageId": "uuid",
  "quantity": 100,
  "prefix": "WIFI-",
  "codeLength": 8
}
```

**Validation**:
- `quantity`: 1-500
- `codeLength`: 6-16 characters
- `prefix`: Max 10 characters

**Response** (201):
```json
{
  "success": true,
  "count": 100,
  "codes": [
    "WIFI-A1B2C3D4",
    "WIFI-E5F6G7H8",
    ...
    // First 50 codes returned
  ],
  "package": {
    "id": "uuid",
    "name": "5 Mbps - 1GB",
    "price": 100
  }
}
```

**What Happens**:
1. Validates package exists in tenant
2. Fetches all existing voucher codes to prevent duplicates
3. Generates random hex codes with prefix
4. Creates all vouchers in single batch insert
5. Creates audit log entry
6. Returns first 50 codes (full list queryable via GET)

**Code Generation Logic**:
```typescript
// Example: prefix="WIFI-", codeLength=8
// Generates: WIFI-A1B2C3D4

const randomPart = randomBytes(Math.ceil(codeLength / 2))
  .toString('hex')
  .toUpperCase()
  .slice(0, codeLength);
const code = `${prefix}${randomPart}`;
```

---

### DELETE `/api/vouchers/:id`
**Purpose**: Revoke (invalidate) an unused voucher

**Auth**: Required  
**Permissions**: `hotspot:delete`

**Response** (200):
```json
{
  "success": true
}
```

**Business Rules**:
- Cannot revoke `USED` vouchers
- Sets status to `REVOKED`
- Creates audit log

**Error** (400) if voucher is already used:
```json
{
  "error": "Cannot revoke a used voucher"
}
```

---

### POST `/api/vouchers/redeem`
**Purpose**: Redeem voucher and activate customer (PUBLIC endpoint)

**Auth**: NOT required (public endpoint for captive portal)

**Request Body**:
```json
{
  "code": "WIFI-A1B2C3D4",
  "customerId": "uuid"  // Optional: existing customer
}
```

**Response** (200):
```json
{
  "success": true,
  "package": {
    "id": "uuid",
    "name": "5 Mbps - 1GB",
    "price": 100,
    "downloadSpeed": 5,
    "uploadSpeed": 5,
    "dataLimit": 1073741824,
    "sessionTime": 1440
  },
  "validFor": "1440 minutes"
}
```

**What Happens**:
1. Searches for voucher with `code` and status `AVAILABLE`
2. Checks if voucher has expired (if `expiresAt` set)
3. Marks voucher as `USED`
4. Sets `usedAt` to current timestamp
5. If `customerId` provided: Updates customer's package and expiry
6. If no `customerId`: Customer creation happens elsewhere
7. Returns package details

**Error Cases**:
- Code not found: `404 Invalid or unavailable voucher`
- Code expired: `400 Voucher has expired`
- Code already used: `404 Invalid or unavailable voucher` (because status != AVAILABLE)

---

## What's Complete ✅

1. ✅ Bulk voucher generation (up to 500 per batch)
2. ✅ Customizable prefixes and code lengths
3. ✅ Duplicate code prevention
4. ✅ Four voucher states (available, used, expired, revoked)
5. ✅ Package linking
6. ✅ Voucher redemption system
7. ✅ Expiry date support
8. ✅ Usage tracking (customer + timestamp)
9. ✅ Search and filtering
10. ✅ Statistics (count by status)
11. ✅ Revocation capability
12. ✅ Audit logging for generation and deletion
13. ✅ Pagination

---

## What's NOT Complete ⚠️

1. ⚠️ **Batch Management**: No concept of voucher batches (e.g., "Batch JAN2026")
2. ⚠️ **Printing**: No voucher card/PDF generation for physical cards
3. ⚠️ **Bulk Delete**: Cannot delete multiple vouchers at once
4. ⚠️ **Bulk Expiry Setting**: No way to set expiry for batch of vouchers
5. ⚠️ **Reseller System**: No multi-tier reseller/distributor support
6. ⚠️ **Voucher Transfer**: Cannot transfer vouchers between tenants
7. ⚠️ **Auto-Expiry Cleanup**: No cron job to automatically expire old vouchers
8. ⚠️ **Voucher Pricing**: All vouchers use package price (no markup/discount)
9. ⚠️ **QR Codes**: No QR code generation for easy mobile scanning
10. ⚠️ **Serial Numbers**: No sequential serial numbering

---

## What's Working ✅

All implemented features are functional:
- Voucher generation with duplicate prevention
- Listing with filters and search
- Redemption flow
- Revocation
- Statistics calculation

---

## What's NOT Working ❌

1. **Batch Tracking Incomplete**
   - `batchId` field exists in schema but not populated
   - No UI to view vouchers by batch

2. **Expiry Not Enforced on Redemption**
   - Manual check in code, but no automatic background job
   - Expired vouchers stay as `AVAILABLE` until redeemed

---

## Security Issues 🔐

### Critical

1. **Public Redemption Endpoint**
   - **Risk**: `/api/vouchers/redeem` is public (no auth)
   - **Impact**: Anyone can brute-force voucher codes
   - **Mitigation**: Add rate limiting (e.g., 5 attempts per IP per minute)

2. **No CAPTCHA on Redemption**
   - **Risk**: Bots can automate code guessing
   - **Impact**: Voucher theft, service abuse
   - **Mitigation**: Add CAPTCHA or proof-of-work challenge

3. **Sequential Code Generation**
   - **Risk**: Codes are random hex but potentially guessable
   - **Impact**: Attackers could predict valid codes
   - **Mitigation**: Use cryptographically secure random generator (already using `crypto.randomBytes` ✅)

### Medium

4. **No Code Expiry Enforcement**
   - **Risk**: Expired vouchers can still be redeemed (checked but not auto-updated)
   - **Impact**: ISP loses revenue on expired stock
   - **Mitigation**: Background job to mark expired vouchers

5. **Large Batch Generation**
   - **Risk**: Can generate 500 vouchers at once
   - **Impact**: Memory usage spike, slow response
   - **Mitigation**: Queue-based generation for batches >100

6. **Voucher Code Enumeration**
   - **Risk**: Search endpoint reveals code patterns
   - **Impact**: Easier to guess valid codes
   - **Mitigation**: Restrict search to admin roles only

### Low

7. **No Voucher PIN**
   - **Risk**: Code alone grants access
   - **Impact**: If code is observed/stolen, instant access
   - **Mitigation**: Add optional PIN field (code + PIN required)

---

## Possible Improvements 🚀

### High Priority

1. **Rate Limiting on Redemption**
   ```typescript
   import { RateLimiterMemory } from 'rate-limiter-flexible';
   
   const rateLimiter = new RateLimiterMemory({
     points: 5,  // 5 attempts
     duration: 60,  // per 60 seconds
   });
   
   // In redemption endpoint:
   await rateLimiter.consume(clientIp);
   ```

2. **Batch Management**
   ```typescript
   POST /api/vouchers/batches
   GET /api/vouchers/batches
   GET /api/vouchers/batches/:id/vouchers
   
   // Associate vouchers with named batches
   {
     batchId: "auto-generated-uuid",
     batchName: "January 2026 - Cafe WiFi",
     createdAt: "2026-01-01",
     totalCodes: 500,
     used: 120,
     available: 380
   }
   ```

3. **Voucher Printing Templates**
   ```typescript
   GET /api/vouchers/batches/:id/print?format=pdf
   
   // Generate PDF with:
   // - Voucher code in large text
   // - QR code for mobile scanning
   // - Package details
   // - Expiry date
   // - ISP branding (logo, colors)
   // - Terms & conditions
   ```

4. **Auto-Expiry Cron Job**
   ```typescript
   // Every hour:
   const expired = await prisma.voucher.updateMany({
     where: {
       status: 'AVAILABLE',
       expiresAt: { lt: new Date() }
     },
     data: { status: 'EXPIRED' }
   });
   ```

### Medium Priority

5. **QR Code Generation**
   ```typescript
   import QRCode from 'qrcode';
   
   GET /api/vouchers/:id/qrcode
   
   // Returns PNG image with QR code containing:
   // {
   //   code: "WIFI-A1B2C3D4",
   //   tenantId: "uuid",
   //   portalUrl: "https://isp.com/portal"
   // }
   ```

6. **Reseller/Distributor System**
   ```typescript
   // Multi-tier voucher distribution
   {
     resellers: [
       {
         id: "uuid",
         name: "Cafe Downtown",
         vouchersAssigned: 500,
         vouchersUsed: 350,
         commission: 0.15  // 15%
       }
     ]
   }
   ```

7. **Voucher Pricing Tiers**
   ```typescript
   {
     packagePrice: 100,
     voucherPrice: 120,  // 20% markup
     resellerPrice: 105,  // 5% markup for resellers
     wholesalePrice: 95   // 5% discount for bulk
   }
   ```

8. **Bulk Operations**
   ```typescript
   POST /api/vouchers/bulk-delete
   PUT /api/vouchers/bulk-expire
   PUT /api/vouchers/bulk-revoke
   
   // Request:
   {
     voucherIds: ["uuid1", "uuid2", ...],
     action: "revoke"
   }
   ```

### Low Priority

9. **Voucher PINs**
   ```typescript
   {
     code: "WIFI-A1B2C3D4",
     pin: "1234"  // 4-digit PIN
   }
   ```

10. **Sequential Serial Numbers**
    ```typescript
    {
      code: "WIFI-A1B2C3D4",
      serialNumber: "000001",  // For tracking/auditing
      batchId: "batch-uuid"
    }
    ```

11. **Usage Limits**
    ```typescript
    {
      code: "WIFI-A1B2C3D4",
      maxRedemptions: 5,  // Allow 5 devices
      currentRedemptions: 2
    }
    ```

12. **Voucher Export**
    ```typescript
    GET /api/vouchers/export?format=csv
    
    // CSV columns:
    // Code, Status, Package, Created, Used By, Used At, Expires At
    ```

---

## Performance Considerations

### Database Indexing

Current indexes (from schema):
```prisma
@@unique([code, tenantId])
@@index([tenantId])
@@index([tenantId, status])
@@index([batchId])
```

**Recommended additions:**
```prisma
@@index([tenantId, packageId])  // Filter by package
@@index([status, expiresAt])     // Find expired vouchers
```

### Optimization Tips

1. **Large Batch Generation**:
   - For >100 vouchers, use background queue
   - Return job ID, poll for completion
   
2. **Duplicate Checking**:
   - Current: Fetches ALL existing codes into memory
   - Better: Use database unique constraint, retry on conflict

3. **Statistics Calculation**:
   - Cache stats in Redis (5-minute TTL)
   - Invalidate on voucher state changes

---

## Related Modules

- **Package Management**: Vouchers linked to packages
- **Customer Management**: Redemption creates/updates customers
- **Hotspot Portal**: Customers redeem vouchers via portal
- **Finance Module**: Track voucher sales revenue
- **SMS Gateway**: Send voucher codes via SMS
- **Audit Logging**: Track generation and redemption events

---

## Common Use Cases

### 1. Cafe WiFi
```typescript
// Generate 500 daily vouchers
POST /api/vouchers
{
  packageId: "1-hour-package",
  quantity: 500,
  prefix: "CAFE-",
  codeLength: 8
}

// Print batch as cards
GET /api/vouchers/batches/:id/print?format=pdf
```

### 2. Hotel Guest Access
```typescript
// Generate room-specific codes
POST /api/vouchers
{
  packageId: "hotel-24h-package",
  quantity: 50,
  prefix: "ROOM-",
  codeLength: 6
}
```

### 3. Mobile Data Bundles
```typescript
// Generate data vouchers
POST /api/vouchers
{
  packageId: "5gb-monthly",
  quantity: 1000,
  prefix: "5GB-",
  codeLength: 10
}
```

---

## Testing Recommendations

1. **Unit Tests**
   - Code generation uniqueness
   - Duplicate prevention logic
   - Expiry validation

2. **Integration Tests**
   - Generate batch → verify in DB
   - Redeem voucher → verify customer updated
   - Revoke voucher → verify status changed
   - Redeem expired voucher → expect error

3. **Load Tests**
   - Generate 500 vouchers concurrently
   - Redeem 1000 vouchers/second
   - Search with 100k vouchers in DB

4. **Security Tests**
   - Brute force redemption endpoint
   - Code guessing attacks
   - SQL injection in search

---

## Migration Path

1. **Immediate** (Week 1):
   - Add rate limiting to redemption endpoint
   - Implement auto-expiry cron job
   - Add CAPTCHA to portal redemption

2. **Short-term** (Month 1):
   - Build batch management UI
   - Create voucher printing templates
   - Add QR code generation

3. **Long-term** (Quarter 1):
   - Implement reseller system
   - Add voucher pricing tiers
   - Build bulk operations UI
   - Create voucher export functionality
