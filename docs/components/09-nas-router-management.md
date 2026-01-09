# NAS/Router Management Module

## Overview

The NAS (Network Access Server) Management module handles router registration, configuration, and monitoring. It's the central registry for all MikroTik routers in the system, storing connection details, RADIUS secrets, API credentials, and health status.

**Source File**: `/root/easyisp/Backend/src/routes/nas.routes.ts` (381 lines, 10.7 KB)

---

## What It Does in the System

1. **Router Registration** - Add new routers with IP, secrets, and credentials
2. **CRUD Operations** - Full create, read, update, delete for routers
3. **Status Tracking** - Monitor online/offline status, last seen timestamp
4. **Customer Counting** - Track how many customers are on each router
5. **Configuration Generation** - Create MikroTik RADIUS setup scripts
6. **Live Status** - Get real-time CPU, memory, uptime (from stored values)
7. **Connection Testing** - Verify router connectivity

---

## Data Model

```typescript
interface NAS {
  id: string;
  name: string;
  boardName?: string;        // MikroTik board model
  ipAddress: string;         // Public IP
  vpnIp?: string;            // VPN tunnel IP (for management)
  secret: string;            // RADIUS shared secret
  coaPort: number;           // CoA port (default: 3799)
  apiUsername?: string;      // RouterOS API username
  apiPassword?: string;      // RouterOS API password
  apiPort: number;           // API port (default: 8728)
  latitude?: number;         // GPS coordinates
  longitude?: number;
  location?: string;         // Text address
  status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
  cpuLoad?: number;
  memoryUsage?: number;
  memoryTotal?: number;
  uptime?: string;
  routerOsVersion?: string;
  lastSeen?: Date;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}
```

---

## API Endpoints

### GET `/api/nas`
**Purpose**: List all routers with pagination and search

**Auth**: Required  
**Permission**: `routers:view`

**Query Parameters**:
- `page` (default: 1)
- `pageSize` (default: 10)
- `search` - Search by name or IP (case-insensitive)
- `status` - Filter by status (ONLINE, OFFLINE)

**Response** (200):
```json
{
  "routers": [
    {
      "id": "uuid",
      "name": "Main Router",
      "boardName": "RB750Gr3",
      "ipAddress": "203.0.113.1",
      "status": "ONLINE",
      "cpuLoad": 15,
      "memoryUsage": 128000000,
      "memoryTotal": 256000000,
      "uptime": "5d12h30m",
      "routerOsVersion": "7.12.1",
      "customerCount": 145,
      "lastSeen": "2026-01-04T12:00:00Z",
      "createdAt": "2025-01-01T00:00:00Z"
    }
  ],
  "total": 5,
  "page": 1,
  "pageSize": 10
}
```

---

### GET `/api/nas/:id`
**Purpose**: Get detailed router information

**Auth**: Required  
**Permission**: `routers:details_view`

**Response** (200):
```json
{
  "id": "uuid",
  "name": "Main Router",
  "boardName": "RB750Gr3",
  "ipAddress": "203.0.113.1",
  "secret": "********",        // Always masked
  "coaPort": 3799,
  "apiUsername": "admin",
  "apiPort": 8728,
  "status": "ONLINE",
  "cpuLoad": 15,
  "memoryUsage": 128000000,
  "memoryTotal": 256000000,
  "uptime": "5d12h30m",
  "routerOsVersion": "7.12.1",
  "latitude": -1.2921,
  "longitude": 36.8219,
  "location": "Nairobi Office",
  "customerCount": 145,
  "lastSeen": "2026-01-04T12:00:00Z",
  "createdAt": "2025-01-01T00:00:00Z"
}
```

**Note**: RADIUS secret is always returned as `********` for security.

---

### POST `/api/nas`
**Purpose**: Register a new router

**Auth**: Required  
**Permission**: `routers:add`

