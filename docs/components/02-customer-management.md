# Customer Management Module

## Overview

The Customer Management module is the core of the EasyISP system, handling all end-user accounts for both PPPoE (fixed broadband) and Hotspot (WiFi voucher) internet services. It provides comprehensive CRUD operations, status management, wallet functionality, and integration with packages, sessions, and routers.

---

## What It Does in the System

### Core Functionality

1. **Customer Lifecycle Management**
   - Create, Read, Update, Delete customers
   - Support for multiple connection types (PPPoE, Hotspot, DHCP, Static IP)
   - Soft delete capability (deleted customers marked, not removed)
   - Status management (ACTIVE, SUSPENDED, EXPIRED, DISABLED)

2. **Account Types & Configuration**
   - **PPPoE Customers**: Fixed broadband with username/password authentication
   - **Hotspot Customers**: WiFi access via vouchers or MAC authentication
   - **DHCP Customers**: Dynamic IP assignment
   - **Static IP Customers**: Fixed IP address assignment

3. **Package Assignment**
   - Link customers to service packages
   - Automatic speed limit inheritance from package
   - Data quota and session time limits
   - Package change functionality

4. **Financial Management**
   - Per-customer wallet balance
   - Total spent tracking
   - Recharge wallet functionality
   - Payment history

5. **Geolocation & Mapping**
   - Store customer location (latitude/longitude)
   - Apartment and house number tracking
   - Address/location field
   - Integration with map module for field technicians

6. **Session Tracking**
   - Last IP address tracking
   - Last MAC address tracking
   - Real-time online/offline status
   - Active session monitoring

7. **Expiry Management**
   - Automatic expiration dates
   - Manual expiry date modification
   - Auto-suspend on expiration
   - Renewal workflows

---

## API Endpoints

### GET `/api/customers`
**Purpose**: List all customers with pagination and filtering

**Auth**: Required  
**Permissions**: Default (all roles)

**Query Parameters**:
- `page` (default: 1)
- `pageSize` (default: 20)
- `search` - Search by username, name, or phone
- `status` - Filter by status (active, suspended, expired, disabled)
- `connectionType` - Filter by type (pppoe, hotspot, dhcp, static)
- `packageId` - Filter by package

**Response** (200):
```json
{
  "customers": [
    {
      "id": "uuid",
      "username": "customer001",
      "name": "John Doe",
      "email": "john@example.com",
      "phone": "+254700000000",
      "connectionType": "PPPOE",
      "status": "active",
      "expiresAt": "2026-02-01T00:00:00Z",
      "location": "Nairobi, Kenya",
      "walletBalance": 500.00,
      "package": {
        "id": "uuid",
        "name": "10 Mbps Home",
        "price": 2000
      },
      "router": {
        "id": "uuid",
        "name": "Router 1",
        "ipAddress": "192.168.1.1"
      },
      "createdAt": "2025-01-01T00:00:00Z"
    }
  ],
  "total": 150,
  "page": 1,
  "pageSize": 20
}
```

---

### GET `/api/customers/:id`
**Purpose**: Get detailed customer information

**Auth**: Required  
**Response** (200):
```json
{
  "id": "uuid",
  "username": "customer001",
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+254700000000",
  "connectionType": "PPPOE",
  "status": "active",
  "expiresAt": "2026-02-01T00:00:00Z",
  "location": "Nairobi, Kenya",
  "latitude": -1.286389,
  "longitude": 36.817223,
  "apartmentNumber": "A12",
  "houseNumber": "123",
  "lastIp": "10.5.50.100",
  "lastMac": "00:11:22:33:44:55",
  "walletBalance": 500.00,
  "totalSpent": 12000.00,
  "package": {
    "id": "uuid",
    "name": "10 Mbps Home",
    "price": 2000,
    "downloadSpeed": 10,
    "uploadSpeed": 10,
    "dataLimit": null
  },
  "router": {
    "id": "uuid",
    "name": "Router 1",
    "ipAddress": "192.168.1.1"
  },
  "createdAt": "2025-01-01T00:00:00Z"
}
```

---

### POST `/api/customers`
**Purpose**: Create new customer

