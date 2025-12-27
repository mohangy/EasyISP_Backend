# EasyISP Backend - API Endpoints

> **Created:** December 27, 2025  
> **Last Updated:** December 27, 2025 13:37 EAT  
> **Total Endpoints:** 112  
> **Status:** All 6 Phases Complete ✅

---

## Phase 1: Core Infrastructure ✅

### Authentication (`/api/auth`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/auth/login` | Login with email/password | ❌ |
| POST | `/api/auth/register` | Register new tenant + admin | ❌ |
| POST | `/api/auth/logout` | Logout (invalidate token) | ✅ |
| GET | `/api/auth/me` | Get current user info | ✅ |
| PUT | `/api/auth/password` | Change password | ✅ |

### Tenant (`/api/tenant`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/tenant/me` | Get tenant info + stats | ✅ |
| PUT | `/api/tenant/settings` | Update tenant settings | ✅ (Admin) |
| GET | `/api/tenant/operators` | List all operators | ✅ |
| POST | `/api/tenant/operators` | Create new operator | ✅ (Admin) |
| GET | `/api/tenant/operators/:id` | Get operator details | ✅ |
| PUT | `/api/tenant/operators/:id` | Update operator | ✅ (Admin) |
| DELETE | `/api/tenant/operators/:id` | Delete operator | ✅ (Admin) |
| POST | `/api/tenant/operators/:id/reset-password` | Reset operator password | ✅ (Admin) |
| GET | `/api/tenant/operators/:id/logs` | Get operator audit logs | ✅ |

### Dashboard (`/api/dashboard`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/dashboard/stats` | Get dashboard stats | ✅ |
| GET | `/api/dashboard/revenue` | Get revenue trends | ✅ |
| GET | `/api/dashboard/network-usage` | Get network usage | ✅ |

### Health (`/health`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/health` | Overall health status | ❌ |
| GET | `/health/ready` | Readiness check (DB) | ❌ |
| GET | `/health/live` | Liveness check | ❌ |

---

## Phase 2: Customer & Package Management ✅

### Customers (`/api/customers`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/customers` | List customers (with filters) | ✅ |
| GET | `/api/customers/:id` | Get customer details | ✅ |
| POST | `/api/customers` | Create customer | ✅ |
| PUT | `/api/customers/:id` | Update customer | ✅ |
| DELETE | `/api/customers/:id` | Delete customer | ✅ |
| GET | `/api/customers/:id/live-status` | Get online status | ✅ |
| POST | `/api/customers/:id/mac-reset` | Reset MAC binding | ✅ |
| POST | `/api/customers/:id/disconnect` | Disconnect session | ✅ |
| POST | `/api/customers/:id/recharge` | Manual recharge | ✅ |
| PUT | `/api/customers/:id/expiry` | Update expiry date | ✅ |
| PUT | `/api/customers/:id/package` | Change package | ✅ |
| POST | `/api/customers/:id/suspend` | Suspend account | ✅ |
| POST | `/api/customers/:id/activate` | Activate account | ✅ |

### Packages (`/api/packages`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/packages` | List all packages | ✅ |
| GET | `/api/packages/:id` | Get package details | ✅ |
| POST | `/api/packages` | Create package | ✅ |
| PUT | `/api/packages/:id` | Update package | ✅ |
| DELETE | `/api/packages/:id` | Delete package | ✅ |
| GET | `/api/packages/:id/stats` | Get package stats | ✅ |
| GET | `/api/packages/:id/router-revenue` | Revenue by router | ✅ |

---

## Phase 3: Finance & Payments ✅

### Finance (`/api/finance`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/finance/income` | List income transactions | ✅ |
| POST | `/api/finance/income` | Record income | ✅ |
| GET | `/api/finance/expenses` | List expenses | ✅ |
| POST | `/api/finance/expenses` | Add expense | ✅ |
| GET | `/api/finance/accounts` | Chart of accounts | ✅ |
| POST | `/api/finance/accounts` | Create account | ✅ |
| DELETE | `/api/finance/accounts/:id` | Delete account | ✅ |
| GET | `/api/finance/invoices` | List invoices | ✅ |
| POST | `/api/finance/invoices` | Create invoice | ✅ |
| PUT | `/api/finance/invoices/:id/status` | Update invoice status | ✅ |

### Payments (`/api/payments`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/payments/electronic` | List M-Pesa transactions | ✅ |
| GET | `/api/payments/manual` | List manual payments | ✅ |
| POST | `/api/payments/manual` | Record manual payment | ✅ |
| DELETE | `/api/payments/manual` | Clear manual payments | ✅ |

### Webhooks (`/api/webhooks`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/webhooks/mpesa` | M-Pesa callback | API Key |

---

## Phase 4: Network & Routers ✅

