# Database Schema Documentation

## Overview

The application is built on **PostgreSQL** using **Prisma ORM**. The schema is designed for **multi-tenancy**, where almost every table includes a `tenantId` field to logically isolate data between different ISP tenants.

**Source File**: `/root/easyisp/Backend/prisma/schema.prisma` (629 lines)

---

## Core Entities

### Tenant
The root entity for the SaaS architecture.
-   `id`: UUID
-   `name`: Unique internal identifier.
-   `status`: `TRIAL`, `ACTIVE`, `SUSPENDED`, `EXPIRED`.
-   `config`: Stores SMS, M-Pesa, and branding settings directly.
-   `relations`: Owns all other entities (Users, Customers, Payments, etc.).

### User (Operators)
Staff members who manage the system.
-   `role`: `SUPER_ADMIN`, `ADMIN`, `STAFF`, `CUSTOMER_CARE`, `FIELD_TECH`, `VIEWER`.
-   `status`: `ACTIVE`, `SUSPENDED`, `DELETED`.
-   `permissions`: Array of granular permission strings (`addedPermissions`, `removedPermissions`) allowing overrides of role defaults.

---

## Network & Access Control

### NAS (Network Access Server)
Represents MikroTik routers.
-   `secret`: RADIUS shared secret.
-   `apiUsername`/`apiPassword`: Credentials for API control.
-   `status`: `ONLINE`, `OFFLINE`, `PENDING`.
-   `vpnIp`: WireGuard IP if connected via VPN.

### Session (RADIUS Data)
Tracks active and historical internet sessions.
-   `sessionId`: Unique RADIUS Acct-Session-Id.
-   `framedIp`: IP assigned to the user.
-   `inputOctets`/`outputOctets`: Bandwidth usage.
-   `terminateCause`: Why the session ended.

### VPNPeer
WireGuard peers for remote router management.
-   `publicKey`/`privateKey`: WireGuard credentials.
-   `assignedIp`: Internal VPN IP (`10.10.x.x`).
-   `status`: `ACTIVE`, `DISABLED`.

---

## Customer & Billing

### Customer
The end-user subscriber.
-   `connectionType`: `PPPOE`, `HOTSPOT`, `DHCP`, `STATIC`.
-   `status`: `ACTIVE`, `SUSPENDED`, `EXPIRED`.
-   `walletBalance`: Prepaid account balance.
-   `macAddress`: For authentication.
-   `constraints`: unique `[username, tenantId]`.

### Package
Internet plans.
-   `type`: `PPPOE` or `HOTSPOT`.
-   `downloadSpeed`/`uploadSpeed`: Bandwidth limits (Mbps).
-   `burstDownload`/`burstUpload`: Burst limits.
-   `sessionTime`: Validity duration or strict time limit.

### Voucher
Prepaid access codes for Hotspots.
-   `code`: The login code.
-   `status`: `AVAILABLE`, `USED`, `EXPIRED`.
-   `batchId`: For grouping generated vouchers.

### Payment
Financial transactions.
-   `method`: `MPESA`, `CASH`, `BANK`, `CARD`.
-   `status`: `PENDING`, `COMPLETED`, `FAILED`.
-   `transactionId`: External reference (e.g., M-Pesa Receipt).
-   `constraints`: unique `transactionId`.

---

## Financials (Accounting)

### Invoice
Billable records.
-   `invoiceNo`: Human-readable ID (e.g., INV-2024001).
-   `items`: JSON array of line items.
-   `status`: `pending`, `paid`, `overdue`, `cancelled`.

### Expense
Operational costs.
-   `category`: Grouping (Rent, Bandwidth, etc.).
-   `isRecurring`: Boolean flag (logic needs implementation).

### ChartOfAccount
General Ledger accounts.
-   `type`: Asset, Liability, Equity, Revenue, Expense.
-   `code`: Accounting code (e.g., 1001).

---

## Logs & Audit

### AuditLog
Records staff actions.
-   `action`: Enum-like string (e.g., `CUSTOMER_CREATE`).
-   `targetType`/`targetId`: The entity affected.
-   `details`: JSON-like string description.

### SMSLog
History of sent messages.
-   `status`: `SENT`, `FAILED`, `DELIVERED`.
-   `provider`: Which gateway was used.

---

## Payment Gateways

### PendingHotspotPayment
Temporary state for M-Pesa STK Push flows.
-   `checkoutRequestId`: M-Pesa tracking ID.
-   `status`: `PENDING` -> `COMPLETED`.
-   `expiresAt`: Auto-cleanup timestamp.

### PaymentGateway / SmsGateway
Configuration tables for multi-provider support. Allows different configs for Hotspot vs. PPPoE flows within the same tenant.

---

## Key Indexes
The schema is heavily optimized for multi-tenant access patterns:
-   `@@index([tenantId])`: On **every** table.
-   `@@index([tenantId, status])`: For fast filtering of active/suspended records.
-   `@@index([username])`: For RADIUS lookups.
-   `@@index([ipAddress])`: For Router processing.

## Missing / Potential Improvements
1.  **Foreign Keys for Logs**: `AuditLog` and `SMSLog` have soft links to targets (`targetId`). Hard foreign keys are difficult due to polymorphism but would ensure referential integrity.
2.  **JSON Typing**: Use typed interfaces for `Invoice.items` and `SmsGateway.config` in the application layer, as the database just sees `Json`.
3.  **Archiving**: No partition strategy for `Session` or `SMSLog` tables, which will grow very large over time.
