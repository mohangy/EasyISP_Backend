# Health Checks & Monitoring Module

## Overview

The Health Checks module provides Kubernetes-style health check endpoints for container orchestration and load balancer health monitoring. It includes liveness, readiness, and basic status endpoints.

**Source File**: `/root/easyisp/Backend/src/routes/health.routes.ts` (46 lines, 1 KB)

---

## What It Does in the System

1. **Basic Health** - Simple status check
2. **Readiness Check** - Verifies database connectivity
3. **Liveness Check** - Confirms application is running

---

## API Endpoints

### GET `/api/health` or `/health`
**Purpose**: Basic health check with version info

**Auth**: None (public)

**Response** (200):
```json
{
  "status": "ok",
  "timestamp": "2026-01-04T12:00:00.000Z",
  "version": "1.0.0"
}
```

---

### GET `/api/health/ready` or `/health/ready`
**Purpose**: Kubernetes readiness probe - checks dependencies

**Auth**: None (public)

**Response** (200) - Ready:
```json
{
  "status": "ready",
  "checks": {
    "database": "connected"
  }
}
```

**Response** (503) - Not Ready:
```json
{
  "status": "not ready",
  "checks": {
    "database": "disconnected"
  }
}
```

**What It Checks**:
```typescript
// Executes simple query to verify database connectivity
await prisma.$queryRaw`SELECT 1`;
```

---

### GET `/api/health/live` or `/health/live`
**Purpose**: Kubernetes liveness probe - confirms process is alive

**Auth**: None (public)

**Response** (200):
```json
{
  "status": "alive"
}
```

**Note**: This endpoint always returns 200 if the Node.js process is running. It doesn't check any dependencies.

---

## Kubernetes Usage

### Deployment Configuration

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: easyisp-backend
spec:
  template:
    spec:
      containers:
        - name: backend
          image: easyisp-backend:latest
          ports:
            - containerPort: 3000
          livenessProbe:
            httpGet:
              path: /health/live
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 10
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 5
            failureThreshold: 3
```

### Load Balancer Health Check

```nginx
upstream backend {
    server backend1:3000;
    server backend2:3000;
    
    # Health check every 5 seconds
    health_check interval=5s uri=/health/ready;
}
```

---

## What's Complete ✅

1. ✅ Basic health endpoint with timestamp
2. ✅ Version number in response
3. ✅ Database connectivity check (readiness)
4. ✅ Liveness probe endpoint
5. ✅ Proper HTTP status codes (200/503)
6. ✅ Structured JSON responses

---

## What's NOT Complete ⚠️

1. ⚠️ **RADIUS Server Health** - Not checked
2. ⚠️ **Redis Health** - Not checked (if used)
3. ⚠️ **External Service Health** - M-Pesa, SMS gateways not checked
4. ⚠️ **Disk Space Check** - Not monitored
5. ⚠️ **Memory Usage** - Not reported
6. ⚠️ **CPU Usage** - Not reported
7. ⚠️ **Startup Probe** - No separate startup check
8. ⚠️ **Metrics Endpoint** - No Prometheus /metrics

---

## What's Working ✅

All implemented endpoints are functional:
- Basic health check ✓
- Database readiness check ✓
- Liveness probe ✓

---

## What's NOT Working ❌

No critical issues found.

---

## Security Issues 🔐

Low priority - health endpoints are intentionally public.

**Consideration**: If version info is sensitive, consider removing it in production.

---

## Possible Improvements 🚀

### High Priority

1. **Extended Readiness Checks**
   ```typescript
   healthRoutes.get('/ready', async (c) => {
       const checks = {
           database: 'connected',
           radius: 'unknown',
           cache: 'unknown'
       };
       
       // Database check
       try {
           await prisma.$queryRaw`SELECT 1`;
           checks.database = 'connected';
       } catch {
           checks.database = 'disconnected';
       }
       
       // RADIUS check
       try {
           const radiusStatus = radiusServer.getStatus();
           checks.radius = radiusStatus.running ? 'running' : 'stopped';
       } catch {
           checks.radius = 'error';
       }
       
       const allHealthy = Object.values(checks).every(v => 
           ['connected', 'running'].includes(v)
       );
       
       return c.json({ 
           status: allHealthy ? 'ready' : 'degraded',
           checks 
       }, allHealthy ? 200 : 503);
   });
   ```

2. **Prometheus Metrics Endpoint**
   ```typescript
   import { collectDefaultMetrics, Registry } from 'prom-client';
   
   const register = new Registry();
   collectDefaultMetrics({ register });
   
   healthRoutes.get('/metrics', async (c) => {
       const metrics = await register.metrics();
       return c.text(metrics, 200, {
           'Content-Type': register.contentType
       });
   });
   ```

3. **Detailed Status Endpoint**
   ```typescript
   healthRoutes.get('/status', async (c) => {
       const process = require('process');
       
       return c.json({
           status: 'ok',
           uptime: process.uptime(),
           memory: process.memoryUsage(),
           version: process.env.npm_package_version,
           nodeVersion: process.version,
           environment: process.env.NODE_ENV
       });
   });
   ```

### Medium Priority

4. **Startup Probe**
   ```typescript
   // Only returns 200 once initial setup is complete
   healthRoutes.get('/startup', (c) => {
       if (startupComplete) {
           return c.json({ status: 'started' });
       }
       return c.json({ status: 'starting' }, 503);
   });
   ```

---

## Related Modules

- **RADIUS Server** - Should be checked in readiness
- **Database** - Already checked
- **Logger** - Logs readiness failures

---

## Testing

```bash
# Basic health
curl http://localhost:3000/health
# {"status":"ok","timestamp":"2026-01-04T12:00:00.000Z","version":"1.0.0"}

# Readiness (requires database)
curl http://localhost:3000/health/ready
# {"status":"ready","checks":{"database":"connected"}}

# Liveness (always responds)
curl http://localhost:3000/health/live
# {"status":"alive"}
```