**Request Body**:
```json
{
  "name": "Branch Router",
  "ipAddress": "203.0.113.2",
  "secret": "MyRadiusSecret123",
  "coaPort": 3799,
  "apiUsername": "admin",
  "apiPassword": "routerPassword",
  "apiPort": 8728,
  "latitude": -1.2921,
  "longitude": 36.8219,
  "location": "Branch Office"
}
```

**Validation**:
- `name`: Required, min 1 character
- `ipAddress`: Required, valid IP address
- `secret`: Required, min 4 characters
- `coaPort`: Optional (default: 3799)
- `apiUsername`: Optional
- `apiPassword`: Optional
- `apiPort`: Optional (default: 8728)
- `latitude`, `longitude`: Optional numbers
- `location`: Optional string

**Business Rules**:
- IP address must be unique within tenant
- Duplicate IP returns 409 Conflict

**Response** (201):
```json
{
  "id": "uuid",
  "name": "Branch Router",
  "ipAddress": "203.0.113.2",
  "status": "UNKNOWN"
}
```

**Audit Log**: `ROUTER_CREATE`

---

### PUT `/api/nas/:id`
**Purpose**: Update router details

**Auth**: Required  
**Permission**: `routers:edit`

**Request Body**: Same as POST (all fields optional)

**Business Rules**:
- Cannot change IP to one that's already used by another router
- Changing IP checks for duplicates within tenant

**Response** (200):
```json
{
  "id": "uuid",
  "name": "Branch Router",
  "ipAddress": "203.0.113.2",
  "status": "ONLINE"
}
```

**Audit Log**: `ROUTER_UPDATE`

---

### DELETE `/api/nas/:id`
**Purpose**: Delete a router

**Auth**: Required  
**Permission**: `routers:delete`

**Business Rules**:
1. **Cannot delete router with customers** - Must migrate customers first
2. Deletes associated `PackageRouter` entries (package-router assignments)

**Response** (200):
```json
{
  "success": true
}
```

**Error** (400):
```json
{
  "error": "Cannot delete router with active customers"
}
```

**Audit Log**: `ROUTER_DELETE`

---

### POST `/api/nas/:id/test`
**Purpose**: Test router connectivity

**Auth**: Required  
**Permission**: `routers:test`

**What It Does**:
1. ~~Pings router or tests API connection~~ (TODO: Currently returns mock success)
2. Updates status to ONLINE and sets lastSeen on success

**Response** (200):
```json
{
  "success": true,
  "message": "Connection successful",
  "status": "ONLINE"
}
```

**Current Limitation**: Always returns success. Real implementation should use `mikrotikService.pingRouter()`.

---

### GET `/api/nas/:id/live-status`
**Purpose**: Get real-time router status

**Auth**: Required  
**Permission**: `routers:details_view`

**What It Does**:
1. Returns stored CPU, memory, uptime values (from last SNMP/API poll)
2. Counts active sessions from Session table

**Response** (200):
```json
{
  "id": "uuid",
  "name": "Main Router",
  "status": "ONLINE",
  "cpuLoad": 15,
  "memoryUsage": 128000000,
  "memoryTotal": 256000000,
  "uptime": "5d12h30m",
  "activeSessions": 145,
  "lastSeen": "2026-01-04T12:00:00Z"
}
```

**Note**: Returns **stored** values, not real-time API call. Real-time stats require integration with MikroTik service.

---

### GET `/api/nas/:id/config`
**Purpose**: Generate RADIUS configuration script for MikroTik

**Auth**: Required  
**Permission**: `routers:config`

