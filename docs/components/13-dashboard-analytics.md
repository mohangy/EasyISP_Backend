# Dashboard & Analytics Module

## Overview

The Dashboard module provides aggregated statistics and revenue trend data for the tenant's dashboard UI. It summarizes customer counts, payment data, voucher statistics, and revenue trends.

**Source File**: `/root/easyisp/Backend/src/routes/dashboard.routes.ts` (189 lines, 6 KB)

---

## What It Does in the System

1. **Customer Statistics** - Total, PPPoE, Hotspot, and active customer counts
2. **Revenue Summary** - Monthly and daily revenue totals
3. **Voucher Stats** - Available and used voucher counts
4. **Revenue Trends** - Monthly revenue aggregation for charts
5. **Network Usage** - Placeholder for future SNMP/RADIUS integration

---

## API Endpoints

### GET `/api/dashboard/stats`
**Purpose**: Get main dashboard statistics

**Auth**: Required  
**Permission**: `dashboard:view`

**Response** (200):
```json
{
  "activeSessions": 0,
  "totalCustomers": 250,
  "pppoeCustomers": 180,
  "hotspotCustomers": 70,
  "activeCustomers": 195,
  "monthlyRevenue": 450000,
  "todayRevenue": 15000,
  "activeVouchers": 50,
  "usedVouchers": 300
}
```

**What It Calculates**:
- `totalCustomers` - All customers (soft-deleted excluded)
- `pppoeCustomers` - Customers with `connectionType: 'PPPOE'`
- `hotspotCustomers` - Customers with `connectionType: 'HOTSPOT'`
- `activeCustomers` - Customers with `status: 'ACTIVE'`
- `monthlyRevenue` - Completed payments this month
- `todayRevenue` - Completed payments today
- `activeVouchers` - Vouchers with `status: 'AVAILABLE'`
- `usedVouchers` - Vouchers with `status: 'USED'`
- `activeSessions` - **Always 0** (TODO: Integrate with RADIUS)

---

### GET `/api/dashboard/revenue`
**Purpose**: Get revenue trend data for charts

**Auth**: Required  
**Permission**: `dashboard:payments`

**Query Parameters**:
- `period` - Time range: `this_month`, `this_year`, `last_year` (default: `this_year`)

**Response** (200):
```json
{
  "revenueTrend": [
    { "month": "Jan", "amount": 380000 },
    { "month": "Feb", "amount": 420000 },
    { "month": "Mar", "amount": 455000 },
    ...
    { "month": "Dec", "amount": 0 }
  ],
  "totalByPeriod": {
    "today": 15000,
    "thisWeek": 85000,
    "thisMonth": 450000,
    "thisYear": 4500000
  }
}
```

**What It Does**:
1. Fetches all completed payments since start of period
2. Aggregates by month for `revenueTrend` array
3. Calculates separate totals for today/week/month/year

---

### GET `/api/dashboard/network-usage`
**Purpose**: Get network bandwidth usage (placeholder)

**Auth**: Required  
**Permission**: `dashboard:network_usage`

**Response** (200):
```json
{
  "usageTrend": [
    { "month": "Jan", "usage": 0 },
    { "month": "Feb", "usage": 0 },
    ...
  ],
  "totalByPeriod": {
    "today": 0,
    "thisWeek": 0,
    "thisMonth": 0,
    "thisYear": 0
  }
}
```

**Current Status**: Returns zeros. TODO: Integrate with RADIUS session accounting.

---

## What's Complete ✅

1. ✅ Customer count by type (PPPoE/Hotspot)
2. ✅ Active customer count
3. ✅ Monthly and daily revenue
4. ✅ Voucher statistics
5. ✅ Revenue trend aggregation by month
6. ✅ Period-based totals (today, week, month, year)

---

## What's NOT Complete ⚠️

1. ⚠️ **Active Sessions** - Always returns 0, not integrated with RADIUS/Session table
2. ⚠️ **Network Usage** - Placeholder endpoint returning zeros
3. ⚠️ **Customer Growth Trend** - No new customer trend
4. ⚠️ **Expense Summary** - No expense data in stats
5. ⚠️ **Top Packages** - No package popularity data
6. ⚠️ **Customer Expiring Soon** - No upcoming expiry alerts

---

## What's Working ✅

All implemented features are functional:
- Customer counts ✓
- Revenue aggregation ✓
- Voucher statistics ✓

---

## What's NOT Working ❌

1. **Active Sessions Count**
   - Line 70: `const activeSessions = 0; // TODO`
   - **Fix**: Query Session table for active sessions:
   ```typescript
   const activeSessions = await prisma.session.count({
       where: { tenantId, stopTime: null }
   });
   ```

---

## Security Issues 🔐

Low priority - no significant security concerns.

---

## Possible Improvements 🚀

### High Priority

1. **Integrate Active Sessions**
   ```typescript
   const activeSessions = await prisma.session.count({
       where: { tenantId, stopTime: null }
   });
   ```

2. **Network Usage from Sessions**
   ```typescript
   const usageByMonth = await prisma.session.groupBy({
       by: ['tenantId'],
       where: { tenantId, startTime: { gte: startOfYear } },
       _sum: { inputOctets: true, outputOctets: true }
   });
   ```

### Medium Priority

3. **Customer Growth Trend**
4. **Expiring Customers Alert**
5. **Top 5 Packages by Revenue**

---

## Related Modules

- **Customer Management** - Source of customer stats
- **Payment Module** - Source of revenue data
- **Voucher System** - Source of voucher stats
- **Session Management** - Should provide active sessions
- **RADIUS Server** - Source of network usage