### NAS/Routers (`/api/nas`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/nas` | List routers | ✅ |
| GET | `/api/nas/:id` | Get router details | ✅ |
| POST | `/api/nas` | Add router | ✅ |
| PUT | `/api/nas/:id` | Update router | ✅ |
| DELETE | `/api/nas/:id` | Delete router | ✅ |
| POST | `/api/nas/:id/test` | Test connection | ✅ |
| GET | `/api/nas/:id/live-status` | Get live status | ✅ |
| GET | `/api/nas/:id/config` | Download config | ✅ |

### MikroTik API (`/api/mikrotik`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/mikrotik/:nasId/system-stats` | System statistics | ✅ |
| GET | `/api/mikrotik/:nasId/sessions` | Active sessions | ✅ |
| POST | `/api/mikrotik/:nasId/disconnect` | Disconnect user | ✅ |
| GET | `/api/mikrotik/:nasId/interfaces` | List interfaces | ✅ |
| GET | `/api/mikrotik/:nasId/queues` | List queues | ✅ |

### Router Wizard (`/api/wizard`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/wizard/start` | Start wizard | ✅ |
| GET | `/api/wizard/:token/status` | Poll status | ✅ |
| GET | `/api/wizard/:routerId/interfaces` | Get interfaces | ✅ |
| POST | `/api/wizard/:routerId/configure` | Configure router | ✅ |
| GET | `/api/wizard/:routerId/script` | Get config script | ✅ |
| POST | `/api/wizard/:routerId/auto-configure` | Auto configure | ✅ |

---

## Phase 5: Auxiliary Services ✅

### Vouchers (`/api/vouchers`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/vouchers` | List vouchers | ✅ |
| POST | `/api/vouchers` | Generate batch | ✅ |
| DELETE | `/api/vouchers/:id` | Revoke voucher | ✅ |
| POST | `/api/vouchers/redeem` | Redeem voucher (portal) | ❌ |

### SMS (`/api/sms`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/sms` | List SMS logs | ✅ |
| POST | `/api/sms` | Send SMS | ✅ |
| DELETE | `/api/sms` | Clear logs | ✅ |
| GET | `/api/sms/balance` | Check credits | ✅ |
| PUT | `/api/sms/settings` | Update settings | ✅ |

### Map (`/api/map`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/map/data` | Get map data | ✅ |

---

## Phase 6: Advanced Features ✅

### RADIUS Management (`/api/radius`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/radius/status` | RADIUS server status | ✅ |
| GET | `/api/radius/sessions` | List active sessions | ✅ |
| POST | `/api/radius/disconnect` | Disconnect session | ✅ |
| GET | `/api/radius/accounting` | Accounting records | ✅ |
| GET | `/api/radius/stats` | RADIUS statistics | ✅ |

### Hotspot Portal (`/api/portal`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/portal/packages` | List packages | ❌ (tenantId) |
| POST | `/api/portal/login` | Hotspot login | ❌ |
| POST | `/api/portal/logout` | Hotspot logout | ❌ |
| GET | `/api/portal/status` | Session status | ❌ |
| POST | `/api/portal/voucher` | Redeem voucher | ❌ |
| GET | `/api/portal/tenant` | Tenant branding | ❌ |

### WireGuard VPN (`/api/vpn`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/vpn/status` | VPN server status | ✅ |
| GET | `/api/vpn/peers` | List VPN peers | ✅ |
| POST | `/api/vpn/peers` | Create peer | ✅ |
| DELETE | `/api/vpn/peers/:id` | Delete peer | ✅ |
| GET | `/api/vpn/peers/:id/config` | Download config | ✅ |
| PUT | `/api/vpn/peers/:id/toggle` | Enable/disable | ✅ |

### SNMP Polling (`/api/snmp`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/snmp/status` | SNMP status | ✅ |
| GET | `/api/snmp/poll/:nasId` | Poll specific device | ✅ |
| GET | `/api/snmp/metrics` | Aggregated metrics | ✅ |
| POST | `/api/snmp/settings` | Update SNMP settings | ✅ |
| GET | `/api/snmp/alerts` | Device alerts | ✅ |

### Sessions (`/api/sessions`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/sessions` | List all sessions | ✅ |
| GET | `/api/sessions/stats` | Session statistics | ✅ |
| POST | `/api/sessions/sync` | Sync from RADIUS | ✅ |
| POST | `/api/sessions/cleanup` | Clean stale sessions | ✅ |
| GET | `/api/sessions/:id` | Session details | ✅ |
| DELETE | `/api/sessions/:id` | Terminate session | ✅ |

---

## Summary by Phase

| Phase | Status | Endpoints |
|-------|--------|-----------|
| Phase 1: Core Infrastructure | ✅ Complete | 20 |
| Phase 2: Customer & Package | ✅ Complete | 20 |
| Phase 3: Finance & Payments | ✅ Complete | 15 |
| Phase 4: Network & Routers | ✅ Complete | 19 |
| Phase 5: Auxiliary Services | ✅ Complete | 11 |
| Phase 6: Advanced Features | ✅ Complete | 28 |
| **Total** | ✅ **All Complete** | **112** |