**Auth**: Required  
**Permissions**: `pppoe:add_user`

**Request Body**:
```json
{
  "username": "customer001",
  "password": "securepass",
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+254700000000",
  "connectionType": "PPPOE",
  "packageId": "uuid",
  "nasId": "uuid",
  "expiresAt": "2026-02-01T00:00:00Z",
  "location": "Nairobi, Kenya",
  "latitude": -1.286389,
  "longitude": 36.817223,
  "apartmentNumber": "A12",
  "houseNumber": "123"
}
```

**Response** (201):
```json
{
  "id": "uuid",
  "username": "customer001",
  "name": "John Doe",
  ...
}
```

**What Happens**:
1. Validates username is unique within tenant
2. Hashes password with bcrypt
3. Creates customer record
4. Creates audit log entry
5. Returns created customer

---

### PUT `/api/customers/:id`
**Purpose**: Update customer details

**Auth**: Required  
**Permissions**: `pppoe:edit`

**Request Body**: Same as create (all fields optional)

**Response** (200): Updated customer object

**Audit Logging**:
- Tracks which fields changed
- Logs old → new values
- Records user who made changes

---

### DELETE `/api/customers/:id`
**Purpose**: Soft delete customer

**Auth**: Required  
**Permissions**: `pppoe:delete`

**Response** (200):
```json
{
  "success": true
}
```

**What Happens**:
1. Marks customer as deleted (sets `deletedAt` timestamp)
2. Customer data retained for auditing
3. Excluded from normal queries
4. Can be restored by setting `deletedAt` to null

---

### GET `/api/customers/:id/live-status`
**Purpose**: Get real-time customer online/offline status

**Auth**: Required

**Response** (200):
```json
{
  "isOnline": true,
  "session": {
    "id": "uuid",
    "sessionId": "RADIUS-SESSION-123",
    "startTime": "2026-01-04T10:00:00Z",
    "inputOctets": 1048576000,
    "outputOctets": 5242880000,
    "sessionTime": 3600,
    "framedIp": "10.5.50.100",
    "macAddress": "00:11:22:33:44:55"
  },
  "lastSeen": "5 minutes ago"
}
```

**Logic**:
- Queries `Session` table for active session
- Active = `stopTime` is null
- Calculates time since last seen

---

### GET `/api/customers/:id/sessions`
**Purpose**: Get customer session history

**Auth**: Required

**Query Parameters**:
- `page` (default: 1)
- `pageSize` (default: 20)

**Response** (200):
```json
{
  "sessions": [
    {
      "id": "uuid",
      "sessionId": "RADIUS-123",
      "startTime": "2026-01-04T10:00:00Z",
      "stopTime": "2026-01-04T14:30:00Z",
      "duration": "4h 30m",
      "inputOctets": 1048576000,
      "outputOctets": 5242880000,
      "dataUsed": "6.29 GB",
      "framedIp": "10.5.50.100",
      "terminateCause": "User-Request"
    }
  ],
  "total": 45,
  "page": 1,
  "pageSize": 20
}
```

---

### GET `/api/customers/:id/payments`
**Purpose**: Get customer payment history