**Response** (200):
```json
{
  "routerId": "uuid",
  "routerName": "Main Router",
  "script": "# EasyISP RADIUS Configuration for Main Router\n# Generated: 2026-01-04T12:00:00Z\n\n/radius\nadd address=10.0.0.5 secret=\"radiusSecret\" service=hotspot,login,ppp authentication-port=1812 accounting-port=1813 timeout=3000ms\n\n/ppp aaa\nset use-radius=yes accounting=yes interim-update=5m\n\n/user aaa\nset use-radius=yes accounting=yes interim-update=5m\n\n# Hotspot Configuration (if applicable)\n/ip hotspot profile\nset [ find default=yes ] use-radius=yes radius-interim-update=5m\n\n# CoA Settings\n/radius incoming\nset accept=yes port=3799"
}
```

**Environment Variables Used**:
- `RADIUS_SERVER` - RADIUS server IP
- `RADIUS_PORT` - Auth port (default: 1812)
- `RADIUS_ACCT_PORT` - Accounting port (default: 1813)

---

## What's Complete ✅

1. ✅ Full CRUD operations (create, read, update, delete)
2. ✅ Pagination and search
3. ✅ Status filtering (ONLINE/OFFLINE)
4. ✅ Customer count per router
5. ✅ Duplicate IP prevention
6. ✅ RADIUS configuration script generation
7. ✅ Secret masking in GET responses
8. ✅ GPS coordinates storage
9. ✅ Location text storage
10. ✅ Audit logging for all mutations
11. ✅ Active session counting
12. ✅ Protection against deleting routers with customers
13. ✅ Package-router association cleanup on delete

---

## What's NOT Complete ⚠️

1. ⚠️ **Real Connection Test** - `POST /test` always returns success (see line 283: `const isReachable = true; // Would be actual ping/API test`)
2. ⚠️ **Live Status Polling** - Returns stored values, not real-time API call
3. ⚠️ **Automated Health Checks** - No background job to poll routers
4. ⚠️ **Firmware Version Tracking** - Stored but not updated automatically
5. ⚠️ **Router Grouping** - No way to group routers by location/region
6. ⚠️ **Bandwidth Aggregation** - No total bandwidth per router

---

## What's Working ✅

All CRUD operations are functional:
- Create router with all fields
- Search and filter
- Update router details  
- Delete with protection
- Config script generation

---

## What's NOT Working ❌

1. **Connection Test (POST /test)**
   - Always returns `success: true`
   - Should use `mikrotikService.pingRouter(nas.ipAddress)`
   - **Fix Required**:
   ```typescript
   const { mikrotikService } = await import('../services/mikrotik.service.js');
   const result = await mikrotikService.pingRouter(nas.vpnIp || nas.ipAddress);
   const isReachable = result.reachable;
   ```

2. **Live Status (GET /live-status)**
   - Returns stored database values
   - Should call MikroTik API for real-time data
   - **Fix Required**:
   ```typescript
   const resources = await mikrotikService.getSystemResources(nas);
   return c.json({
       cpuLoad: resources.cpuLoad,
       memoryUsage: resources.totalMemory - resources.freeMemory,
       // ...
   });
   ```

---

## Security Issues 🔐

### Medium

1. **API Password Stored in Plaintext**
   - **Location**: `NAS.apiPassword` in database
   - **Risk**: Router compromise if DB breached
   - **Mitigation**: Encrypt with AES-256

2. **RADIUS Secret Stored in Plaintext**
   - **Location**: `NAS.secret` in database
   - **Risk**: RADIUS impersonation
   - **Mitigation**: Encrypt credentials

3. **Secret Visible in Config Script**
   - **Location**: GET `/api/nas/:id/config` returns secret in script
   - **Risk**: Anyone with `routers:config` permission sees secret
   - **Mitigation**: Require separate permission or MFA

### Low

4. **No Rate Limiting**
   - **Risk**: Enumeration of router IPs
   - **Mitigation**: Add rate limiting to list endpoint

---

## Possible Improvements 🚀

### High Priority

