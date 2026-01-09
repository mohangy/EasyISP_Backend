# MikroTik API Integration Module

## Overview

The MikroTik API Integration module provides deep integration with MikroTik RouterOS devices using the **routeros-client** library (socket API). It handles connection management, session control, bandwidth management, and full router provisioning for both Hotspot and PPPoE configurations.

**Source File**: `/root/easyisp/Backend/src/services/mikrotik.service.ts` (929 lines, 33 KB)

---

## Architecture

### Connection Management

The service maintains a **connection pool** (`Map<string, RouterOSAPI>`) that reuses connections to routers:

```typescript
private connections: Map<string, RouterOSAPI> = new Map();

private async getConnection(nas: NASInfo): Promise<RouterOSAPI> {
    // Check for existing connection
    const existing = this.connections.get(nas.id);
    if (existing) {
        try {
            // Test if connection is still alive
            await existing.write('/system/identity/print');
            return existing;
        } catch {
            // Connection dead, remove it
            this.connections.delete(nas.id);
        }
    }
    
    // Create new connection
    const host = (nas.vpnIp && nas.vpnIp !== '0.0.0.0') ? nas.vpnIp : nas.ipAddress;
    const api = new RouterOSAPI({
        host: host,
        port: nas.apiPort || 8728,
        user: nas.apiUsername,
        password: nas.apiPassword,
        timeout: 10000,  // 10 second timeout
    });
    
    await api.connect();
    this.connections.set(nas.id, api);
    return api;
}
```

**Key Features**:
- Prefers **VPN IP** over public IP when available
- Default API port: **8728**
- Connection timeout: **10 seconds**
- Connection reuse with liveness check via `/system/identity/print`

---

## Exported Interfaces

```typescript
interface NASInfo {
    id: string;
    name: string;
    ipAddress: string;
    apiUsername?: string | null;
    apiPassword?: string | null;
    apiPort: number;
    vpnIp?: string | null;
    tenantId?: string;
}

interface PPPoESession {
    id: string;           // MikroTik internal ID (e.g., "*1")
    name: string;         // Username
    service: string;      // Service name (e.g., "pppoe")
    callerId: string;     // MAC address
    address: string;      // Assigned IP
    uptime: string;       // e.g., "2h30m15s"
    encoding: string;
    sessionId: string;    // Acct-Session-Id for RADIUS
}

interface BandwidthStats {
    txBps: number;        // Transmit bytes per second
    rxBps: number;        // Receive bytes per second
    txPackets: number;
    rxPackets: number;
}

interface SystemResources {
    uptime: string;
    version: string;
    buildTime: string;
    factorySoftware: string;
    freeMemory: number;
    totalMemory: number;
    cpu: string;
    cpuCount: number;
    cpuFrequency: number;
    cpuLoad: number;
    freeHddSpace: number;
    totalHddSpace: number;
    architectureName: string;
    boardName: string;
    platform: string;
}

interface RouterInterface {
    id: string;
    name: string;
    type: string;
    macAddress: string;
    running: boolean;
    disabled: boolean;
    comment: string;
    isWan: boolean;  // Detected via default route
}
```

---

## Implemented Methods

### Session Management

| Method | RouterOS API | Description |
|--------|-------------|-------------|
| `getActiveSessions(nas)` | `/ppp/active/print` | List all active PPPoE sessions |
| `findActiveSession(nas, username)` | - | Find specific user's session |
| `disconnectUser(nas, username)` | `/ppp/active/remove` | Force disconnect user |

**Disconnect Implementation**:
```typescript
async disconnectUser(nas: NASInfo, username: string): Promise<boolean> {
    const api = await this.getConnection(nas);
    
    // Find the active session
    const sessions = await api.write('/ppp/active/print', [
        `?name=${username}`
    ]);
    
    if (sessions.length === 0) {
        return false;
    }
    
    // Remove the session
    await api.write('/ppp/active/remove', [
        `=.id=${sessions[0]['.id']}`
    ]);
    
    return true;
}
```

---

### PPP Secret Management