**Auth**: Required

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
      "description": "Monthly subscription",
      "createdAt": "2026-01-01T00:00:00Z"
    }
  ],
  "total": 12,
  "totalPaid": 24000
}
```

---

### POST `/api/customers/:id/recharge`
**Purpose**: Add funds to customer wallet

**Auth**: Required  
**Permissions**: `finance:income_create`

**Request Body**:
```json
{
  "amount": 500,
  "description": "Wallet top-up"
}
```

**Response** (200):
```json
{
  "success": true,
  "newBalance": 1000
}
```

**What Happens**:
1. Adds amount to `walletBalance`
2. Creates payment record
3. Creates audit log
4. Returns new balance

---

### PUT `/api/customers/:id/expiry`
**Purpose**: Manually set customer expiry date

**Auth**: Required  
**Permissions**: `pppoe:edit`

**Request Body**:
```json
{
  "expiresAt": "2026-03-01T00:00:00Z"
}
```

**Response** (200):
```json
{
  "success": true,
  "expiresAt": "2026-03-01T00:00:00Z"
}
```

---

### PUT `/api/customers/:id/package`
**Purpose**: Change customer package

**Auth**: Required  
**Permissions**: `pppoe:edit`

**Request Body**:
```json
{
  "packageId": "new-package-uuid"
}
```

**Response** (200):
```json
{
  "success": true,
  "package": {
    "id": "uuid",
    "name": "20 Mbps Business"
  }
}
```

**What Happens**:
1. Updates `packageId`
2. Creates audit log with old → new package names
3. May trigger speed limit updates on router

---

### PUT `/api/customers/:id/suspend`
**Purpose**: Suspend customer account

**Auth**: Required  
**Permissions**: `pppoe:edit`

**Response** (200):
```json
{
  "success": true,
  "status": "suspended"
}
```

**What Happens**:
1. Sets status to `SUSPENDED`
2. May disconnect active session
3. Creates audit log

---

### PUT `/api/customers/:id/activate`
**Purpose**: Activate suspended customer

**Auth**: Required  
**Permissions**: `pppoe:edit`

**Response** (200):
```json
{
  "success": true,
  "status": "active"
}
```

---

## What's Complete ✅

1. ✅ Full CRUD operations (Create, Read, Update, Delete)
2. ✅ Multi-connection type support (PPPoE, Hotspot, DHCP, Static)
3. ✅ Package assignment and package change
4. ✅ Status management (active, suspended, expired, disabled)
5. ✅ Soft delete functionality
6. ✅ Pagination and search
7. ✅ Geolocation tracking (latitude/longitude)
8. ✅ Wallet balance management
9. ✅ Total spent tracking
10. ✅ Session history retrieval
11. ✅ Payment history retrieval
12. ✅ Real-time online/offline status
13. ✅ Last IP/MAC tracking
14. ✅ Expiry date management
15. ✅ Manual suspend/activate
16. ✅ Comprehensive audit logging
17. ✅ Recharge wallet functionality

---

## What's NOT Complete ⚠️

1. ⚠️ **Bulk Operations**: No bulk import/export of customers
2. ⚠️ **Automatic Suspension**: No cron job to auto-suspend expired customers
3. ⚠️ **Auto-Renewal**: No automatic package renewal
4. ⚠️ **Family/Group Accounts**: No parent-child customer relationships
5. ⚠️ **Customer Portal**: No self-service portal for customers
6. ⚠️ **Usage Alerts**: No notifications when data limit is reached
7. ⚠️ **Referral System**: No customer referral tracking
8. ⚠️ **Credit Limit**: No credit/postpaid billing support
9. ⚠️ **MAC Whitelist Management**: No UI for MAC address approval
10. ⚠️ **Speed Test Integration**: No built-in speed test for customers

---

## What's Working ✅

All API endpoints are functional:
- Customer listing with filters
- Customer creation with validation
- Customer updates with audit trail
- Soft delete
- Live status checking
- Session and payment history
- Wallet recharge
- Package changes
- Suspend/activate

---

## What's NOT Working ❌

No critical issues. Minor concerns:

1. **Performance**: Large customer lists (>10,000) may be slow without database indexing optimization
2. **Validation**: Some edge cases in phone number formats not handled
3. **Password Complexity**: No enforcement on customer passwords

---

## Security Issues 🔐

### Critical

1. **Plaintext Passwords in Response**
   - **Risk**: Customer passwords returned in some API responses
   - **Impact**: Password exposure in logs, monitoring tools
   - **Mitigation**: Never return `password` field in API responses

2. **No Rate Limiting on Customer Creation**
   - **Risk**: Malicious users can create thousands of fake accounts
   - **Impact**: Database bloat, service degradation
   - **Mitigation**: Add rate limiting (e.g., 10 customers per hour per tenant)

### Medium

3. **Soft Delete Issues**
   - **Risk**: Deleted customers retain all data, including passwords
   - **Impact**: Data retention compliance issues (GDPR)
   - **Mitigation**: Implement hard delete after X days, or anonymize data

4. **No Input Sanitization**
   - **Risk**: XSS attacks via name, location fields
   - **Impact**: Script injection in admin dashboard
   - **Mitigation**: Sanitize HTML special characters

5. **Geolocation Data**
   - **Risk**: Storing precise customer locations
   - **Impact**: Privacy concerns, stalking risk
   - **Mitigation**: Get explicit consent, allow customers to opt-out

### Low

6. **Username Enumeration**
   - **Risk**: Can check if username exists via error messages
   - **Impact**: Attackers can build customer database
   - **Mitigation**: Generic error messages

---

## Possible Improvements 🚀

### High Priority

1. **Bulk Import/Export**
   ```typescript
   POST /api/customers/import  // CSV upload
   GET /api/customers/export   // CSV download
   ```
   - Validate CSV format
   - Preview before import
   - Error reporting for failed rows

2. **Automated Expiry Management**
   ```typescript
   // Cron job: Every hour
   - Find customers with expiresAt < now
   - Set status to EXPIRED
   - Disconnect active sessions
   - Send SMS notification
   ```

3. **Customer Self-Service Portal**
   ```typescript
   POST /api/customers/portal/login
   GET /api/customers/portal/usage
   GET /api/customers/portal/payments
   POST /api/customers/portal/renew
   ```

4. **Usage Alerts**
   - SMS when 80% data limit reached
   - Email when expiry is 3 days away
   - WhatsApp notifications (via Business API)

### Medium Priority

5. **MAC Address Management**
   ```typescript
   GET /api/customers/:id/macs
   POST /api/customers/:id/macs       // Add MAC
   DELETE /api/customers/:id/macs/:id  // Remove MAC
   PUT /api/customers/:id/macs/:id/reset
   ```

6. **Credit/Postpaid Billing**
   - Set credit limit per customer
   - Auto-bill at end of month
   - Suspend if credit exceeded

7. **Family/Group Plans**
   - Parent customer with multiple sub-accounts
   - Shared data pool
   - Individual speed limits

8. **Referral System**
   - Generate referral codes
   - Track referrals per customer
   - Reward credits for successful referrals

### Low Priority

9. **Advanced Search**
   - Filter by date range (created, last seen)
   - Filter by data usage (high/low users)
   - Filter by location (map radius)

10. **Customer Tags**
    - Custom labels (VIP, Problematic, Loyal, etc.)
    - Filter and bulk operations on tags

11. **Speed Test Integration**
    ```typescript
    POST /api/customers/:id/speedtest
    GET /api/customers/:id/speedtests
    ```

12. **Document Attachments**
    - Upload ID proof
    - Contracts
    - Installation photos

---

## Performance Considerations

### Database Indexing

Ensure these indexes exist (check `schema.prisma`):
```prisma
@@index([tenantId])
@@index([tenantId, status])
@@index([tenantId, connectionType])
@@index([tenantId, deletedAt])
@@index([username, tenantId])
```

### Query Optimization

For large datasets:
1. Use `select` to fetch only needed fields
2. Implement cursor-based pagination for >10k records
3. Cache frequently accessed customers (Redis)

---

## Related Modules

- **Package Management**: Customers are assigned packages
- **Session Management**: Tracks active/historical sessions
- **Payment Module**: Customer payments
- **RADIUS Server**: Authenticates customers
- **MikroTik Integration**: Pushes customer credentials to routers
- **SMS Gateway**: Sends notifications to customers
- **Map Module**: Displays customer locations

---

## Testing Recommendations

1. **Unit Tests**
   - Password hashing on creation
   - Soft delete logic
   - Wallet balance calculations

2. **Integration Tests**
   - Create customer → verify in DB
   - Update customer → verify audit log
   - Delete customer → verify soft delete
   - Recharge wallet → verify payment created

3. **Load Tests**
   - List 100k customers
   - Bulk create 1000 customers
   - Concurrent updates

---

## Migration Path

1. **Immediate** (Week 1):
   - Remove password from API responses
   - Add rate limiting on customer creation
   - Implement automated expiry cron job

2. **Short-term** (Month 1):
   - Build bulk import/export
   - Create customer self-service portal
   - Add usage alerts

3. **Long-term** (Quarter 1):
   - Implement credit/postpaid billing
   - Build referral system
   - Add advanced filtering and tagging
