# Zero-Touch Router Wizard Module

## Overview

The Zero-Touch Wizard provides automated MikroTik router provisioning through a simple copy-paste command workflow. It generates provisioning scripts, handles router callbacks, and configures Hotspot and PPPoE services remotely.

**Source File**: `/root/easyisp/Backend/src/routes/wizard.routes.ts` (459 lines, 15.8 KB)

---

## What It Does in the System

1. **Router Creation** - Creates NAS record with generated credentials
2. **Provision Script Generation** - Creates one-line command for router setup
3. **Callback Handling** - Receives confirmation when router completes setup
4. **API Verification** - Tests router API connectivity
5. **System Info Retrieval** - Gets router model, version, resources
6. **Interface Discovery** - Lists router interfaces with WAN detection
7. **Service Configuration** - Configures Hotspot and/or PPPoE remotely

---

## Provisioning Flow

```
1. User Starts Wizard → POST /api/wizard/start
   ↓
2. System creates NAS with PENDING status, generates secret
   ↓
3. User copies provision command to router terminal
   ↓
4. Router fetches easyisp.rsc script from /provision/:token
   ↓
5. Router runs script (configures API user, RADIUS, NAS identity)
   ↓
6. Router calls GET /api/wizard/:routerId/provision-complete
   ↓
7. System updates NAS status to ONLINE, records IP
   ↓
8. User clicks Verify → GET /api/wizard/:routerId/verify
   ↓
9. User configures services → POST /api/wizard/:routerId/configure
```

---

## API Endpoints

### POST `/api/wizard/start`
**Purpose**: Start router provisioning

**Auth**: Required

**Request Body**:
```json
{
  "name": "Branch Office Router"
}
```

**Response** (200):
```json
{
  "routerId": "uuid",
  "token": "encrypted-base64-token",
  "secret": "0a1b2c3d4e5f6789abcdef0123456789",
  "provisionCommand": "/ip dns set servers=8.8.8.8,1.1.1.1; /ip service enable api,ftp; /system ntp client set enabled=yes servers=162.159.200.123; :delay 5s; /tool fetch mode=https url=\"https://113-30-190-52.cloud-xip.com/provision/abc123\" dst-path=easyisp.rsc; :delay 2s; /import easyisp.rsc;",
  "message": "Copy and paste the provision command into your MikroTik terminal."
}
```

**What It Creates**:
- NAS record with `status: 'PENDING'`, `ipAddress: '0.0.0.0'`
- Auto-generated 32-character hex RADIUS secret
- Encrypted provision token containing routerId, tenantId, secret

---

### GET `/api/wizard/:routerId/status`
**Purpose**: Check provisioning status

**Auth**: Required

**Response** (200):
```json
{
  "routerId": "uuid",
  "name": "Branch Office Router",
  "status": "ONLINE",
  "ipAddress": "203.0.113.50",
  "lastSeen": "2026-01-04T12:00:00Z",
  "isProvisioned": true
}
```

---

### GET `/api/wizard/:routerId/provision-complete`
**Purpose**: Callback from router when provisioning completes

**Auth**: None (router calls this)

**What It Does**:
1. Extracts router IP from `X-Forwarded-For` or `X-Real-IP` header
2. Updates NAS status to `ONLINE`
3. Records router's public IP address
4. Updates `lastSeen` timestamp

**Response**: Plain text "OK"

---

### GET `/api/wizard/:routerId/script`
**Purpose**: Get provision script for manual download

**Auth**: Required

**Response** (200):
```json
{
  "routerId": "uuid",
  "routerName": "Branch Office Router",
  "secret": "0a1b2c3d4e5f6789...",
  "provisionCommand": "/tool fetch mode=https url=\"...\" dst-path=easyisp.rsc; :delay 2s; /import easyisp.rsc;"
}
```

---

### GET `/api/wizard/:routerId/verify`
**Purpose**: Verify router is online and API is reachable

**Auth**: Required

**Response** (200) - Success:
```json
{
  "online": true,
  "apiReachable": true,
  "message": "Router is online and API is reachable!"
}
```

**Response** (200) - Failure:
```json
{
  "online": false,
  "apiReachable": false,
  "message": "Cannot reach router API at 203.0.113.50:8728. Error: Connection refused",
  "debug": {
    "routerIp": "203.0.113.50",
    "vpnIp": null,
    "apiPort": 8728,
    "hasApiCredentials": true,
    "errorDetail": "Connection refused"
  }
}
```

---

### GET `/api/wizard/:routerId/system-info`
**Purpose**: Get router system resources

**Auth**: Required

**Response** (200):
```json
{
  "uptime": "5d12h30m15s",
  "version": "7.12.1",
  "buildTime": "2025-01-01 12:00:00",
  "factorySoftware": "7.10",
  "freeMemory": 134217728,
  "totalMemory": 268435456,
  "cpu": "ARM",
  "cpuCount": 4,
  "cpuFrequency": 1200,
  "cpuLoad": 15,
  "freeHddSpace": 10485760,
  "totalHddSpace": 16777216,
  "architectureName": "arm64",
  "boardName": "RB5009UG+S+",
  "platform": "MikroTik"
}
```

**Side Effect**: Updates NAS record with board name, version, CPU load, memory usage, uptime.

---

### GET `/api/wizard/:routerId/interfaces`
**Purpose**: Get router interfaces for configuration

**Auth**: Required