| Method | RouterOS API | Description |
|--------|-------------|-------------|
| `clearMacBinding(nas, username)` | `/ppp/secret/set caller-id=` | Remove MAC lock |
| `lockMacAddress(nas, username, mac)` | `/ppp/secret/set caller-id=XX:XX` | Lock to specific MAC |
| `assignStaticIp(nas, username, ip)` | `/ppp/secret/set remote-address=IP` | Assign static IP |

---

### Queue/Bandwidth Management

| Method | RouterOS API | Description |
|--------|-------------|-------------|
| `setUserQueue(nas, username, dl, ul)` | `/queue/simple/add` or `/set` | Set/update speed limits |
| `setTemporaryBoost(...)` | `/queue/simple/set` + `/system/scheduler/add` | Temporary speed boost with auto-revert |
| `getUserBandwidth(nas, username)` | `/interface/monitor-traffic` | Real-time bandwidth |

**Queue Implementation**:
```typescript
async setUserQueue(nas, username, downloadMbps, uploadMbps): Promise<boolean> {
    const api = await this.getConnection(nas);
    const maxLimit = `${uploadMbps}M/${downloadMbps}M`;  // Format: upload/download
    
    // Find existing queue
    const queues = await api.write('/queue/simple/print', [
        `?name=<pppoe-${username}>`
    ]);
    
    if (queues.length > 0) {
        // Update existing
        await api.write('/queue/simple/set', [
            `=.id=${queues[0]['.id']}`,
            `=max-limit=${maxLimit}`
        ]);
    } else {
        // Create new queue (user must be online)
        const session = await this.findActiveSession(nas, username);
        if (!session?.address) return false;
        
        await api.write('/queue/simple/add', [
            `=name=<pppoe-${username}>`,
            `=target=${session.address}/32`,
            `=max-limit=${maxLimit}`
        ]);
    }
    return true;
}
```

**Temporary Boost with Auto-Revert**:
```typescript
async setTemporaryBoost(nas, username, downloadMbps, uploadMbps, durationMinutes, originalDownload, originalUpload) {
    // Set boosted speed
    await this.setUserQueue(nas, username, downloadMbps, uploadMbps);
    
    // Create scheduler to revert speed
    const schedulerName = `boost-revert-${username}`;
    const originalMaxLimit = `${originalUpload}M/${originalDownload}M`;
    const script = `/queue simple set [find name="<pppoe-${username}>"] max-limit=${originalMaxLimit}; /system scheduler remove [find name="${schedulerName}"]`;
    
    await api.write('/system/scheduler/add', [
        `=name=${schedulerName}`,
        `=start-time=startup`,
        `=interval=${durationMinutes}m`,
        `=on-event=${script}`,
        `=policy=read,write,policy,test`
    ]);
}
```

---

### System Information

| Method | RouterOS API | Description |
|--------|-------------|-------------|
| `getSystemResources(nas)` | `/system/resource/print`, `/system/identity/print`, `/system/routerboard/print` | CPU, memory, uptime, version, board |
| `getInterfaces(nas)` | `/interface/print` + `/ip/route/print` | All interfaces with WAN detection |
| `pingRouter(ip, timeout)` | TCP socket to port 8728 | Test connectivity |
| `testConfiguration(nas)` | `/ip/hotspot/print`, `/interface/pppoe-server/server/print`, `/radius/print` | Check what's configured |

**WAN Detection**:
```typescript
async getInterfaces(nas: NASInfo): Promise<RouterInterface[]> {
    // Get routes to detect WAN interface
    const routes = await api.write('/ip/route/print', ['?dst-address=0.0.0.0/0']);
    const wanInterfaces = new Set(routes.map(r => r.interface).filter(Boolean));
    
    // Mark interfaces that have default route as WAN
    return interfaces.map(iface => ({
        ...iface,
        isWan: wanInterfaces.has(iface.name),
    }));
}
```

---

### Router Provisioning (Zero-Touch)

#### `configureHotspot(nas, config, radiusServer, radiusSecret)`

Complete Hotspot setup:

