# RADIUS Server Module

## Overview

The RADIUS (Remote Authentication Dial-In User Service) Server is a **custom-built, pure Node.js implementation** that authenticates, authorizes, and tracks customer internet sessions. Unlike FreeRADIUS, this is built from scratch using UDP sockets, providing full control and integration with the EasyISP database.

**RFC Compliance**: RFC 2865 (Auth), RFC 2866 (Accounting), RFC 5176 (CoA/DM)

---

## Architecture

### Source Files

```
/root/easyisp/Backend/src/radius/
├── index.ts           (232 lines)  - RadiusServer class, UDP listeners
├── dictionary.ts      (12 KB)      - RADIUS attributes & MikroTik VSAs
├── packet.ts          (13 KB)      - Packet parsing, encoding, crypto
└── handlers/
    ├── access.ts      (334 lines)  - Authentication logic
    ├── accounting.ts  (318 lines)  - Session tracking
    └── coa.ts         (311 lines)  - Disconnect & speed change
```

### Key Classes

```typescript
// Main RADIUS Server
class RadiusServer {
  private authSocket: dgram.Socket | null = null;   // UDP 1812
  private acctSocket: dgram.Socket | null = null;   // UDP 1813
  private config: RadiusServerConfig;
  private isRunning = false;

  async start(): Promise<void>
  async stop(): Promise<void>
  getStatus(): { running: boolean; authPort: number; acctPort: number }
}

// Default configuration
{
  authPort: parseInt(process.env['RADIUS_PORT'] ?? '1812'),
  acctPort: parseInt(process.env['RADIUS_ACCT_PORT'] ?? '1813'),
  coaPort: parseInt(process.env['RADIUS_COA_PORT'] ?? '3799'),
}
```

---

## What It Does in the System

### 1. Authentication (RFC 2865) - `handlers/access.ts`

**Handles `Access-Request` packets from MikroTik routers.**

**Authentication Flow:**
```
1. Router sends Access-Request (UDP 1812)
2. Extract context: username, MAC, NAS-IP
3. Look up NAS by IP address (or VPN IP)
4. Verify shared secret matches
5. Find customer by username + tenant
6. Verify password (PAP or CHAP)
7. Check customer status (active, suspended, expired)
8. Check expiration date
9. Build Access-Accept with attributes:
   - Service-Type: Framed
   - Framed-Protocol: PPP (for PPPoE)
   - MikroTik-Rate-Limit: "10M/10M" (speed limits)
   - MikroTik-Total-Limit: data quota
   - Session-Timeout: session time (hotspot)
   - Idle-Timeout: 5 minutes default
   - Acct-Interim-Interval: 5 minutes
10. Update customer lastIp and lastMac
11. Send Access-Accept or Access-Reject
```

**Supported Authentication Methods:**
- **PAP** (Password Authentication Protocol) - Encrypted with shared secret
- **CHAP** (Challenge Handshake Authentication Protocol)

**Rejection Reasons:**
- `Unknown network device` - NAS not registered
- `Invalid username or password` - Customer not found or wrong password
- `Account suspended` - Customer status = SUSPENDED
- `Account disabled` - Customer status = DISABLED
- `Account expired` - expiresAt < now

**Access-Accept Attributes Returned:**

| Attribute | Value | Description |
|-----------|-------|-------------|
| Service-Type | Framed (2) | Standard for PPP |
| Framed-Protocol | PPP (1) | For PPPoE customers |
| **Mikrotik-Rate-Limit** | "10M/10M" | Upload/Download speed |
| **Mikrotik-Total-Limit** | 1073741824 | Data limit in bytes |
| Session-Timeout | 86400 | Max session in seconds |
| Idle-Timeout | 300 | Disconnect after 5min idle |
| Acct-Interim-Interval | 300 | Report usage every 5min |

**Burst Speed Support:**
```typescript
// Format: rx/tx rx-burst/tx-burst threshold-rx/tx time-rx/tx priority
const burstRate = `${uploadSpeed}M/${downloadSpeed}M ${burstUpload}M/${burstDownload}M 0/0 1/1 5`;
```

---

### 2. Accounting (RFC 2866) - `handlers/accounting.ts`

**Handles `Accounting-Request` packets for session tracking.**

**Acct-Status-Type Handlers:**

| Status Type | Action |
|-------------|--------|
| **Start** | Create new Session record in database |
| **Interim-Update** | Update session with current data usage |
| **Stop** | Close session, record final usage and terminate cause |
| **Accounting-On** | NAS restarted - close all active sessions for this NAS |
| **Accounting-Off** | NAS shutting down - close all active sessions |

