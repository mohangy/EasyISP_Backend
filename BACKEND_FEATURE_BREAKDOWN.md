# EasyISP Backend - Feature Breakdown

> **Created:** December 27, 2025  
> **Total Features:** 46 across 6 phases

---

## 📦 Phase 1: Core Infrastructure

| # | Feature | Endpoints | Priority |
|---|---------|-----------|----------|
| 1 | Project Setup | Hono + Prisma + TypeScript | 🔴 |
| 2 | Database Schema | All Prisma models, migrations | 🔴 |
| 3 | Authentication | login, register, logout, me, refresh, password | 🔴 |
| 4 | Tenant Management | me, settings, logo upload | 🔴 |
| 5 | Operators/Team | CRUD, permissions, password reset | 🔴 |
| 6 | Audit Logging | Log all mutations, query by operator | 🔴 |
| 7 | Health Checks | /health, /ready, /live | 🔴 |

---

## 👥 Phase 2: Customer & Package Management

| # | Feature | Endpoints | Priority |
|---|---------|-----------|----------|
| 8 | Customer CRUD | list, create, get, update, delete | 🔴 |
| 9 | Customer Actions | mac-reset, disconnect, suspend, activate | 🔴 |
| 10 | Customer Billing | recharge, expiry update, package change | 🔴 |
| 11 | Customer Live Status | online/offline, session uptime | 🟡 |
| 12 | Package CRUD | list, create, get, update, delete | 🔴 |
| 13 | Package Stats | client counts, revenue per package | 🟡 |
| 14 | Package Router Revenue | revenue breakdown by router | 🟡 |

---

## 💰 Phase 3: Finance & Payments

| # | Feature | Endpoints | Priority |
|---|---------|-----------|----------|
| 15 | M-Pesa Integration | STK push, callback webhook, query status | 🔴 |
| 16 | Electronic Payments | list M-Pesa transactions | 🔴 |
| 17 | Manual Payments | create, list, delete | 🟡 |
| 18 | Income Tracking | list income, record income | 🟡 |
| 19 | Expense Tracking | create, list expenses | 🟡 |
| 20 | Chart of Accounts | create, list, delete ledger accounts | 🟢 |
| 21 | Customer Invoices | create, list, update status | 🟡 |
| 22 | Dashboard Stats | revenue, customer counts, trends | 🔴 |

---

## 🌐 Phase 4: Network & Routers

| # | Feature | Endpoints | Priority |
|---|---------|-----------|----------|
| 23 | NAS/Router CRUD | list, create, get, update, delete | 🔴 |
| 24 | Router Test Connection | ping, API connectivity check | 🟡 |
| 25 | Router Live Status | CPU, memory, uptime, sessions | 🟡 |
| 26 | Router Config Script | generate downloadable .rsc | 🟡 |
| 27 | MikroTik System Stats | board, version, resources | 🟡 |
| 28 | MikroTik Sessions | list PPPoE/Hotspot sessions | 🟡 |
| 29 | MikroTik Disconnect | force disconnect user | 🟡 |
| 30 | MikroTik Interfaces | list router interfaces | 🟢 |
| 31 | MikroTik Queues | list/manage queues | 🟢 |
| 32 | Router Wizard | start, status, configure, auto-configure | 🟢 |

---

## 🎫 Phase 5: Auxiliary Services

| # | Feature | Endpoints | Priority |
|---|---------|-----------|----------|
| 33 | Voucher Generation | create batch | 🟡 |
| 34 | Voucher Management | list, delete, revoke | 🟡 |
| 35 | SMS Send | send single/bulk | 🟢 |
| 36 | SMS Logs | list, clear | 🟢 |
| 37 | SMS Balance | check credits | 🟢 |
| 38 | SMS Settings | configure provider | 🟢 |
| 39 | GIS/Map Data | customers + routers with coordinates | 🟢 |
| 40 | Tenant Invoices | subscription billing | 🟢 |
| 41 | Wallet Top-up | initiate payment for tenant | 🟢 |

---

## ⚡ Phase 6: Advanced Features (Future)

| # | Feature | Endpoints | Priority |
|---|---------|-----------|----------|
| 42 | RADIUS Server | authentication, accounting, CoA | 🔵 |
| 43 | Hotspot Portal | captive portal page, voucher login | 🔵 |
| 44 | VPN Service | IKEv2 tunnel management | 🔵 |
| 45 | SNMP Polling | router metrics collection | 🔵 |
| 46 | Session Sync | auto-close stale sessions | 🔵 |

---

## Summary

| Phase | Features | Focus |
|-------|----------|-------|
| **Phase 1** | 7 | Foundation |
| **Phase 2** | 7 | Core business |
| **Phase 3** | 8 | Revenue |
| **Phase 4** | 10 | Network |
| **Phase 5** | 9 | Extras |
| **Phase 6** | 5 | Advanced |

**Priority Legend:**
- 🔴 Critical - Must have
- 🟡 High - Should have
- 🟢 Medium - Nice to have
- 🔵 Future - Later