1. **Prepare Interfaces** - Enable and remove from existing bridges
2. **Create Bridge** - If multiple interfaces, create `bridge-hotspot`
3. **Create IP Pool** - `hotspot-pool` with specified range
4. **Add IP Address** - Gateway IP to interface
5. **Create DHCP Server** - `hotspot-dhcp` with 1h lease time
6. **Configure DNS** - Set DNS servers, enable remote requests
7. **Create Hotspot Profile** - `easyisp-hotspot` with RADIUS, MAC-cookie login
8. **Create Hotspot Server** - Bind to interface
9. **Configure Walled Garden** - Allow:
   - RADIUS server IP
   - Backend server (`113.30.190.52`, `113-30-190-52.cloud-xip.com`)
   - Apple captive portal detection (`captive.apple.com`, `www.apple.com`)
   - Android/Google detection (`connectivitycheck.gstatic.com`, `clients3.google.com`)
   - Windows detection (`www.msftconnecttest.com`)
10. **Download Captive Portal Files** - Fetch `login.html`, `error.html`, `status.html`, `styles.css`, `script.js` from API

**Captive Portal Download**:
```typescript
const captivePortalFiles = ['login.html', 'error.html', 'status.html', 'styles.css', 'script.js'];
for (const file of captivePortalFiles) {
    await api.write('/tool/fetch', [
        `=url=${apiBaseUrl}/provision/hotspot/${file}?tenantId=${tenantId}`,
        `=dst-path=hotspot/${file}`,
        '=mode=https',
        '=check-certificate=no'
    ]);
}
```

---

#### `configurePPPoE(nas, config)`

Complete PPPoE server setup:

1. **Create IP Pool** - `pppoe-pool` with specified range
2. **Create PPP Profile** - `easyisp-pppoe` with:
   - Local address (router IP)
   - Remote address pool
   - Encryption enabled
   - Only-one session per user
   - TCP MSS clamping
3. **Create PPPoE Server** - On each specified interface with:
   - Service name
   - Default profile
   - Auth: PAP, CHAP, MSCHAP1, MSCHAP2
   - One session per host

---

#### Other Provisioning Methods

| Method | Description |
|--------|-------------|
| `backupConfig(nas)` | Creates `easyisp-backup-{timestamp}` backup file |
| `configureFirewall(nas, wanInterface)` | Adds NAT masquerade rule |
| `closeAll()` | Closes all open connections |

---

## What's Complete ✅

1. ✅ **Connection Pooling** - Reuses connections, checks liveness
2. ✅ **VPN IP Support** - Prefers VPN IP for management
3. ✅ **Get Active Sessions** - List all PPPoE users via `/ppp/active/print`
4. ✅ **Disconnect User** - Force disconnect via `/ppp/active/remove`
5. ✅ **MAC Binding** - Lock/unlock MAC via `/ppp/secret/set`
6. ✅ **Static IP Assignment** - Set remote-address
7. ✅ **Queue Management** - Create/update simple queues
8. ✅ **Temporary Speed Boost** - With scheduler auto-revert
9. ✅ **Real-time Bandwidth** - Via `/interface/monitor-traffic`
10. ✅ **System Resources** - CPU, memory, uptime, version
11. ✅ **Interface Discovery** - With WAN detection via default route
12. ✅ **Router Ping** - TCP connection test to API port
13. ✅ **Full Hotspot Provisioning** - Complete setup including captive portal download
14. ✅ **Full PPPoE Provisioning** - Complete PPPoE server setup
15. ✅ **Walled Garden Setup** - Apple, Google, Windows captive portal detection
16. ✅ **Config Backup** - Creates backup before changes
17. ✅ **Firewall NAT** - Adds masquerade rule
18. ✅ **Service Detection** - Check what's configured on router

---

## What's NOT Complete ⚠️

1. ⚠️ **RouterOS v7 REST API** - Only socket API used (v6 style)
2. ⚠️ **Hotspot User Management** - Only PPPoE secrets, not hotspot users
3. ⚠️ **Wireless Configuration** - No WiFi channel/security setup
4. ⚠️ **VPN Configuration** - No IPsec/L2TP/PPTP setup
5. ⚠️ **Certificate Management** - No SSL cert upload
6. ⚠️ **Package Updates** - No RouterOS package management
7. ⚠️ **Script Execution** - No arbitrary script running
8. ⚠️ **SNMP via API** - Uses separate SNMP module
9. ⚠️ **Backup Download** - Creates backup but doesn't fetch file