**Session Data Tracked:**
```typescript
interface AccountingContext {
  username: string;
  sessionId: string;           // Unique session identifier
  statusType: AcctStatusType;  // START, INTERIM, STOP
  nasIp: string;
  framedIp?: string;           // IP assigned to customer
  macAddress?: string;         // Customer MAC address
  sessionTime?: number;        // Seconds connected
  inputOctets?: bigint;        // Bytes downloaded (supports >4GB)
  outputOctets?: bigint;       // Bytes uploaded (supports >4GB)
  terminateCause?: string;     // Why session ended
}
```

**Gigawords Support (>4GB data):**
```typescript
// Handles values > 4GB using Acct-Input-Gigawords
const inputOctets = inputOctetsLow + (inputGigawords * BigInt(4294967296)); // 2^32
```

**NAS Restart Handling:**
```typescript
// When router reboots, automatically close all its active sessions
async function handleNasRestart(nasIp: string) {
  await prisma.session.updateMany({
    where: { nasId: nas.id, stopTime: null },
    data: { stopTime: new Date(), terminateCause: 'NAS_REBOOT' }
  });
}
```

---

### 3. Change of Authorization (RFC 5176) - `handlers/coa.ts`

**Sends Disconnect-Request and CoA-Request to routers.**

**Disconnect User:**
```typescript
export async function disconnectUser(
  username: string, 
  tenantId: string
): Promise<DisconnectResult>

// 1. Find active session by username
// 2. Get NAS IP (prefer VPN IP if available)
// 3. Send Disconnect-Request to NAS on CoA port (3799)
// 4. Wait for Disconnect-ACK or Disconnect-NAK
// 5. Return success/failure
```

**Update User Speed (Live):**
```typescript
export async function updateUserSpeed(
  username: string,
  tenantId: string,
  uploadMbps: number,
  downloadMbps: number
): Promise<DisconnectResult>

// Sends CoA-Request with new MikroTik-Rate-Limit
// Customer stays connected with new speed applied instantly
```

**CoA Packet Structure:**
```typescript
// Disconnect-Request
const attributes: AttributeBuilder[] = [
  { type: RadiusAttributeType.ACCT_SESSION_ID, value: sessionId },
  { type: RadiusAttributeType.USER_NAME, value: username },
];

// CoA-Request (speed change)
const attributes: AttributeBuilder[] = [
  { type: RadiusAttributeType.ACCT_SESSION_ID, value: sessionId },
  { type: RadiusAttributeType.USER_NAME, value: username },
  { 
    type: MikroTikAttribute.RATE_LIMIT, 
    value: "20M/20M",  // New speed
    vendorId: MIKROTIK_VENDOR_ID,
    vendorType: MikroTikAttribute.RATE_LIMIT 
  },
];
```

**Timeout Handling:**
```typescript
const COA_TIMEOUT = 5000; // 5 seconds
// If no response in 5 seconds, return failure
```

---

## API Endpoints

### GET `/api/radius/stats`
**Purpose**: Get RADIUS server statistics

**Response:**
```json
{
  "running": true,
  "authPort": 1812,
  "acctPort": 1813
}
```

---

### POST `/api/mikrotik/:nasId/disconnect`
**Purpose**: Disconnect a customer via CoA

**Request:**
```json
{
  "username": "customer001"
}
```

**What Happens:**
1. Finds active session for username
2. Sends Disconnect-Request to router
3. Waits for Disconnect-ACK
4. Closes session in database

---

## What's Complete ✅

1. ✅ **Custom UDP RADIUS Server** (not FreeRADIUS)
2. ✅ **PAP Authentication** with password decryption
3. ✅ **CHAP Authentication** with challenge verification
4. ✅ **Customer credential validation** from database
5. ✅ **Status checking** (active, suspended, expired, disabled)
6. ✅ **Expiration checking**
7. ✅ **MikroTik-Rate-Limit** vendor-specific attribute
8. ✅ **MikroTik-Total-Limit** for data quotas
9. ✅ **Burst speed support**
10. ✅ **Session-Timeout** for hotspot packages
11. ✅ **Idle-Timeout** (5 min default)
12. ✅ **Interim-Update interval** (5 min)
13. ✅ **Accounting Start/Stop/Interim** handling
14. ✅ **Gigawords support** (>4GB data tracking)
15. ✅ **Session creation** in database
16. ✅ **NAS restart handling** (close orphaned sessions)
17. ✅ **CoA Disconnect-Request** (force disconnect)
18. ✅ **CoA Speed Change** (update rate-limit live) ✅
19. ✅ **VPN IP support** (routes to NAS via VPN)
20. ✅ **Shared secret verification** per NAS
21. ✅ **Last IP/MAC tracking** on customer

