# SNMP Monitoring Module

## Overview

The SNMP Monitoring module provides network device monitoring and alerting based on stored metrics. Currently uses stored database values rather than live SNMP polling.

**Source File**: `/root/easyisp/Backend/src/routes/snmp.routes.ts` (251 lines, 7.6 KB)

---

## What It Does in the System

1. **Status Reporting** - SNMP configuration and device list
2. **Device Polling** - Retrieve metrics for specific device (currently mock)
3. **Aggregated Metrics** - CPU and memory averages across devices
4. **SNMP Settings** - Configure community/version per device
5. **Alert Generation** - Generate alerts from stored metrics

---

## API Endpoints

### GET `/api/snmp/status`
**Purpose**: Get SNMP polling status and device list

**Auth**: Required

**Response** (200):
```json
{
  "enabled": true,
  "pollInterval": 60,
  "version": "v2c",
  "devices": [
    {
      "id": "uuid",
      "name": "Main Router",
      "ip": "203.0.113.1",
      "status": "ONLINE",
      "lastPolled": "2026-01-04T12:00:00Z"
    }
  ],
  "stats": {
    "total": 5,
    "online": 4,
    "offline": 1
  }
}
```

**Environment Variables**:
- `SNMP_POLL_INTERVAL` - Polling interval in seconds (default: 60)
- `SNMP_VERSION` - SNMP version (default: v2c)

---

### GET `/api/snmp/poll/:nasId`
**Purpose**: Poll specific device

**Auth**: Required

**Response** (200):
```json
{
  "nasId": "uuid",
  "nasName": "Main Router",
  "polledAt": "2026-01-04T12:00:00Z",
  "data": {
    "system": {
      "sysDescr": "MikroTik RouterOS RB5009",
      "sysUpTime": "5d12h30m",
      "sysName": "Main Router"
    },
    "interfaces": [
      {
        "ifIndex": 1,
        "ifDescr": "ether1",
        "ifOperStatus": "up",
        "ifInOctets": 1234567890,
        "ifOutOctets": 9876543210
      }
    ],
    "cpu": 15,
    "memory": {
      "used": 134217728,
      "total": 268435456,
      "percent": 50
    }
  }
}
```

**Current Status**: Returns stored database values + mock interface data (see line 60: `// TODO: Implement actual SNMP polling`)

**Side Effect**: Updates `lastSeen` timestamp

---

### GET `/api/snmp/metrics`
**Purpose**: Get aggregated metrics across all devices

**Auth**: Required

**Query Parameters**:
- `period` - Time range: `1h`, `24h`, `7d`, `30d` (currently unused)

**Response** (200):
```json
{
  "period": "1h",
  "deviceCount": 5,
  "aggregated": {
    "avgCpuLoad": 20,
    "avgMemoryPercent": 45,
    "totalMemoryUsed": 671088640,
    "totalMemoryTotal": 1342177280
  },
  "devices": [
    {
      "id": "uuid",
      "name": "Main Router",
      "cpu": 15,
      "memoryPercent": 50
    }
  ]
}
```

**Note**: Uses current stored values, not historical data by period.

---

### POST `/api/snmp/settings`
**Purpose**: Update SNMP settings for a device

**Auth**: Required

**Request Body**:
```json
{
  "nasId": "uuid",
  "community": "public",
  "version": "v2c",
  "port": 161
}
```

**Response** (200):
```json
{
  "success": true,
  "nasId": "uuid",
  "settings": {
    "community": "public",
    "version": "v2c",
    "port": 161
  }
}
```

**Current Status**: Acknowledges but doesn't persist (see line 153: `// TODO: Store SNMP settings`)

---

### GET `/api/snmp/alerts`
**Purpose**: Get alerts based on device metrics

**Auth**: Required

**Response** (200):
```json
{
  "alerts": [
    {
      "severity": "critical",
      "device": "Branch Router",
      "message": "Device is offline",
      "timestamp": "2026-01-04T11:55:00Z"
    },
    {
      "severity": "warning",
      "device": "Main Router",
      "message": "High CPU usage: 95%",
      "timestamp": "2026-01-04T12:00:00Z"
    },
    {
      "severity": "warning",
      "device": "Edge Router",
      "message": "High memory usage: 92%",
      "timestamp": "2026-01-04T12:00:00Z"
    },
    {
      "severity": "info",
      "device": "Backup Router",
      "message": "Device not responding to polls",
      "timestamp": "2026-01-04T11:50:00Z"
    }
  ],
  "summary": {
    "critical": 1,
    "warning": 2,
    "info": 1
  }
}
```

**Alert Rules**:
| Condition | Severity | Message |
|-----------|----------|---------|
| `status === 'OFFLINE'` | Critical | Device is offline |
| `cpuLoad > 90` | Warning | High CPU usage: X% |
| `memoryPercent > 90` | Warning | High memory usage: X% |
| `lastSeen > 5 minutes ago` | Info | Device not responding to polls |

