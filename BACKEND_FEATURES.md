# EasyISP Backend - Comprehensive Feature List

> **Generated:** December 23, 2025  
> **Version:** 1.0.0

---

## 🏗️ Core Architecture

| Component | Technology |
|-----------|------------|
| **Framework** | Hono (lightweight Node.js web framework) |
| **Database** | PostgreSQL via Prisma ORM |
| **Authentication** | JWT-based with bcrypt password hashing |
| **Multi-Tenancy** | Full tenant isolation across all entities |

---

## 🔐 1. Authentication & Authorization

- User login/logout with JWT tokens
- User registration (creates tenant + admin user)
- Token refresh mechanism
- Password change functionality
- Role-based access control: `SUPER_ADMIN`, `ADMIN`, `STAFF`, `VIEWER`

---

## 📡 2. RADIUS Server (RFC 2865/2866/5176 Compliant)

| Feature | Details |
|---------|---------|
| **Authentication** | PAP/CHAP authentication for PPPoE & Hotspot |
| **Accounting** | Session start/stop/interim update tracking |
| **CoA (Change of Authorization)** | Disconnect and modify active sessions |
| **Rate Limiting** | Built-in request rate limiter |
| **NAS Caching** | Efficient NAS lookup with TTL-based cache |
| **WebSocket Bridge** | Real-time RADIUS event streaming |

---

## 👥 3. Customer Management

- Full CRUD for PPPoE and Hotspot customers
- Connection types: `PPPOE`, `HOTSPOT`, `DHCP`, `STATIC`
- Speed settings: download/upload/burst speeds with priority
- Data limits and session limits
- Real-time online/offline status tracking
- MAC address binding
- Static IP or IP pool assignment
- Customer status: `ACTIVE`, `SUSPENDED`, `EXPIRED`, `DISABLED`
- Location tracking (latitude/longitude for map module)

---

## 📦 4. Package Management

- Tiered service packages with pricing
- Per-connection-type packages (PPPoE/Hotspot)
- Configurable speed profiles (bandwidth limits)
- Data quotas and session time limits
- Burst settings for MikroTik
- Router-specific package assignment

---

## 🎫 5. Voucher System

- Single & bulk voucher generation
- Customizable code prefixes
- Voucher statuses: `AVAILABLE`, `USED`, `EXPIRED`, `REVOKED`
- Package-linked vouchers
- Validity period configuration
- Session disconnect for voucher users
- MAC reset functionality
- Counter reset functionality
- Batch management

---

## 🌐 6. NAS/Router Management

- Router onboarding with configuration generation
- Automatic VPN tunnel IP assignment
- Certificate generation (for RouterOS v7+)
- Support for RouterOS v6 (legacy) and v7+
- MikroTik-specific configuration templates
- RADIUS shared secret management
- CoA port configuration
- API credentials storage (for MikroTik API)

---

## 🔧 7. MikroTik API Integration

| Capability | Description |
|------------|-------------|
| **System Stats** | CPU, memory, uptime, board info |
| **Interface Management** | List all router interfaces |
| **Queue Management** | Simple queues and queue trees |
| **DHCP Leases** | View active DHCP leases |
| **Firewall Rules** | NAT and filter rule management |
| **PPP Secrets** | Add/remove PPPoE user credentials |
| **Hotspot Users** | Add/remove hotspot users |
| **User Disconnect** | Force disconnect users |
| **Router Logs** | View router system logs |
| **Health Monitoring** | Temperature, voltage, fan speed sensors |
| **Bandwidth Monitoring** | Real-time interface traffic |
| **Netwatch** | Network host monitoring |

---

## 🛡️ 8. VPN Service (IKEv2/IPsec)

- IKEv2 VPN for secure router connections
- Certificate-based authentication (RouterOS v7+)
- PSK fallback for RouterOS v6
- StrongSwan integration
- VPN tunnel IP pool management
- VPN status tracking: `CONNECTED`, `DISCONNECTED`, `CONNECTING`, `ERROR`

---

## 🧙 9. Zero-Touch Router Wizard

- Automated router bootstrap script generation
- WebSocket-based progress updates
- Router auto-discovery (interfaces, system info)
- Auto-configuration with RADIUS and VPN setup
- Downloadable configuration scripts (.rsc)
- Token-based secure registration

---

## 📊 10. Dashboard & Analytics

- Active sessions count (by connection type)
- Total customers (PPPoE/Hotspot breakdown)
- Monthly and daily revenue aggregation
- Revenue trend (last 6 months)
- Voucher statistics

---

## 🌡️ 11. SNMP Monitoring

- Periodic router polling
- Metrics collected:
  - CPU load
  - Memory usage
  - Active PPPoE/Hotspot sessions
  - Total traffic (bytes in/out)
  - Latency/reachability
- Configurable poll interval
- Historical metrics storage

---

## 💳 12. Payment Tracking

- Payment methods: `CASH`, `MPESA`, `BANK_TRANSFER`, `CARD`, `Other`
- Payment statuses: `PENDING`, `COMPLETED`, `FAILED`, `REFUNDED`
- Customer and package linkage
- Revenue reporting

---

## 🎨 13. Hotspot Captive Portal

- Dynamic portal generation
- Tenant-specific branding (logo, colors, CSS)
- Package display for self-service
- Voucher redemption API
- Welcome message customization
- Terms & privacy URL configuration
- Redirect URL after login

---

## 📋 14. Session Management