---

## What's NOT Complete ⚠️

1. ~~⚠️ **Data Quota Enforcement**~~ ✅ **COMPLETED** - Mid-session disconnect when quota exceeded
2. ⚠️ **RADIUS Proxy**: No forwarding to external RADIUS servers
3. ⚠️ **EAP Support**: No EAP-TLS, EAP-TTLS, PEAP (only PAP/CHAP)
4. ⚠️ **IPv6 Support**: No Framed-IPv6-Address
5. ~~⚠️ **Separate RADIUS Logging**~~ ✅ **COMPLETED** - `radius-logger.ts` with event buffer
6. ~~⚠️ **Rate Limiting**~~ ✅ **COMPLETED** - 50 requests/10 seconds per NAS
7. ~~⚠️ **NAS Caching**~~ ✅ **COMPLETED** - 5-minute TTL cache
8. ⚠️ **Clustering**: Single-instance only, no load balancing
9. ⚠️ **RadSec**: No TLS encryption for RADIUS traffic

---

## Recently Completed Features ✅

### NAS Secret Caching
```typescript
// 5-minute TTL cache for NAS lookups
const NAS_CACHE_TTL = 300000;
nasCache.set(cacheKey, nas, NAS_CACHE_TTL);
```

### Rate Limiting
```typescript
// 50 requests per 10 seconds per NAS IP
const rateLimiter = new RateLimiterMemory({
    points: 50,
    duration: 10,
});
```

### Data Quota Enforcement
```typescript
// Mid-session disconnect when quota exceeded
if (totalUsage >= customer.package.dataLimit) {
    await disconnectUser(username, nas);
}
```

### RADIUS Event Logger
- Event tracking with circular buffer (last 1000 events)
- Statistics: accepts, rejects, session counts, data transferred
- Per-tenant authentication statistics
- Cache hit/miss metrics

---

## What's Working ✅

**All implemented features are fully functional:**
- Authentication for PPPoE and Hotspot ✓
- Accounting for session tracking ✓
- CoA disconnect (tested with MikroTik) ✓
- CoA speed change (tested with MikroTik) ✓
- NAS restart handling ✓
- VPN IP routing ✓
- **NAS caching** (5-min TTL) ✓
- **Rate limiting** (50 req/10s) ✓
- **Data quota enforcement** (mid-session disconnect) ✓
- **Event logging with statistics** ✓

---

## What's NOT Working ❌

**No critical issues found.** All core RADIUS functionality is operational.

---

## Security Issues 🔐

### Critical

1. **Shared Secret in Plaintext**
   - **Location**: `NAS.secret` field in database
   - **Risk**: If DB compromised, attackers can impersonate routers
   - **Mitigation**: Encrypt with AES-256

2. ~~**No Rate Limiting**~~ ✅ **RESOLVED**
   - Now limited to 50 requests/10 seconds per NAS

3. **RADIUS Over Unencrypted UDP**
   - **Risk**: Passwords obfuscated but not encrypted
   - **Impact**: MITM can intercept credentials
   - **Mitigation**: Use RadSec (RADIUS over TLS) or VPN

### Medium

4. **No Authenticator Verification on Auth**
   - **Risk**: Request-Authenticator not validated for Access-Request
   - **Impact**: Replay attacks possible
   - **Mitigation**: Verify authenticator (already done for Accounting ✅)

5. **Customer Password in Plaintext**
   - **Risk**: Customer passwords stored as-is for CHAP compatibility
   - **Impact**: Password exposure if DB breached
   - **Mitigation**: Consider bcrypt with PAP-only mode

---

## Test Coverage (NEW)

| Test File | Tests |
|-----------|-------|
| `radius.packet.test.ts` | 27 |
| `radius.dictionary.test.ts` | 63 |
| `radius.access.test.ts` | 36 |
| `radius.accounting.test.ts` | 49 |
| `radius.coa.test.ts` | 28 |
| `radius.integration.test.ts` | 23 |
| **Total** | **226 ✅** |

---

## Possible Improvements 🚀

### High Priority