**Sorting**: Critical → Warning → Info

---

## What's Complete ✅

1. ✅ Device status listing
2. ✅ Poll endpoint (mock data)
3. ✅ Aggregated metrics calculation
4. ✅ Settings endpoint (acknowledgment only)
5. ✅ Alert generation from stored metrics
6. ✅ Alert severity categorization
7. ✅ Online/offline device counting

---

## What's NOT Complete ⚠️

1. ⚠️ **Actual SNMP Polling** - Uses stored DB values, not live SNMP
2. ⚠️ **SNMP Settings Storage** - Settings not persisted to database
3. ⚠️ **Historical Metrics** - No time-series storage
4. ⚠️ **Period Parameter** - Unused in metrics endpoint
5. ⚠️ **Interface Bandwidth** - Mock data only
6. ⚠️ **Background Polling Job** - No cron to poll devices
7. ⚠️ **Custom Alert Thresholds** - Hardcoded 90% thresholds
8. ⚠️ **Alert Notifications** - No email/SMS on alerts
9. ⚠️ **SNMP v3** - No authentication/encryption support
10. ⚠️ **SNMP Traps** - No trap receiver

---

## What's Working ✅

All implemented features are functional (with mock/stored data):
- Status reporting ✓
- Alert generation ✓
- Aggregated metrics ✓

---

## What's NOT Working ❌

1. **Live SNMP Polling**
   - `/poll/:nasId` returns stored values, not live SNMP
   - Interface data is mock (lines 63-75)

2. **SNMP Settings Persistence**
   - Settings endpoint doesn't store to database
   - NAS model lacks `snmpCommunity`, `snmpVersion` fields

---

## Security Issues 🔐

### Medium

1. **Community String in Request**
   - SNMP community (password) sent in POST body
   - **Mitigation**: Use HTTPS (already required), encrypt storage

### Low

2. **No SNMP v3 Support**
   - v2c community is essentially plaintext password
   - **Mitigation**: Implement SNMPv3 with auth/priv

---

## Possible Improvements 🚀

### High Priority

1. **Implement Actual SNMP Polling**
   ```typescript
   import * as snmp from 'net-snmp';
   
   async function pollDevice(nas) {
       const session = snmp.createSession(nas.ipAddress, nas.snmpCommunity || 'public');
       
       const oids = [
           '1.3.6.1.2.1.1.1.0',  // sysDescr
           '1.3.6.1.2.1.1.3.0',  // sysUpTime
           // ... more OIDs
       ];
       
       return new Promise((resolve, reject) => {
           session.get(oids, (error, varbinds) => {
               if (error) reject(error);
               else resolve(varbinds);
           });
       });
   }
   ```

2. **Background Polling Job**
   ```typescript
   // Cron job every 60 seconds
   cron.schedule('* * * * *', async () => {
       const devices = await prisma.nAS.findMany();
       for (const nas of devices) {
           const metrics = await pollDevice(nas);
           await prisma.nAS.update({
               where: { id: nas.id },
               data: {
                   cpuLoad: metrics.cpu,
                   memoryUsage: metrics.memoryUsed,
                   uptime: metrics.sysUpTime,
                   lastSeen: new Date()
               }
           });
       }
   });
   ```

3. **Add SNMP Fields to NAS Model**
   ```prisma
   model NAS {
       // ... existing fields
       snmpCommunity String @default("public")
       snmpVersion   String @default("v2c")
       snmpPort      Int    @default(161)
   }
   ```

### Medium Priority

4. **Time-Series Metrics Storage**
   ```prisma
   model MetricHistory {
       id        String   @id @default(uuid())
       nasId     String
       type      String   // cpu, memory, bandwidth
       value     Float
       timestamp DateTime @default(now())
       
       @@index([nasId, timestamp])
   }
   ```

5. **Custom Alert Thresholds**
   ```prisma
   model AlertThreshold {
       id       String @id @default(uuid())
       nasId    String
       metric   String // cpu, memory
       warning  Int
       critical Int
   }
   ```

6. **Alert Notifications**
   ```typescript
   // Send SMS/email when critical alerts detected
   if (alerts.some(a => a.severity === 'critical')) {
       await smsService.sendSms(tenantId, adminPhone, 
           `Critical: ${alerts.length} device alerts`);
   }
   ```

---

## Environment Variables

```bash
SNMP_POLL_INTERVAL=60   # Polling interval in seconds
SNMP_VERSION=v2c        # Default SNMP version
```

---

## Related Modules

- **NAS Management** - Source of device data
- **Dashboard** - Uses aggregated metrics
- **Health Checks** - Could integrate with readiness
