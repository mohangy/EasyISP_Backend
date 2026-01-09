# Session Management Module

## Overview

The Session Management module tracks all active and historical customer internet sessions. It provides real-time visibility into who's online, session statistics, data usage tracking, and administrative controls for terminating sessions. This module bridges the RADIUS server accounting with the admin dashboard.

---

## What It Does in the System

### Core Functionality

1. **Session Tracking**
   - Creates session records on customer connect (RADIUS Accounting-Start)
   - Updates session data during connection (Interim-Update)
   - Closes sessions on disconnect (Accounting-Stop)
   - Tracks data usage (input/output octets)
   - Records session duration
   - Stores disconnect reasons

2. **Real-Time Monitoring**
   - List active sessions across all routers
   - Filter by customer, router, or connection type
   - Calculate live session durations
   - Monitor concurrent users per router

3. **Statistics & Analytics**
   - Total active sessions (overall, PPPoE, Hotspot)
   - Sessions started today/this week/this month
   - Sessions grouped by router
   - Historical session data

4. **Administrative Controls**
   - Manually terminate sessions
   - Sync/cleanup stale sessions
   - Force disconnect via CoA

5. **Data Usage Tracking**
   - Input octets (downloaded by customer)
   - Output octets (uploaded by customer)
   - Total data transferred
   - Real-time bandwidth monitoring

---

## API Endpoints

### GET `/api/sessions`
**Purpose**: List sessions with filtering and pagination

**Auth**: Required  
**Permissions**: `dashboard:active_sessions`

**Query Parameters**:
- `page`, `pageSize` (default: 20)
- `status` - `active`, `completed`, or `all`
- `customerId` - Filter by specific customer
- `nasId` - Filter by specific router
- `search` - Search by username, IP, or session ID

**Response** (200):
```json
{
  "sessions": [
    {
      "id": "uuid",
      "sessionId": "8100001A",
      "username": "customer001",
      "customer": {
        "id": "uuid",
        "name": "John Doe",
        "phone": "+254700000000"
      },
      "nas": {
        "id": "uuid",
        "name": "Main Router",
        "ipAddress": "192.168.1.1"
      },
      "framedIp": "10.5.50.100",
      "macAddress": "00:11:22:33:44:55",
      "startTime": "2026-01-04T10:00:00Z",
      "stopTime": null,
      "duration": "3h 45m",
      "durationSeconds": 13500,
      "bytesIn": 3145728000,      // 3 GB downloaded
      "bytesOut": 1048576000,     // 1 GB uploaded
      "terminateCause": null
    }
  ],
  "total": 1234,
  "page": 1,
  "pageSize": 20
}
```

---

### GET `/api/sessions/stats`
**Purpose**: Get session statistics

**Auth**: Required  
**Permissions**: `dashboard:active_sessions`

**Response** (200):
```json
{
  "total": 1234,
  "pppoe": 980,
  "hotspot": 254,
  "sessions": {
    "today": 2450,
    "thisWeek": 15680,
    "thisMonth": 67820
  },
  "byNas": [
    {
      "nasId": "uuid",
      "nasName": "Main Router",
      "count": 850
    },
    {
      "nasId": "uuid2",
      "nasName": "Branch Router",
      "count": 384
    }
  ]
}
```

**Calculations**:
- `total`: Active sessions right now (stopTime = null)
- `pppoe`: Active PPPoE sessions
- `hotspot`: Active Hotspot sessions
- `today`: Sessions started today (regardless of current status)
- `thisWeek`: Sessions started in last 7 days
- `thisMonth`: Sessions started in last 30 days
- `byNas`: Active sessions grouped by router

---

### POST `/api/sessions/sync`
**Purpose**: Cleanup stale sessions

**Auth**: Required

**Response** (200):
```json
{
  "success": true,
  "cleanedCount": 15,
  "cutoffTime": "2026-01-04T06:00:00Z"
}
```

**What It Does**:
1. Finds sessions without `stopTime` that are older than 24 hours
2. Marks them as stopped with `terminateCause` = "Stale-Session-Cleanup"
3. Sets `stopTime` to cutoff time (24 hours ago)

**Use Case**: Run as cron job to handle cases where routers didn't send Accounting-Stop

---

### GET `/api/sessions/:id`
**Purpose**: Get detailed session information

**Auth**: Required  
**Permissions**: `dashboard:active_sessions`