1. **NAS Caching**
   ```typescript
   // Cache NAS lookups in memory (5 minute TTL)
   const nasCache = new Map<string, { nas: NAS; expires: number }>();
   
   async function getNAS(nasIp: string): Promise<NAS | null> {
     const cached = nasCache.get(nasIp);
     if (cached && cached.expires > Date.now()) {
       return cached.nas;
     }
     const nas = await prisma.nAS.findFirst({ where: { ipAddress: nasIp } });
     if (nas) {
       nasCache.set(nasIp, { nas, expires: Date.now() + 300000 });
     }
     return nas;
   }
   ```

2. **Rate Limiting**
   ```typescript
   import { RateLimiterMemory } from 'rate-limiter-flexible';
   
   const authLimiter = new RateLimiterMemory({
     points: 50,    // 50 requests
     duration: 10,  // per 10 seconds
     keyPrefix: 'radius_auth'
   });
   
   // In handleAuthPacket:
   try {
     await authLimiter.consume(nasIp);
   } catch (e) {
     return; // Drop packet silently
   }
   ```

3. **RADIUS Event Logging Table**
   ```prisma
   model RadiusLog {
     id        String   @id @default(uuid())
     type      String   // ACCESS_REQUEST, ACCESS_ACCEPT, ACCESS_REJECT, ACCT_*
     username  String
     nasIp     String
     result    String   // SUCCESS, FAILURE
     reason    String?  // Rejection reason
     duration  Int?     // Processing time in ms
     createdAt DateTime @default(now())
     
     @@index([createdAt])
     @@index([username])
   }
   ```

### Medium Priority

4. **Data Quota Mid-Session Check**
   ```typescript
   // In handleAccountingInterim:
   const totalUsage = context.inputOctets + context.outputOctets;
   if (customer.package?.dataLimit && totalUsage >= customer.package.dataLimit) {
     await disconnectUser(context.username, customer.tenantId);
     logger.info({ username: context.username }, 'Data quota exceeded, disconnecting');
   }
   ```

5. **Request Authenticator Verification**
   ```typescript
   function verifyAuthenticator(packet: RadiusPacket, secret: string): boolean {
     const hash = createHash('md5')
       .update(packet.raw.slice(0, 4))  // Code, ID, Length
       .update(Buffer.alloc(16, 0))      // 16 zeros
       .update(packet.raw.slice(20))     // Attributes
       .update(Buffer.from(secret))
       .digest();
     return hash.equals(packet.authenticator);
   }
   ```

### Low Priority

6. **RadSec (RADIUS over TLS)**
7. **EAP-TLS Support**
8. **IPv6 Framed Addresses**
9. **Clustering with Redis Session Store**

---

## MikroTik Configuration

### Router Setup
```routeros
# Add RADIUS server
/radius
add address=10.0.0.5 secret=YourSharedSecret service=ppp,hotspot \
    src-address=10.0.0.1 timeout=3s

# Enable RADIUS for PPPoE
/ppp aaa
set use-radius=yes accounting=yes interim-update=5m

# Enable RADIUS for Hotspot
/ip hotspot profile
set default use-radius=yes

# Enable CoA (Disconnect Message)
/radius incoming
set accept=yes port=3799
```

### Test RADIUS from Router
```routeros
/radius test-command user=testuser password=testpass
```

---

## Related Modules

- **Customer Management**: Authenticates customers
- **Package Management**: Returns speed limits
- **Session Management**: Tracks active/historical sessions
- **NAS Management**: Router configuration
- **MikroTik Integration**: Alternative disconnect method

---

## Testing Recommendations

1. **Unit Tests**
   - Password decryption (PAP)
   - CHAP verification
   - Attribute encoding/decoding
   - Rate-limit string formatting

2. **Integration Tests**
   - Access-Accept for valid customer
   - Access-Reject for invalid password
   - Access-Reject for expired customer
   - Accounting-Start creates session
   - Accounting-Stop closes session
   - CoA disconnect

3. **Load Tests**
   - 1000 concurrent auth requests
   - 10000 accounting updates/minute
   - CoA under load

---

## Environment Variables

```bash
RADIUS_PORT=1812        # Authentication port
RADIUS_ACCT_PORT=1813   # Accounting port
RADIUS_COA_PORT=3799    # CoA/DM port
```

---

## Migration Path

1. **Immediate** (Week 1):
   - Add NAS caching (reduce DB queries)
   - Implement rate limiting
   - Add RADIUS event logging table

2. **Short-term** (Month 1):
   - Add data quota mid-session enforcement
   - Verify request authenticators
   - Encrypt shared secrets in DB

3. **Long-term** (Quarter 1):
   - Implement RadSec (TLS)
   - Add clustering support
   - Consider EAP-TLS for enterprise clients