**Response** (200):
```json
{
  "interfaces": [
    {
      "id": "*1",
      "name": "ether1",
      "type": "ether",
      "macAddress": "00:11:22:33:44:55",
      "running": true,
      "disabled": false,
      "comment": "",
      "isWan": true
    },
    {
      "id": "*2",
      "name": "ether2",
      "type": "ether",
      "macAddress": "00:11:22:33:44:56",
      "running": true,
      "disabled": false,
      "comment": "",
      "isWan": false
    }
  ],
  "wanInterface": "ether1"
}
```

**WAN Detection**: Checks which interface has the default route (`0.0.0.0/0`).

---

### POST `/api/wizard/:routerId/configure`
**Purpose**: Apply service configuration

**Auth**: Required

**Request Body**:
```json
{
  "serviceType": "both",
  "wanInterface": "ether1",
  "createBackup": true,
  "configureFirewall": true,
  "hotspotConfig": {
    "interfaces": ["wlan1", "wlan2"],
    "gatewayIp": "10.5.50.1",
    "poolStart": "10.5.50.2",
    "poolEnd": "10.5.50.254",
    "dnsServers": ["8.8.8.8", "1.1.1.1"]
  },
  "pppoeConfig": {
    "interfaces": ["ether2"],
    "serviceName": "easyisp-pppoe",
    "localAddress": "10.10.10.1",
    "poolStart": "10.10.10.2",
    "poolEnd": "10.10.10.254"
  }
}
```

**Service Types**: `hotspot`, `pppoe`, `both`

**Response** (200):
```json
{
  "success": true,
  "message": "Configuration applied successfully",
  "results": [
    "Backup created: easyisp-backup-1704369600000",
    "Firewall NAT configured",
    "Hotspot configured on: wlan1, wlan2",
    "PPPoE configured on: ether2"
  ],
  "testResult": {
    "hotspot": true,
    "pppoe": true,
    "radius": true
  }
}
```

**What It Configures**:
1. Creates router backup
2. Adds NAT masquerade on WAN interface
3. Configures Hotspot (bridge, pool, DHCP, DNS, profile, walled garden, captive portal)
4. Configures PPPoE (pool, profile, server)
5. Tests configuration

---

### GET `/api/wizard/:routerId/test`
**Purpose**: Test what services are configured on router

**Auth**: Required

**Response** (200):
```json
{
  "hotspot": true,
  "pppoe": true,
  "radius": true
}
```

---

## What's Complete ✅

1. ✅ Router creation with auto-generated credentials
2. ✅ One-line provision command generation
3. ✅ Encrypted token for secure provisioning
4. ✅ Callback handling with IP detection
5. ✅ Status polling
6. ✅ API verification
7. ✅ System resource retrieval
8. ✅ Interface discovery with WAN detection
9. ✅ Hotspot configuration
10. ✅ PPPoE configuration
11. ✅ Configuration backup
12. ✅ NAT firewall setup
13. ✅ Configuration testing
14. ✅ Secure Password-based Callback
15. ✅ Automatic Rollback on Configuration Failure
16. ✅ **Wireless Configuration** - WiFi setup with security profiles
17. ✅ **Firmware Management** - Check and update RouterOS packages
18. ✅ **Wizard Resume/Recovery** - Save and restore wizard progress

---

## New Endpoints (Wireless)

### GET `/api/wizard/:routerId/wireless`
Get available wireless interfaces and security profiles

### POST `/api/wizard/:routerId/configure-wireless`
Configure wireless settings (SSID, password, channel)

---

## New Endpoints (Firmware)

### GET `/api/wizard/:routerId/firmware`
Get current firmware info and available updates

### POST `/api/wizard/:routerId/firmware/check`
Check for available updates

### POST `/api/wizard/:routerId/firmware/update`
Trigger firmware update (handles router reboot)

---

## New Endpoints (Wizard Resume)

### POST `/api/wizard/:routerId/save-state`
Save wizard progress for later resumption

### GET `/api/wizard/:routerId/resume`
Resume wizard from last saved step

---

## What's NOT Complete ⚠️

1. ⚠️ **Certificate Upload** - No SSL certificate management
2. ⚠️ **Bulk Provisioning** - One router at a time only
3. ⚠️ **Template System** - No pre-configured templates

---

## What's Working ✅

All implemented features are functional:
- Full provisioning flow ✓
- Service configuration ✓
- Interface discovery ✓
- System info retrieval ✓
- Wireless configuration ✓
- Firmware management ✓
- Wizard resume ✓

---

## Test Coverage (NEW)

| Test File | Tests |
|-----------|-------|
| `zero-touch.integration.test.ts` | 30 ✅ |

---

## What's NOT Working ❌

No critical issues found.

---

## Security Issues 🔐

### Medium

1. **Provision Callback No Auth**
   - Any request can mark router as provisioned
   - **Mitigation**: Include token in callback or verify IP

2. **Secret in Response**
   - RADIUS secret returned in API responses
   - **Mitigation**: Only show once on creation

---

## Environment Variables

```bash
API_BASE_URL=https://113-30-190-52.cloud-xip.com  # For provision URLs
RADIUS_SERVER=113.30.190.52                       # RADIUS server IP for config
```

---

## Possible Improvements 🚀

### High Priority

1. **Secure Callback**
   ```typescript
   // Include token in callback URL
   const callbackUrl = `${baseUrl}/api/wizard/${routerId}/provision-complete?token=${token}`;
   ```

2. **Rollback on Failure**
   ```typescript
   // Restore backup if configuration fails
   await mikrotikService.restoreBackup(nas, backupName);
   ```

### Medium Priority

3. **Wireless Configuration**
4. **Progress Streaming** via WebSocket

---

## Related Modules

- **NAS Management** - Creates NAS records
- **MikroTik Integration** - Executes router commands
- **Provision Routes** - Serves provisioning scripts