**Response** (200):
```json
{
  "id": "uuid",
  "sessionId": "8100001A",
  "username": "customer001",
  "customer": {
    "id": "uuid",
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+254700000000",
    "package": {
      "name": "10 Mbps Home",
      "downloadSpeed": 10,
      "uploadSpeed": 10
    }
  },
  "nas": {
    "id": "uuid",
    "name": "Main Router",
    "ipAddress": "192.168.1.1"
  },
  "framedIp": "10.5.50.100",
  "macAddress": "00:11:22:33:44:55",
  "startTime": "2026-01-04T10:00:00Z",
  "stopTime": null,
  "duration": "3h 45m 30s",
  "durationSeconds": 13530,
  "bytesIn": 3145728000,
  "bytesOut": 1048576000,
  "terminateCause": null
}
```

---

### DELETE `/api/sessions/:id`
**Purpose**: Force terminate a session

**Auth**: Required  
**Permissions**: `routers:disconnect`

**Response** (200):
```json
{
  "success": true
}
```

**What Happens**:
1. Marks session as stopped in database
2. Sets `terminateCause` = "Admin-Terminate"
3. TODO: Sends CoA disconnect to router (not yet implemented)

**Note**: Currently only updates DB. Full implementation should send CoA Disconnect-Request to router.

---

## What's Complete ✅

1. ✅ Session listing with pagination
2. ✅ Filtering (by status, customer, router, search)
3. ✅ Real-time active session count
4. ✅ PPPoE vs Hotspot breakdown
5. ✅ Session statistics (today/week/month)
6. ✅ Sessions grouped by router
7. ✅ Detailed session view
8. ✅ Duration calculation (live and completed)
9. ✅ Data usage tracking (bytes in/out)
10. ✅ Stale session cleanup
11. ✅ Manual session termination (DB only)
12. ✅ Search functionality

---

## What's NOT Complete ⚠️

1. ⚠️ **CoA Disconnect**: Manual termination doesn't send CoA to router
2. ⚠️ **Bandwidth Graphs**: No real-time bandwidth usage charts
3. ⚠️ **Session Alerts**: No alerts for unusual sessions (e.g., 24+ hours)
4. ⚠️ **Session Export**: No CSV/PDF export of session history
5. ⚠️ **Session Comparison**: Can't compare customer's current vs previous sessions
6. ⚠️ **Peak Time Analysis**: No analytics on peak usage times
7. ⚠️ **Session Quality Metrics**: No latency/packet loss tracking
8. ⚠️ **Automated Cleanup**: Cron job exists but may not be scheduled
9. ⚠️ **Session Replay**: No ability to view session timeline
10. ⚠️ **Multi-Session Detection**: No fraud detection for same user on multiple IPs

---

## What's Working ✅

All implemented features are functional:
- Session tracking from RADIUS accounting
- Real-time active session monitoring
- Statistics calculation
- Stale session cleanup
- Search and filtering

---

## What's NOT Working ❌

1. **CoA Disconnect Not Sent**
   - `DELETE /api/sessions/:id` marks session as terminated in DB
   - But doesn't send CoA Disconnect-Request to router
   - **Impact**: Customer stays connected until natural disconnect
   - **Workaround**: Use MikroTik disconnect endpoint

2. **Automated Cleanup May Not Run**
   - Stale session cleanup function exists
   - Not clear if cron job is configured
   - **Impact**: Stale sessions accumulate

---

## Security Issues 🔐

### Low Priority

1. **No Rate Limiting on Session Listing**
   - **Risk**: Can query large session lists repeatedly
   - **Impact**: Database load, slow performance
   - **Mitigation**: Add rate limiting, cache results

2. **Session ID Enumeration**
   - **Risk**: Sequential RADIUS session IDs might be guessable
   - **Impact**: Attackers could view other customers' sessions
   - **Mitigation**: Use UUID for session IDs or enforce strict auth checks

---

## Possible Improvements 🚀

### High Priority

1. **Implement CoA Disconnect**
   ```typescript
   // In DELETE /api/sessions/:id
   import { sendCoADisconnect } from '../lib/radius-coa.js';
   
   await sendCoADisconnect({
     nasIp: session.nas.ipAddress,
     nasSecret: session.nas.secret,
     username: session.username,
     sessionId: session.sessionId
   });
   ```

2. **Real-Time Bandwidth Graph**
   ```typescript
   GET /api/sessions/:id/bandwidth?interval=5m
   
   // Returns time-series data
   {
     "data": [
       {
         "timestamp": "2026-01-04T10:00:00Z",
         "downloadKbps": 8500,
         "uploadKbps": 2100
       },
       ...
     ]
   }
   ```

3. **Session Export**
   ```typescript
   GET /api/sessions/export?format=csv&startDate=2026-01-01&endDate=2026-01-31
   
   // Returns CSV file
   Session ID,Username,Start Time,Stop Time,Duration,Data In,Data Out,Router
   8100001A,customer001,2026-01-04 10:00,2026-01-04 14:30,4h 30m,3 GB,1 GB,Main Router
   ```

