# Super Admin / SaaS Owner Module

## Overview

The Super Admin module provides SaaS platform management capabilities for the system owner to manage all tenants, trials, subscriptions, and perform administrative operations across the entire platform.

**Source File**: `/root/easyisp/Backend/src/routes/superAdmin.routes.ts` (476 lines, 15.4 KB)

---

## What It Does in the System

1. **Tenant Management** - List, view, and manage all ISP tenants
2. **Trial Management** - Extend trial periods
3. **Subscription Management** - Activate, extend, and manage subscriptions
4. **Tenant Status Control** - Suspend and reactivate tenants
5. **Balance Management** - Add wallet/SMS credits
6. **User Management** - Reset user passwords
7. **SaaS Statistics** - Platform-wide metrics
8. **Tenant Deletion** - Complete tenant removal with cascade

---

## Authentication

### SaaS Owner Middleware

```typescript
const requireSaaSOwner = async (c, next) => {
    const user = c.get('user');
    const saasOwnerEmail = process.env.SAAS_OWNER_EMAIL || 'owner@easyisp.com';
    
    if (user.email !== saasOwnerEmail) {
        throw new AppError(403, 'Access denied. SaaS owner privileges required.');
    }
    
    return next();
};
```

**Environment Variable**: `SAAS_OWNER_EMAIL` - Email of the SaaS owner (default: `owner@easyisp.com`)

---

## API Endpoints

### GET `/api/super-admin/tenants`
**Purpose**: List all tenants with subscription info

**Auth**: SaaS Owner only

**Response** (200):
```json
{
  "tenants": [
    {
      "id": "uuid",
      "name": "MyISP",
      "businessName": "MyISP Networks Ltd",
      "email": "admin@myisp.com",
      "phone": "+254700000000",
      "status": "ACTIVE",
      "isActivated": true,
      "trialEndsAt": null,
      "subscriptionEndsAt": "2027-01-01T00:00:00Z",
      "createdAt": "2025-06-01T00:00:00Z",
      "_count": {
        "users": 5,
        "customers": 250,
        "routers": 3
      },
      "subscriptionStatus": "subscribed",
      "daysRemaining": 362
    }
  ]
}
```

**Subscription Status Logic**:
- `trial` - In trial period, trial not expired
- `subscribed` - Activated with valid subscription
- `lifetime` - Activated with no end date
- `expired` - Trial or subscription expired
- `suspended` - Manually suspended

---

### GET `/api/super-admin/tenants/:id`
**Purpose**: Get detailed tenant information

**Auth**: SaaS Owner only

**Response** (200):
```json
{
  "tenant": {
    "id": "uuid",
    "name": "MyISP",
    "businessName": "MyISP Networks Ltd",
    "email": "admin@myisp.com",
    "users": [
      {
        "id": "uuid",
        "email": "admin@myisp.com",
        "name": "Admin User",
        "role": "ADMIN",
        "status": "ACTIVE",
        "createdAt": "2025-06-01T00:00:00Z"
      }
    ],
    "_count": {
      "customers": 250,
      "packages": 8,
      "routers": 3,
      "payments": 1500
    }
  }
}
```

---

### POST `/api/super-admin/tenants/:id/activate`
**Purpose**: Activate a tenant and set subscription

**Auth**: SaaS Owner only

**Request Body**:
```json
{
  "subscriptionMonths": 12
}
```

**What It Does**:
1. Sets `isActivated: true`
2. Sets `status: 'ACTIVE'`
3. Calculates `subscriptionEndsAt` (current date + months)
4. Logs action

---

### POST `/api/super-admin/tenants/:id/suspend`
**Purpose**: Suspend a tenant

**Auth**: SaaS Owner only

**What It Does**:
- Sets `status: 'SUSPENDED'`
- Logs action with warning level

---

### POST `/api/super-admin/tenants/:id/reactivate`
**Purpose**: Reactivate a suspended tenant

**Auth**: SaaS Owner only

**What It Does**:
1. Determines new status based on trial/activation state
2. If in valid trial period → `TRIAL`
3. Otherwise → `ACTIVE`

---

### POST `/api/super-admin/tenants/:id/extend-trial`
**Purpose**: Extend tenant's trial period

**Auth**: SaaS Owner only

**Request Body**:
```json
{
  "days": 14
}
```

**Validation**: 1-365 days

---

### POST `/api/super-admin/tenants/:id/extend-subscription`
**Purpose**: Extend tenant's subscription

**Auth**: SaaS Owner only

**Request Body** (option 1 - months):
```json
{
  "months": 6
}
```

**Request Body** (option 2 - specific date):
```json
{
  "subscriptionEndsAt": "2027-06-01T00:00:00Z"
}
```

