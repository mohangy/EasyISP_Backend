# Audit Logging Module

## Overview

The Audit Logging module provides a centralized system for tracking user actions across the platform. It logs security-sensitive operations like logins, customer modifications, payment processing, and configuration changes.

**Source File**: `/root/easyisp/Backend/src/lib/audit.ts` (177 lines, 4.5 KB)

---

## What It Does in the System

1. **Action Logging** - Records user actions with timestamps
2. **Target Tracking** - Links actions to specific entities
3. **User Attribution** - Tracks who performed each action
4. **IP Address Logging** - Optional IP tracking
5. **Query Functions** - Retrieve logs by operator or tenant

---

## Supported Audit Actions

```typescript
export type AuditAction =
    // Authentication
    | 'LOGIN'
    | 'LOGOUT'
    | 'PASSWORD_RESET'
    | 'PASSWORD_CHANGE'
    
    // Tenant/Operator Management
    | 'TENANT_CREATE'
    | 'TENANT_UPDATE'
    | 'OPERATOR_CREATE'
    | 'OPERATOR_UPDATE'
    | 'OPERATOR_DELETE'
    
    // Customer Management
    | 'CUSTOMER_CREATE'
    | 'CUSTOMER_UPDATE'
    | 'CUSTOMER_DELETE'
    | 'CUSTOMER_DISCONNECT'
    | 'CUSTOMER_SUSPEND'
    | 'CUSTOMER_ACTIVATE'
    | 'MAC_RESET'
    | 'MAC_LOCK'
    
    // Package/Plan Operations
    | 'PACKAGE_CHANGE'
    | 'EXPIRY_UPDATE'
    | 'OVERRIDE_PLAN'
    | 'SPEED_BOOST'
    | 'ASSIGN_STATIC_IP'
    | 'MANUAL_RECHARGE'
    
    // Payments
    | 'PAYMENT_PROCESS'
    | 'PAYMENT_REFUND'
    
    // Router/NAS Management
    | 'ROUTER_CREATE'
    | 'ROUTER_UPDATE'
    | 'ROUTER_DELETE'
    | 'ROUTER_REBOOT'
    
    // Voucher System
    | 'VOUCHER_GENERATE'
    | 'VOUCHER_DELETE'
    
    // Communication
    | 'SMS_SEND'
    | 'SEND_MESSAGE'
    
    // VPN Management
    | 'VPN_PEER_CREATE'
    | 'VPN_PEER_DELETE'
    | 'VPN_PEER_ENABLE'
    | 'VPN_PEER_DISABLE'
    
    // Support Tickets
    | 'TICKET_CREATE'
    | 'TICKET_UPDATE'
    | 'TICKET_ASSIGN'
    | 'TICKET_RESOLVE'
    | 'TICKET_DELETE'
    
    // Settings
    | 'SETTINGS_UPDATE';
```

---

## Core Functions

### `createAuditLog(params)`

Creates a new audit log entry.

```typescript
interface AuditLogParams {
    action: AuditAction;
    targetType: string;      // e.g., 'Customer', 'NAS', 'Voucher'
    targetId?: string;       // UUID of the target entity
    targetName?: string;     // Human-readable name
    details?: string;        // Additional context
    ipAddress?: string;      // Client IP
    user: AuthUser;          // User who performed action
}

// Usage example
await createAuditLog({
    action: 'CUSTOMER_CREATE',
    targetType: 'Customer',
    targetId: customer.id,
    targetName: customer.name,
    details: `Created with package ${customer.packageId}`,
    user: c.get('user'),
});
```

**Error Handling**: Failures are logged to console but don't fail the main operation.

---

### `getOperatorAuditLogs(operatorId, tenantId, options)`

Get audit logs for a specific operator (user).

```typescript
const result = await getOperatorAuditLogs(operatorId, tenantId, {
    page: 1,
    pageSize: 10
});

// Response:
{
    logs: [
        {
            id: "uuid",
            action: "CUSTOMER_CREATE",
            targetType: "Customer",
            targetName: "John Doe",
            details: "Created with package Premium",
            timestamp: "2026-01-04T12:00:00Z"
        }
    ],
    total: 150,
    page: 1,
    pageSize: 10
}
```