4. **Automated Stale Cleanup Cron**
   ```typescript
   // In cron job (every hour)
   import cron from 'node-cron';
   
   cron.schedule('0 * * * *', async () => {
     const result = await cleanupStaleSessions();
     logger.info(`Cleaned ${result.count} stale sessions`);
   });
   ```

### Medium Priority

5. **Session Alerts**
   ```typescript
   // Alert rules
   {
     "rules": [
       {
         "type": "LONG_SESSION",
         "threshold": 86400,  // 24 hours
         "action": "NOTIFY_ADMIN"
       },
       {
         "type": "HIGH_BANDWIDTH",
         "threshold": 107374182400,  // 100 GB
         "action": "AUTO_DISCONNECT"
       }
     ]
   }
   ```

6. **Peak Time Analysis**
   ```typescript
   GET /api/sessions/analytics/peak-times
   
   // Returns hourly heatmap
   {
     "heatmap": [
       { "hour": 0, "avgSessions": 450 },
       { "hour": 1, "avgSessions": 380 },
       ...
       { "hour": 20, "avgSessions": 1200 },  // Peak: 8 PM
       ...
     ]
   }
   ```

7. **Multi-Session Detection**
   ```typescript
   GET /api/sessions/fraud/multi-device
   
   // Detect same user on multiple IPs/MACs
   {
     "suspiciousUsers": [
       {
         "username": "customer001",
         "activeSessions": 3,
         "ips": ["10.5.50.100", "10.5.50.101", "10.5.50.102"],
         "macs": ["aa:bb:cc:dd:ee:ff", "11:22:33:44:55:66", ...]
       }
     ]
   }
   ```

### Low Priority

8. **Session Comparison**
   ```typescript
   GET /api/customers/:id/session-comparison
   
   // Compare current vs average
   {
     "currentSession": {
       "duration": "5h",
       "dataUsage": 10737418240  // 10 GB
     },
     "averageSession": {
       "duration": "3h",
       "dataUsage": 5368709120  // 5 GB
     },
     "percentile": 85  // Current session in top 15%
   }
   ```

9. **Session Timeline Replay**
   ```typescript
   GET /api/sessions/:id/timeline
   
   // Returns events during session
   {
     "events": [
       { "time": "10:00:00", "event": "Session Started", "ip": "10.5.50.100" },
       { "time": "10:05:00", "event": "Interim Update", "bytesIn": 52428800 },
       { "time": "10:10:00", "event": "Speed Changed", "newSpeed": "20 Mbps" },
       { "time": "14:30:00", "event": "Session Ended", "cause": "User-Request" }
     ]
   }
   ```

---

## Performance Considerations

### Database Indexing

Current indexes (from schema):
```prisma
@@index([tenantId])
@@index([username])
@@index([nasId])
@@index([customerId])
```

**Recommended additions**:
```prisma
@@index([stopTime])               // Filter active sessions
@@index([startTime])              // Date range queries
@@index([tenantId, stopTime])    // Active sessions per tenant
```

### Optimization Tips

1. **Cache Active Session Count**: Store in Redis, update on RADIUS accounting
2. **Paginate Results**: Never fetch all sessions at once
3. **Archive Old Sessions**: Move sessions >90 days to archive table
4. **Use Materialized Views**: For complex statistics queries

---

## Related Modules

- **RADIUS Server**: Creates and updates session records
- **Customer Management**: Sessions linked to customers
- **NAS Management**: Sessions grouped by router
- **Dashboard**: Displays session statistics
- **Package Management**: Session quotas defined by package

---

## Testing Recommendations

1. **Unit Tests**
   - Duration calculation (active vs completed)
   - Data usage formatting (bytes to GB)
   - Stale session detection logic

2. **Integration Tests**
   - RADIUS Accounting-Start → verify session created
   - RADIUS Interim-Update → verify session updated
   - RADIUS Accounting-Stop → verify session closed
   - Stale cleanup → verify old sessions marked stopped

3. **Load Tests**
   - List 100k sessions with filters
   - Calculate stats with 50k active sessions
   - Concurrent session updates (1000/s)

---

## Migration Path

1. **Immediate** (Week 1):
   - Implement CoA disconnect on manual termination
   - Schedule stale session cleanup cron job
   - Add session export functionality

2. **Short-term** (Month 1):
   - Build real-time bandwidth graphs
   - Implement session alerts
   - Add peak time analytics

3. **Long-term** (Quarter 1):
   - Create session timeline replay
   - Build multi-session fraud detection
   - Implement session archival system
