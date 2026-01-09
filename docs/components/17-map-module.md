# Map Module

## Overview

The Map module provides geographic visualization data for customers and routers, enabling network operators to see their infrastructure on a map with real-time online/offline status.

**Source File**: `/root/easyisp/Backend/src/routes/map.routes.ts` (127 lines, 4 KB)

---

## What It Does in the System

1. **Customer Locations** - Returns GPS coordinates for all customers
2. **Router Locations** - Returns GPS coordinates for all routers/NAS
3. **Online Status** - Indicates which customers are currently connected
4. **Coverage Statistics** - Calculates active/online counts
5. **Map Center** - Calculates center point for map initialization

---

## API Endpoints

### GET `/api/map/data`
**Purpose**: Get all map markers (customers and routers)

**Auth**: Required  
**Permission**: `maps:view`

**Response** (200):
```json
{
  "customers": [
    {
      "id": "uuid",
      "type": "customer",
      "name": "John Doe",
      "username": "john001",
      "latitude": -1.2921,
      "longitude": 36.8219,
      "status": "active",
      "connectionType": "pppoe",
      "ipAddress": "10.0.0.50",
      "expiresAt": "2026-02-01T00:00:00Z",
      "package": {
        "id": "pkg-uuid",
        "name": "Premium 20Mbps"
      },
      "location": "Westlands, Nairobi",
      "isOnline": true,
      "sessionStartTime": "2026-01-04T08:00:00Z"
    }
  ],
  "routers": [
    {
      "id": "uuid",
      "type": "router",
      "name": "Main POP",
      "ipAddress": "203.0.113.1",
      "status": "online",
      "customerCount": 150,
      "latitude": -1.2800,
      "longitude": 36.8100,
      "location": "CBD Tower"
    }
  ],
  "stats": {
    "totalCustomers": 250,
    "activeCustomers": 195,
    "totalRouters": 5,
    "onlineRouters": 4
  },
  "center": {
    "latitude": -1.2850,
    "longitude": 36.8150
  }
}
```

---

## Data Collection

### Customer Markers

```typescript
const customers = await prisma.customer.findMany({
    where: {
        tenantId,
        deletedAt: null,
        latitude: { not: null },   // Only customers with GPS
        longitude: { not: null },
    },
    select: {
        id: true,
        name: true,
        username: true,
        latitude: true,
        longitude: true,
        status: true,
        connectionType: true,
        location: true,
        lastIp: true,
        expiresAt: true,
        package: { select: { id: true, name: true } },
    },
});
```

### Online Status Detection

```typescript
// Get active sessions (connected now)
const activeSessions = await prisma.session.findMany({
    where: {
        tenantId,
        stopTime: null,  // Active = no stop time
    },
    select: {
        customerId: true,
        framedIp: true,
        startTime: true,
    },
});

// Map customer ID to session data
const onlineCustomerMap = new Map(
    activeSessions
        .filter(s => s.customerId)
        .map(s => [s.customerId, { ip: s.framedIp, startTime: s.startTime }])
);

// For each customer, check if they're in the online map
const isOnline = onlineCustomerMap.has(customer.id);
```

### Router Markers

```typescript
const routers = await prisma.nAS.findMany({
    where: { tenantId },
    select: {
        id: true,
        name: true,
        ipAddress: true,
        status: true,
        latitude: true,
        longitude: true,
        location: true,
        _count: { select: { customers: true } },  // Customer count per router
    },
});
```

### Map Center Calculation

```typescript
// Calculate center from customer locations (average latitude/longitude)
const center = customers.length > 0
    ? {
        latitude: customers.reduce((sum, c) => sum + (c.latitude ?? 0), 0) / customers.length,
        longitude: customers.reduce((sum, c) => sum + (c.longitude ?? 0), 0) / customers.length,
    }
    : { latitude: -1.2921, longitude: 36.8219 };  // Default to Nairobi
```

---

## What's Complete ✅

1. ✅ Customer markers with GPS coordinates
2. ✅ Router markers with GPS coordinates
3. ✅ Real-time online status from Session table
4. ✅ Customer count per router
5. ✅ Statistics (total/active customers, total/online routers)
6. ✅ Dynamic map center calculation
7. ✅ Package information on customer markers
8. ✅ Session start time for online customers

---

## What's NOT Complete ⚠️

1. ⚠️ **Clustering** - No server-side marker clustering for large datasets
2. ⚠️ **Coverage Areas** - No polygon rendering for coverage zones
3. ⚠️ **Real-time Updates** - No WebSocket for live status changes
4. ⚠️ **Filtering** - No filter by status, package, or router
5. ⚠️ **Search** - No search by customer name/location
6. ⚠️ **Router-Customer Lines** - No visual connection lines
7. ⚠️ **Heatmaps** - No density visualization
8. ⚠️ **Update Location** - No endpoint to update GPS coordinates

---

## What's Working ✅

All implemented features are functional:
- Customer markers with location ✓
- Router markers ✓
- Online status detection ✓
- Map center calculation ✓

---

## What's NOT Working ❌

No critical issues found.

---

## Security Issues 🔐

### Low Priority

1. **Customer Location Exposure**
   - GPS coordinates expose customer physical locations
   - Should only be visible to authorized operators
   - Already protected by `maps:view` permission ✓

---

## Possible Improvements 🚀

### High Priority

1. **Server-Side Clustering**
   ```typescript
   // For 1000+ customers, cluster nearby markers
   const clusters = clusterMarkers(customers, zoomLevel);
   ```

2. **Real-Time WebSocket**
   ```typescript
   // Push updates when session starts/stops
   io.emit('customer:online', { customerId, ip, startTime });
   io.emit('customer:offline', { customerId });
   ```

3. **Filtering Endpoint**
   ```typescript
   GET /api/map/data?status=active&router=uuid&isOnline=true
   ```

### Medium Priority

4. **Coverage Area Polygons**
5. **Customer-Router Connection Lines**
6. **Usage Heatmap**

---

## Related Modules

- **Customer Management** - Source of customer locations
- **NAS Management** - Source of router locations
- **Session Management** - Source of online status

---

## Frontend Integration

The frontend can use this data with mapping libraries:

```javascript
// Using Leaflet.js
const response = await fetch('/api/map/data');
const { customers, routers, center } = await response.json();

// Initialize map at center
const map = L.map('map').setView([center.latitude, center.longitude], 12);

// Add customer markers
customers.forEach(c => {
    const icon = c.isOnline ? greenIcon : (c.status === 'active' ? blueIcon : redIcon);
    L.marker([c.latitude, c.longitude], { icon })
        .bindPopup(`<b>${c.name}</b><br>${c.package?.name || 'No package'}`)
        .addTo(map);
});

// Add router markers
routers.forEach(r => {
    L.marker([r.latitude, r.longitude], { icon: routerIcon })
        .bindPopup(`<b>${r.name}</b><br>${r.customerCount} customers`)
        .addTo(map);
});
```