---

### POST `/api/super-admin/tenants/:id/add-balance`
**Purpose**: Add wallet or SMS balance

**Auth**: SaaS Owner only

**Request Body**:
```json
{
  "amount": 5000,
  "type": "wallet"
}
```

**Types**: `wallet`, `sms`

---

### PUT `/api/super-admin/tenants/:id/settings`
**Purpose**: Update tenant settings

**Auth**: SaaS Owner only

**Request Body**:
```json
{
  "businessName": "New Business Name",
  "email": "new@email.com",
  "phone": "+254711111111",
  "location": "Nairobi, Kenya",
  "logo": "https://...",
  "primaryColor": "#0ea5e9",
  "smsProvider": "TEXTSMS",
  "smsApiKey": "xxx",
  "smsSenderId": "MyISP"
}
```

---

### DELETE `/api/super-admin/tenants/:id`
**Purpose**: Completely delete a tenant and all data

**Auth**: SaaS Owner only

**What It Does** (in transaction):
1. Delete AuditLog
2. Delete SMSLog
3. Delete VPNPeer
4. Delete Voucher
5. Delete Payment
6. Delete Expense
7. Delete Invoice
8. Delete ChartOfAccount
9. Delete Customer
10. Delete Package
11. Delete NAS
12. Delete User
13. Delete Tenant

**Warning**: This is irreversible!

---

### POST `/api/super-admin/tenants/:id/reset-user-password`
**Purpose**: Reset a user's password

**Auth**: SaaS Owner only

**Request Body**:
```json
{
  "userId": "uuid",
  "newPassword": "newSecurePassword123"
}
```

**Validation**: Minimum 6 characters

---

### GET `/api/super-admin/stats`
**Purpose**: Get platform-wide statistics

**Auth**: SaaS Owner only

**Response** (200):
```json
{
  "stats": {
    "tenants": {
      "total": 50,
      "active": 35,
      "trial": 10,
      "expired": 3,
      "suspended": 2
    },
    "totalCustomers": 5000,
    "totalUsers": 150,
    "totalRouters": 100
  }
}
```

---

## What's Complete ✅

1. ✅ Tenant listing with subscription status
2. ✅ Tenant details with users and counts
3. ✅ Tenant activation with subscription period
4. ✅ Tenant suspension and reactivation
5. ✅ Trial extension (1-365 days)
6. ✅ Subscription extension (months or date)
7. ✅ Wallet/SMS balance management
8. ✅ Tenant settings update
9. ✅ Complete tenant deletion (cascade)
10. ✅ User password reset
11. ✅ Platform statistics

---

## What's NOT Complete ⚠️

1. ⚠️ **Tenant Registration** - No super admin endpoint to create tenants
2. ⚠️ **Revenue per Tenant** - No tenant revenue tracking
3. ⚠️ **Audit Trail** - Actions logged but no audit endpoint
4. ⚠️ **Tenant Impersonation** - No way to login as tenant admin
5. ⚠️ **Bulk Operations** - No mass trial extension, etc.
6. ⚠️ **Email Notifications** - No notification when trial extends
7. ⚠️ **Subscription Payment Tracking** - No payment history

---

## What's Working ✅

All implemented features are fully functional:
- Tenant management ✓
- Trial/subscription management ✓
- Balance management ✓
- Cascade deletion ✓

---

## What's NOT Working ❌

No critical issues found.

---

## Security Issues 🔐

### Medium

1. **Email-Based Authentication**
   - SaaS owner identified by email only
   - If email compromised, full platform access
   - **Mitigation**: Add MFA or separate super admin auth

2. **No Password Complexity Check**
   - Password reset only requires 6 chars
   - **Mitigation**: Enforce strength requirements

### Low

3. **No Rate Limiting**
   - Password reset endpoint not rate limited
   - **Mitigation**: Add rate limiter

---

## Environment Variables

```bash
SAAS_OWNER_EMAIL=owner@easyisp.com  # SaaS owner's email address
```

---

## Possible Improvements 🚀

### High Priority

1. **MFA for Super Admin**
   ```typescript
   // Require MFA code for sensitive operations
   const mfaVerified = await verifyOTP(user.email, mfaCode);
   if (!mfaVerified) throw new AppError(403, 'MFA required');
   ```

2. **Tenant Impersonation**
   ```typescript
   POST /api/super-admin/tenants/:id/impersonate
   // Generate temporary JWT for tenant admin
   ```

### Medium Priority

3. **Tenant Revenue Report**
4. **Bulk Trial Extension**
5. **Subscription Payment History**

---

## Related Modules

- **Authentication** - User management
- **Tenant Settings** - Tenant configuration
- **Audit Logging** - Action logging