---

### `getTenantAuditLogs(tenantId, options)`

Get all audit logs for a tenant with optional action filter.

```typescript
const result = await getTenantAuditLogs(tenantId, {
    page: 1,
    pageSize: 20,
    action: 'CUSTOMER_CREATE'  // Optional filter
});

// Response includes operator info:
{
    logs: [
        {
            id: "uuid",
            action: "CUSTOMER_CREATE",
            targetType: "Customer",
            targetId: "customer-uuid",
            targetName: "John Doe",
            details: null,
            timestamp: "2026-01-04T12:00:00Z",
            operator: {
                name: "Admin User",
                email: "admin@myisp.com"
            }
        }
    ],
    total: 500,
    page: 1,
    pageSize: 20
}
```

---

## Database Schema

```prisma
model AuditLog {
  id          String   @id @default(uuid())
  action      String
  targetType  String
  targetId    String?
  targetName  String?
  details     String?
  ipAddress   String?
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  tenantId    String
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  createdAt   DateTime @default(now())
  
  @@index([tenantId, createdAt])
  @@index([userId, createdAt])
}
```

---

## What's Complete ✅

1. ✅ 47 distinct audit action types
2. ✅ Target entity linking (type, ID, name)
3. ✅ User attribution
4. ✅ IP address tracking
5. ✅ Details field for context
6. ✅ Operator-specific log retrieval
7. ✅ Tenant-wide log retrieval
8. ✅ Action type filtering
9. ✅ Pagination support
10. ✅ Graceful error handling

---

## What's NOT Complete ⚠️

1. ⚠️ **API Endpoint** - No REST endpoint to query logs (only library functions)
2. ⚠️ **Log Retention** - No automatic cleanup of old logs
3. ⚠️ **Export Feature** - No CSV/PDF export
4. ⚠️ **Date Range Filtering** - Only action filter, no date range
5. ⚠️ **Search** - No text search in details/target name
6. ⚠️ **Real-time Streaming** - No WebSocket for live logs
7. ⚠️ **Log Rotation** - No archival strategy

---

## What's Working ✅

All implemented features are functional:
- Audit log creation ✓
- Query by operator ✓
- Query by tenant ✓
- Action filtering ✓

---

## What's NOT Working ❌

No critical issues found.

---

## Security Considerations 🔐

### Strengths

1. ✅ Logs are tenant-isolated
2. ✅ User attribution on all logs
3. ✅ IP address capture available

### Improvements Needed

1. **Log Integrity** - No tamper detection
2. **Sensitive Data** - Details field may contain PII
3. **Access Control** - Query functions don't check permissions

---

## Possible Improvements 🚀

### High Priority

1. **Add REST Endpoints**
   ```typescript
   GET /api/audit-logs?page=1&action=LOGIN&startDate=2026-01-01
   GET /api/audit-logs/operators/:id
   ```

2. **Date Range Filtering**
   ```typescript
   async function getTenantAuditLogs(tenantId, options) {
       const where = { tenantId };
       if (options.startDate) where.createdAt = { gte: options.startDate };
       if (options.endDate) where.createdAt.lte = options.endDate;
   }
   ```

3. **Log Retention Policy**
   ```typescript
   // Cron job: Delete logs older than 1 year
   await prisma.auditLog.deleteMany({
       where: {
           createdAt: { lt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) }
       }
   });
   ```

### Medium Priority

4. **CSV Export**
5. **Real-time WebSocket Feed**
6. **Activity Dashboard Widget**

---

## Related Modules

- **Authentication** - Logs LOGIN/LOGOUT
- **Customer Management** - Logs CUSTOMER_* actions
- **Router Management** - Logs ROUTER_* actions
- **Payment Module** - Logs PAYMENT_* actions
- **Voucher System** - Logs VOUCHER_* actions