1. **Implement Real Connection Test**
   ```typescript
   // In POST /api/nas/:id/test
   const { mikrotikService } = await import('../services/mikrotik.service.js');
   const result = await mikrotikService.pingRouter(nas.vpnIp || nas.ipAddress);
   
   if (result.reachable) {
       await prisma.nAS.update({
           where: { id: nasId },
           data: { status: 'ONLINE', lastSeen: new Date() }
       });
   } else {
       await prisma.nAS.update({
           where: { id: nasId },
           data: { status: 'OFFLINE' }
       });
   }
   
   return c.json({
       success: result.reachable,
       message: result.reachable ? 'Connection successful' : result.error,
       latencyMs: result.latencyMs,
       status: result.reachable ? 'ONLINE' : 'OFFLINE'
   });
   ```

2. **Background Health Check Job**
   ```typescript
   // Cron job every 5 minutes
   cron.schedule('*/5 * * * *', async () => {
       const routers = await prisma.nAS.findMany();
       for (const nas of routers) {
           const result = await mikrotikService.pingRouter(nas.ipAddress);
           await prisma.nAS.update({
               where: { id: nas.id },
               data: {
                   status: result.reachable ? 'ONLINE' : 'OFFLINE',
                   lastSeen: result.reachable ? new Date() : undefined
               }
           });
       }
   });
   ```

3. **Encrypt Credentials**
   ```typescript
   import { encrypt, decrypt } from '../lib/crypto.js';
   
   // On create/update
   data.apiPassword = encrypt(data.apiPassword, ENCRYPTION_KEY);
   data.secret = encrypt(data.secret, ENCRYPTION_KEY);
   
   // On use
   const decryptedPassword = decrypt(nas.apiPassword, ENCRYPTION_KEY);
   ```

### Medium Priority

4. **Router Groups**
   ```typescript
   // Add to schema
   model RouterGroup {
       id      String @id @default(uuid())
       name    String
       routers NAS[]
   }
   ```

5. **Real-time Live Status**
   ```typescript
   // In GET /live-status
   const resources = await mikrotikService.getSystemResources(nas);
   const sessions = await mikrotikService.getActiveSessions(nas);
   
   // Update stored values
   await prisma.nAS.update({
       where: { id: nasId },
       data: {
           cpuLoad: resources.cpuLoad,
           memoryUsage: resources.totalMemory - resources.freeMemory,
           uptime: resources.uptime,
           routerOsVersion: resources.version,
           lastSeen: new Date()
       }
   });
   ```

6. **Bulk Operations**
   ```typescript
   // Restart all routers in group
   POST /api/nas/group/:groupId/restart
   
   // Update RADIUS config on all routers
   POST /api/nas/bulk/reconfigure
   ```

---

## Related Modules

- **MikroTik Integration** - Uses NAS info for API connections
- **RADIUS Server** - Looks up NAS by IP for authentication
- **Session Management** - Sessions linked to NAS
- **Customer Management** - Customers assigned to NAS
- **Package Management** - Packages linked to routers via PackageRouter
- **Wizard Routes** - Uses NAS for provisioning
- **SNMP Monitoring** - Polls NAS for metrics

---

## Environment Variables

```bash
RADIUS_SERVER=10.0.0.5      # RADIUS server IP for config script
RADIUS_PORT=1812            # Auth port
RADIUS_ACCT_PORT=1813       # Accounting port
```

---

## Testing Recommendations

1. **Unit Tests**
   - IP address validation
   - Duplicate IP detection
   - Customer count aggregation

2. **Integration Tests**
   - Create/update/delete router
   - Search and filtering
   - Config script generation

3. **E2E Tests**
   - Register router → test connection → delete
   - Attempt delete router with customers (should fail)

---

## Migration Path

1. **Immediate** (Week 1):
   - Implement real connection test using mikrotikService
   - Add encryption for apiPassword and secret

2. **Short-term** (Month 1):
   - Add background health check cron job
   - Implement real-time live status

3. **Long-term** (Quarter 1):
   - Add router groups
   - Implement bulk operations
   - Add firmware update tracking