---

## What's Working ✅

All implemented features are fully functional:
- Connection management with pooling ✓
- Session listing and disconnection ✓
- MAC binding and static IP ✓
- Queue/bandwidth management ✓
- System info retrieval ✓
- Full Hotspot provisioning ✓
- Full PPPoE provisioning ✓

---

## What's NOT Working ❌

No critical issues found. Minor concerns:

1. **Connection Lifespan** - No TTL on connections, relies on error detection
2. **Error Handling** - Some `try/catch` blocks silently ignore errors
3. **Message Sending** - `sendMessage()` logs but doesn't actually send (PPPoE doesn't support native messaging)

---

## Security Issues 🔐

### Critical

1. **API Credentials in Plaintext**
   - **Location**: `NAS.apiUsername`, `NAS.apiPassword` in database
   - **Risk**: Full router control if DB compromised
   - **Mitigation**: Encrypt API credentials

2. **No Connection Limits**
   - **Risk**: Can create unlimited connections
   - **Impact**: Memory exhaustion, router overload
   - **Mitigation**: Add per-tenant connection limits

### Medium

3. **VPN IP Override**
   - **Risk**: VPN IP bypasses public IP security
   - **Impact**: Management traffic via VPN
   - **Mitigation**: This is actually a feature, not a bug

4. **check-certificate=no**
   - **Risk**: Captive portal download doesn't verify SSL
   - **Impact**: MITM could inject malicious portal
   - **Mitigation**: Use proper certificates

---

## Possible Improvements 🚀

### High Priority

1. **Connection TTL**
   ```typescript
   private connectionExpiry: Map<string, number> = new Map();
   const TTL = 30 * 60 * 1000; // 30 minutes
   ```

2. **RouterOS v7 REST API**
   ```typescript
   // For v7+, use REST instead of socket
   const response = await fetch(`https://${host}/rest/ppp/active`, {
       headers: { 'Authorization': `Bearer ${token}` }
   });
   ```

3. **Encrypt API Credentials**
   ```typescript
   const decryptedPassword = decrypt(nas.apiPasswordEncrypted, ENCRYPTION_KEY);
   ```

### Medium Priority

4. **Hotspot User Management** - Add/remove via `/ip/hotspot/user`
5. **Wireless Configuration** - Set channel, security via `/interface/wireless`
6. **Backup Download** - Fetch backup file via FTP or `/file/print`

---

## Related Modules

- **NAS Management** - Provides NAS info to this service
- **RADIUS Server** - Alternative auth method
- **Customer Management** - Customer credentials
- **Session Management** - Session tracking in DB
- **Wizard Routes** - Uses provisioning methods
- **Provision Routes** - Serves captive portal files

---

## Environment Variables

```bash
API_BASE_URL=https://113-30-190-52.cloud-xip.com  # For captive portal downloads
```

---

## Usage Example

```typescript
import { mikrotikService } from '../services/mikrotik.service.js';

// Get active sessions
const sessions = await mikrotikService.getActiveSessions(nas);

// Disconnect user
await mikrotikService.disconnectUser(nas, 'customer001');

// Set speed limit
await mikrotikService.setUserQueue(nas, 'customer001', 10, 10); // 10 Mbps

// Temporary boost (20 Mbps for 30 minutes, reverts to 10 Mbps)
await mikrotikService.setTemporaryBoost(nas, 'customer001', 20, 20, 30, 10, 10);

// Provision hotspot
await mikrotikService.configureHotspot(nas, {
    interfaces: ['wlan1'],
    gatewayIp: '10.10.10.1',
    poolStart: '10.10.10.10',
    poolEnd: '10.10.10.254',
    dnsServers: ['8.8.8.8', '8.8.4.4']
}, '10.0.0.5', 'radiusSecret');
```

---

## Migration Path

1. **Immediate** (Week 1):
   - Add connection TTL
   - Encrypt API credentials in database

2. **Short-term** (Month 1):
   - Add RouterOS v7 REST API support
   - Implement hotspot user management

3. **Long-term** (Quarter 1):
   - Add wireless configuration
   - Implement backup download
   - Add certificate management
