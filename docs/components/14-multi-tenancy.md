# Multi-Tenancy Architecture

## Overview

Reflecting the actual implementation in `tenant.routes.ts` and `schema.prisma`, the system uses a **Shared Database, Shared Schema** multi-tenancy strategy. Isolation is enforced at the application level using a mandatory `tenantId` column on all tenant-specific tables and Prisma middleware/logic to ensure data separation.

**Source File**: `/root/easyisp/Backend/src/routes/tenant.routes.ts` (524 lines)

---

## Architecture Principles

1.  **Logical Isolation**: Every major entity (`Customer`, `Payment`, `NAS`, etc.) has a `tenantId` foreign key linking it to the `Tenant` table.
2.  **Shared Infrastructure**: All tenants share the same PostgreSQL database, tables, and Node.js process.
3.  **Tenant Context**: The authentication middleware extracts the `tenantId` from the user's JWT and attaches it to the request context (`c.get('tenantId')`).
4.  **SaaS Management**: A super-admin layer manages tenant lifecycles (trials, subscriptions, suspensions).

---

## Tenant Data Model

The `Tenant` model is the root of the hierarchy:

```prisma
model Tenant {
  id            String       @id @default(uuid())
  name          String       @unique  // Internal ID name
  businessName  String       // Display name
  email         String
  status        TenantStatus @default(TRIAL)
  walletBalance Float        @default(0)

  // SaaS Features
  isActivated        Boolean   @default(false)
  trialEndsAt        DateTime?
  subscriptionEndsAt DateTime?

  // Configuration
  smsProvider     String?
  smsApiKey       String?
  mpesaConsumerKey String?
  // ... other config fields
}
```

### Tenant Lifecycles (`TenantStatus`)
-   **TRIAL**: New signup, limited time access (checked via `trialEndsAt`).
-   **ACTIVE**: Paid subscription active (`subscriptionEndsAt`).
-   **SUSPENDED**: Manually disabled by SaaS owner.
-   **EXPIRED**: Trial or subscription ended.

---

## Role-Based Access Control (RBAC)

Multi-tenancy is combined with granular permissions for users *within* a tenant.

### Defined Roles (`Role` Enum)
| Role | Description |
| :--- | :--- |
| **SUPER_ADMIN** | SaaS Owner (can manage all tenants). |
| **ADMIN** | Tenant Administrator (full access to their tenant). |
| **STAFF** | General staff access. |
| **CUSTOMER_CARE**| Limited to customer support and rudimentary billing. |
| **FIELD_TECH** | Limited to installation and repair views. |
| **VIEWER** | Read-only access. |

### Operator Management
Endpoints in `tenant.routes.ts` allow Admins to manage their staff:
-   `POST /api/tenant/operators` - Create new operator.
-   `GET /api/tenant/operators` - List staff.
-   `POST /api/tenant/operators/:id/reset-password` - Emergency password reset.

---

## Settings Management

Each tenant manages their own integrations independently.

### 1. SMS Configuration
Tenants can verify and switch their SMS provider dynamically.
-   **Endpoint**: `PUT /api/tenant/sms-config`
-   **Logic**: Updates `smsProvider`, `smsApiKey`, etc. in the `Tenant` table.
-   **Testing**: `POST /api/tenant/sms-config/test` validates credentials immediately.

### 2. Payment Gateways
The system supports multiple gateway configurations per tenant (e.g., Paybill vs. Buy Goods).
-   **Model**: `PaymentGateway` relation (or direct fields on `Tenant` for simple setups).
-   **Flexibility**: Separate gateways for Hotspot vs. PPPoE if needed.

---

## API Endpoints

### Tenant Self-Management
| Method | Endpoint | Permission | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/tenant/me` | Auth Required | Get current tenant status, stats, and credits. |
| `PUT` | `/api/tenant/settings` | ADMIN | Update branding (logo, colors, contact info). |
| `PUT` | `/api/tenant/sms-config` | ADMIN | Configure SMS provider. |
| `GET` | `/api/tenant/sms-balance`| ADMIN | Check current SMS credit balance. |
| `PUT` | `/api/tenant/payment-gateway` | ADMIN | Configure M-Pesa credentials. |

### Operator Management
| Method | Endpoint | Permission | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/tenant/operators` | Auth Required | List all users in this tenant. |
| `POST` | `/api/tenant/operators` | ADMIN | Create a new staff account. |
| `DELETE`| `/api/tenant/operators/:id` | ADMIN | Soft-delete a staff account. |
| `GET` | `/api/tenant/operators/:id/logs` | ADMIN | View audit logs for a specific staff member. |

---

## Security & Isolation Mechanisms

1.  **Middleware Enforcement**: All routes begin with `authMiddleware`, which verifies the JWT token. The token contains the `tenantId`.
2.  **Context Injection**: The `tenantId` is passed via `c.get('tenantId')` to all controllers.
3.  **Query Scoping**: Every Prisma query *must* include `where: { tenantId }`.
    *   *Correct*: `prisma.customer.findFirst({ where: { id, tenantId } })`
    *   *Incorrect*: `prisma.customer.findFirst({ where: { id } })` (Would allow ID guessing across tenants).
4.  **Unique Constraints**: Constraints like `@@unique([username, tenantId])` allow different tenants to reuse usernames (e.g., "john" can exist in both Tenant A and Tenant B).

---

## What's Complete ✅

1.  ✅ **Schema Isolation**: `tenantId` present on all 20+ models.
2.  ✅ **Lifecycle Management**: Trial, Active, Suspended, Expired logic implemented.
3.  ✅ **Self-Service Settings**: SMS and Payment configs are editable by the tenant.
4.  ✅ **Operator CRUD**: Full management of staff accounts.
5.  ✅ **Config Testing**: Endpoints to test SMS/Payment configs before saving.
6.  ✅ **Audit Logging**: Per-operator log retrieval.

## What's NOT Complete ⚠️

1.  ⚠️ **Middleware Enforcement**: Isolation relies on developer discipline to add `where: { tenantId }`. No automated Prisma middleware is currently enforcing this globally (soft risk).
2.  ⚠️ **Data Export**: No single-click "Export All My Data" for GDPR compliance / tenant exit.
3.  ⚠️ **Domain Masking**: All tenants use the same API domain; no support for `tenant.custom-domain.com`.

## Security Issues 🔐

1.  **Shared Database Risks**: A missed `where` clause in *any* report or query could leak data between tenants. (Current code review shows good discipline, but it requires constant vigilance).
2.  **Config Exposure**: Checking `/api/tenant/payment-gateway` returns the config. While the implementation attempts to act safely, returning API keys/Consumer Secrets to the frontend is generally discouraged, even to Admins.

## Future Improvements 🚀

1.  **Prisma Middleware**: Implement a global Prisma extension to automatically inject `where: { tenantId }` into every query to prevent developer error.
2.  **Resource Quotas**: Limit the number of customers/routers based on the subscription tier (currently missing).
3.  **Custom Domains**: Allow tenants to map their own domains for the Hotspot Portal.