- Real-time active session listing
- Session statistics
- Stale session auto-cleanup (configurable timeout)
- Manual session close (by ID, customer, or NAS)
- Accounting data (input/output octets, packets, session time)

---

## 🔧 15. Additional Services

| Service | Purpose |
|---------|---------|
| **Certificate Service** | Generate router certificates (CA + client certs) |
| **Cache Service** | In-memory caching layer |
| **Circuit Breaker** | Fault tolerance for external calls |
| **Cluster Service** | Multi-process clustering for production |
| **Logger Service** | Structured logging with context |
| **Metrics Service** | Performance and usage metrics |
| **Queue Service** | Background job processing |
| **Session Sync Service** | Auto-close stale sessions |
| **Startup Service** | Initialization and health checks |

---

## 🗄️ Database Schema (16 Models)

| Model | Purpose |
|-------|---------|
| `Tenant` | Multi-tenant organization |
| `User` | Admin/staff accounts |
| `Customer` | End users (PPPoE/Hotspot) |
| `Package` | Service plans |
| `NAS` | Network Access Servers (routers) |
| `NASMetrics` | Router SNMP metrics |
| `Session` | Active/historical connections |
| `HotspotPortal` | Portal branding config |
| `Voucher` | Prepaid access codes |
| `IPPool` | Dynamic IP address pools |
| `IPAssignment` | IP-to-customer mappings |
| `MACAuth` | MAC-based authentication |
| `RadiusLog` | Authentication/accounting logs |
| `Settings` | Tenant-specific settings |
| `Payment` | Payment records |

---

## 🚀 Deployment Features

- Development mode with hot reload (`tsx watch`)
- Production clustering support
- Environment-based configuration
- Graceful shutdown handling
- Uncaught exception handling
- Prisma migrations for database versioning

---

## API Endpoints Summary

### Auth (`/api/auth`)
- `POST /login` - User login
- `POST /register` - User registration
- `POST /logout` - User logout
- `POST /refresh` - Token refresh
- `PUT /password` - Change password
- `GET /me` - Get current user

### Dashboard (`/api/dashboard`)
- `GET /stats` - Dashboard statistics

### Customers (`/api/customers`)
- `GET /` - List customers
- `POST /` - Create customer
- `GET /:id` - Get customer details
- `PUT /:id` - Update customer
- `DELETE /:id` - Delete customer

### Packages (`/api/packages`)
- `GET /` - List packages
- `POST /` - Create package
- `GET /:id` - Get package details
- `PUT /:id` - Update package
- `DELETE /:id` - Delete package

### NAS/Routers (`/api/nas`)
- `GET /` - List NAS devices
- `POST /` - Onboard new router
- `GET /:id` - Get NAS details
- `PUT /:id` - Update NAS
- `DELETE /:id` - Delete NAS

### Vouchers (`/api/vouchers`)
- `GET /` - List vouchers
- `POST /` - Generate vouchers
- `GET /:id` - Get voucher details
- `DELETE /:id` - Delete voucher
- `DELETE /expired` - Delete expired vouchers
- `DELETE /unused` - Delete unused vouchers
- `POST /:id/disconnect` - Disconnect session
- `POST /:id/reset-counters` - Reset counters

### Sessions (`/api/sessions`)
- `GET /` - List active sessions
- `GET /stats` - Session statistics
- `POST /sync` - Sync stale sessions
- `POST /:id/close` - Close session
- `POST /close-customer/:customerId` - Close customer sessions
- `POST /close-nas/:nasId` - Close NAS sessions

### MikroTik (`/api/mikrotik`)
- `GET /:nasId/status` - Router connection status
- `GET /:nasId/system-stats` - System statistics
- `GET /:nasId/interfaces` - Interfaces list
- `GET /:nasId/queues` - Queues
- `GET /:nasId/dhcp-leases` - DHCP leases
- `GET /:nasId/firewall/filter` - Firewall filter rules
- `GET /:nasId/firewall/nat` - NAT rules
- `GET /:nasId/ppp-secrets` - PPP secrets
- `POST /:nasId/ppp-secrets` - Add PPP secret
- `DELETE /:nasId/ppp-secrets/:name` - Remove PPP secret
- `GET /:nasId/hotspot-users` - Hotspot users
- `POST /:nasId/hotspot-users` - Add hotspot user
- `DELETE /:nasId/hotspot-users/:name` - Remove hotspot user
- `POST /:nasId/disconnect` - Disconnect user

### Wizard (`/api/wizard`)
- `POST /start` - Start wizard
- `POST /:token/ready` - Router registration callback
- `GET /:nasId/status` - Wizard status
- `POST /:nasId/auto-configure` - Execute auto-config
- `GET /:nasId/script` - Get config script

### Hotspot Portal (`/api/hotspot`)
- `GET /portal` - Captive portal page
- `POST /login` - Voucher login
- `GET /packages` - Available packages
- `GET /session` - Current session info

### VPN (`/api/vpn`)
- `GET /status` - VPN service status
- `GET /connections` - Active VPN connections
- `POST /disconnect/:nasId` - Disconnect router VPN

### Health (`/health`)
- `GET /` - Overall health status
- `GET /ready` - Readiness check
- `GET /live` - Liveness check

---

> **Note:** This is a production-grade ISP management system with comprehensive MikroTik integration, suitable for managing both PPPoE (fixed broadband) and Hotspot (WiFi/voucher) customers.
