# Package Management Module

## Overview

The Package Management module defines service plans (internet packages) that customers subscribe to. Packages determine speed limits, data quotas, pricing, and can be assigned to specific routers. This is the core pricing and service configuration layer of the EasyISP system.

---

## What It Does in the System

### Core Functionality

1. **Service Package Definition**
   - Create tiered internet packages (e.g., "10 Mbps Home", "50 Mbps Business")
   - Set download/upload speeds
   - Define burst speeds for temporary speed boosts
   - Configure data limits and session times
   - Set pricing per package

2. **Connection Type Support**
   - PPPoE packages (fixed broadband)
   - Hotspot packages (WiFi/voucher access)
   - DHCP packages
   - Static IP packages

3. **Router-Specific Assignment**
   - Assign packages to specific routers
   - One package can be available on multiple routers
   - Control which packages appear on which networks

4. **Customer & Revenue Tracking**
   - Count customers per package
   - Track vouchers per package
   - Calculate revenue by package
   - Router-level revenue breakdown

5. **Package Lifecycle**
   - Enable/disable packages
   - Prevent deletion of packages with active customers
   - Package migration warnings

---

## API Endpoints

### GET `/api/packages`
**Purpose**: List all packages with filtering

**Auth**: Required  
**Permissions**: `packages:view`

**Query Parameters**:
- `type` - Filter by connection type (pppoe, hotspot, dhcp, static)
- `active` - Filter active packages only (true/false)

**Response** (200):
```json
{
  "packages": [
    {
      "id": "uuid",
      "name": "10 Mbps Home",
      "type": "PPPOE",
      "price": 2000,
      "downloadSpeed": 10,      // Mbps
      "uploadSpeed": 10,        // Mbps
      "burstDownload": 15,      // Mbps (optional)
      "burstUpload": 15,        // Mbps (optional)
      "sessionTime": null,      // Minutes (for hotspot)
      "dataLimit": null,        // Bytes (optional)
      "isActive": true,
      "customerCount": 145,
      "voucherCount": 0,
      "routers": [
        {
          "id": "router-uuid",
          "name": "Main Router"
        }
      ],
      "createdAt": "2025-01-01T00:00:00Z"
    },
    {
      "id": "uuid2",
      "name": "1 Hour WiFi - 1GB",
      "type": "HOTSPOT",
      "price": 50,
      "downloadSpeed": 5,
      "uploadSpeed": 5,
      "sessionTime": 60,        // 60 minutes
      "dataLimit": 1073741824,  // 1 GB in bytes
      "isActive": true,
      "customerCount": 0,
      "voucherCount": 250,
      "routers": [
        {
          "id": "hotspot-router-uuid",
          "name": "Cafe Router"
        }
      ],
      "createdAt": "2025-01-01T00:00:00Z"
    }
  ]
}
```

---

### GET `/api/packages/:id`
**Purpose**: Get detailed package information

**Auth**: Required  
**Permissions**: `packages:details_view`

**Response** (200):
```json
{
  "id": "uuid",
  "name": "10 Mbps Home",
  "type": "PPPOE",
  "price": 2000,
  "downloadSpeed": 10,
  "uploadSpeed": 10,
  "burstDownload": 15,
  "burstUpload": 15,
  "sessionTime": null,
  "dataLimit": null,
  "isActive": true,
  "customerCount": 145,
  "voucherCount": 0,
  "routers": [
    {
      "id": "uuid",
      "name": "Main Router"
    }
  ],
  "createdAt": "2025-01-01T00:00:00Z"
}
```

---

### POST `/api/packages`
**Purpose**: Create new package

**Auth**: Required  
**Permissions**: `packages:add_pppoe`

**Request Body**:
```json
{
  "name": "20 Mbps Business",
  "type": "PPPOE",
  "price": 3500,
  "downloadSpeed": 20,
  "uploadSpeed": 20,
  "burstDownload": 30,
  "burstUpload": 30,
  "sessionTime": null,
  "dataLimit": null,
  "routerIds": ["router-uuid-1", "router-uuid-2"],
  "isActive": true
}
```

**Validation**:
- `name`: Required, min 1 character
- `type`: "PPPOE", "HOTSPOT", "DHCP", or "STATIC"
- `price`: Required, positive number
- `downloadSpeed`: Required, positive integer (Mbps)
- `uploadSpeed`: Required, positive integer (Mbps)
- `burstDownload`: Optional, positive integer (Mbps)
- `burstUpload`: Optional, positive integer (Mbps)
- `sessionTime`: Optional, positive integer (minutes)
- `dataLimit`: Optional, positive integer (bytes)
- `routerIds`: Optional array of router UUIDs
- `isActive`: Optional boolean (default: true)

**Response** (201):
```json
{
  "id": "uuid",
  "name": "20 Mbps Business",
  "type": "PPPOE",
  "price": 3500,
  "downloadSpeed": 20,
  "uploadSpeed": 20,
  "isActive": true,
  "routers": [
    {
      "id": "router-uuid-1",
      "name": "Router 1"
    }
  ]
}
```

---

### PUT `/api/packages/:id`
**Purpose**: Update existing package

**Auth**: Required  
**Permissions**: `packages:edit`

**Request Body**: Same as create (all fields optional)

**Business Rules**:
- Cannot disable package if active customers are assigned to it
- Returns error with customer count if attempted

**Response** (200): Updated package object

**Error** (400) if active customers:
```json
{
  "error": "Cannot disable package: 45 customers are still assigned to it. Please migrate them first."
}
```

---

### DELETE `/api/packages/:id`
**Purpose**: Delete package

**Auth**: Required  
**Permissions**: `packages:delete`

**Response** (200):
```json
{
  "success": true
}
```

**Business Rules**:
1. Cannot delete if customers are assigned (must be 0 customers)
2. Cannot delete if unused vouchers exist
3. Deletes associated router assignments
4. Deletes associated pending hotspot payments

**Error** (400):
```json
{
  "error": "Cannot delete package with 25 assigned customers"
}
```

---

### GET `/api/packages/:id/stats`
**Purpose**: Get package statistics

**Auth**: Required  
**Permissions**: `packages:details_view`

**Response** (200):
```json
{
  "totalClients": 145,
  "activeClients": 120,
  "expiredClients": 15,
  "suspendedClients": 10,
  "revenue": 240000
}
```

**Calculations**:
- `totalClients`: All customers with this package (excluding soft-deleted)
- `activeClients`: Customers with status = ACTIVE
- `expiredClients`: Customers with status = EXPIRED
- `suspendedClients`: Total - Active - Expired
- `revenue`: Sum of all completed payments from customers on this package

---

### GET `/api/packages/:id/router-revenue`
**Purpose**: Get revenue breakdown by router

**Auth**: Required  
**Permissions**: `packages:details_view`

**Response** (200):
```json
{
  "revenueByRouter": [
    {
      "routerId": "uuid",
      "routerName": "Main Router",
      "revenue": 150000
    },
    {
      "routerId": "uuid2",
      "routerName": "Branch Router",
      "revenue": 90000
    }
  ]
}
```

---

## What's Complete ✅

1. ✅ Full CRUD operations
2. ✅ Multi-connection type support (PPPoE, Hotspot, DHCP, Static)
3. ✅ Speed configuration (download, upload, burst)
4. ✅ Data quotas and session time limits
5. ✅ Pricing per package
6. ✅ Router-specific assignment
7. ✅ Active/inactive toggle
8. ✅ Customer count tracking
9. ✅ Voucher count tracking
10. ✅ Revenue calculation
11. ✅ Router-level revenue breakdown
12. ✅ Protection against deleting packages with active customers
13. ✅ Package statistics

---

## What's NOT Complete ⚠️

1. ⚠️ **Package Templates**: No predefined package templates (Starter, Standard, Premium)
2. ⚠️ **Package Expiry**: No automatic package discontinuation date
3. ⚠️ **Family Plans**: No shared data pools across multiple customers
4. ⚠️ **Speed Throttling**: No time-based speed changes (e.g., slower during peak hours)
5. ⚠️ **Package Recommendations**: No AI/analytics for package upselling
6. ⚠️ **Package Bundles**: No bundle discounts (e.g., Internet + IPTV)
7. ⚠️ **Fair Usage Policy (FUP)**: No speed reduction after quota
8. ⚠️ **Package History**: No version history for package changes
9. ⚠️ **Package Comparison**: No API to compare multiple packages
10. ⚠️ **Trial Packages**: No free trial or discounted first month

---

## What's Working ✅

All implemented features are functional:
- Package creation with all attributes
- Router assignment (many-to-many relationship)
- Customer and voucher counting
- Revenue tracking
- Deletion protection
- Enable/disable toggle

---

## What's NOT Working ❌

No critical issues. Minor concerns:

1. **Performance**: Revenue calculation for packages with 10k+ customers may be slow
2. **Migration Tool**: No built-in tool to migrate customers between packages

---

## Security Issues 🔐

### Medium Priority

1. **No Price History**
   - **Risk**: Package price changes affect historical revenue reports
   - **Impact**: Inaccurate financial reporting
   - **Mitigation**: Store price at time of sale in Payment record (already done ✅)

2. **No Audit Trail for Changes**
   - **Risk**: No record of who changed package prices or speeds
   - **Impact**: Accountability issues
   - **Mitigation**: Add audit logging for package modifications

3. **Unlimited Package Creation**
   - **Risk**: Tenants can create thousands of packages
   - **Impact**: UI clutter, performance degradation
   - **Mitigation**: Limit to 100 packages per tenant

### Low Priority

4. **No Package Approval Workflow**
   - **Risk**: Any admin can create/modify packages
   - **Impact**: Unauthorized pricing changes
   - **Mitigation**: Require approval from senior admin for new packages

---

## Possible Improvements 🚀

### High Priority

1. **Package Templates**
   ```typescript
   POST /api/packages/from-template
   {
     "template": "RESIDENTIAL_STARTER",
     "customizations": {
       "price": 1500  // Override template price
     }
   }
   
   // Predefined templates:
   // - RESIDENTIAL_STARTER (5 Mbps)
   // - RESIDENTIAL_STANDARD (10 Mbps)
   // - RESIDENTIAL_PREMIUM (20 Mbps)
   // - BUSINESS_BASIC (30 Mbps)
   // - BUSINESS_PRO (100 Mbps)
   // - HOTSPOT_1HOUR
   // - HOTSPOT_1DAY
   // - HOTSPOT_1WEEK
   ```

2. **Customer Migration Tool**
   ```typescript
   POST /api/packages/:id/migrate
   {
     "targetPackageId": "new-package-uuid",
     "customerIds": ["uuid1", "uuid2", ...],
     "effectiveDate": "2026-02-01",  // Optional: migrate on specific date
     "sendNotification": true  // Send SMS to affected customers
   }
   ```

3. **Package Comparison API**
   ```typescript
   GET /api/packages/compare?ids=uuid1,uuid2,uuid3
   
   // Returns side-by-side comparison
   {
     "packages": [
       {
         "id": "uuid1",
         "name": "Basic",
         "price": 1000,
         "features": {
           "speed": "5/5 Mbps",
           "data": "Unlimited",
           "support": "Email"
         }
       },
       {
         "id": "uuid2",
         "name": "Standard",
         "price": 2000,
         "features": {
           "speed": "10/10 Mbps",
           "data": "Unlimited",
           "support": "Phone + Email"
         }
       }
     ]
   }
   ```

4. **Fair Usage Policy (FUP)**
   ```typescript
   {
     "name": "100 Gbps Unlimited*",
     "fupEnabled": true,
     "fupThreshold": 107374182400,  // 100 GB
     "fupDownloadSpeed": 5,  // Throttle to 5 Mbps after
     "fupUploadSpeed": 5,
     "fupResetDay": 1  // Reset on 1st of month
   }
   ```

### Medium Priority

5. **Package Add-Ons**
   ```typescript
   {
     "basePackage": "10 Mbps Home",
     "addOns": [
       {
         "name": "Extra 50 GB",
         "price": 300,
         "dataBoost": 53687091200  // 50 GB
       },
       {
         "name": "Speed Boost (Double)",
         "price": 500,
         "speedMultiplier": 2
       }
     ]
   }
   ```

6. **Time-Based Pricing**
   ```typescript
   {
     "name": "Dynamic Package",
     "pricing": [
       {
         "dayOfWeek": "WEEKDAY",
         "hours": "9-17",
         "price": 2000
       },
       {
         "dayOfWeek": "WEEKEND",
         "price": 1500
       }
     ]
   }
   ```

7. **Package Recommendations**
   ```typescript
   GET /api/packages/recommend/:customerId
   
   // Uses AI/analytics to suggest package based on:
   // - Customer usage patterns
   // - Current package utilization
   // - Budget (based on payment history)
   // - Similar customers
   ```

8. **Trial Packages**
   ```typescript
   {
     "name": "10 Mbps Trial",
     "isTrial": true,
     "trialDuration": 7,  // 7 days
     "fullPrice": 2000,
     "trialPrice": 500,  // Discounted
     "autoConvertToPackageId": "full-package-uuid"
   }
   ```

### Low Priority

9. **Package Bundles**
   ```typescript
   {
     "name": "Internet + IPTV Bundle",
     "bundleType": "COMBO",
     "packages": [
       {
         "packageId": "internet-10mbps",
         "discountPercentage": 10
       },
       {
         "packageId": "iptv-basic",
         "discountPercentage": 20
       }
     ],
     "totalPrice": 2500,  // vs 3000 individual
     "savings": 500
   }
   ```

10. **Package Versioning**
    ```typescript
    GET /api/packages/:id/history
    
    // Returns all historical versions
    {
      "versions": [
        {
          "version": 2,
          "price": 2500,
          "effectiveDate": "2026-01-01",
          "changedBy": "admin@isp.com"
        },
        {
          "version": 1,
          "price": 2000,
          "effectiveDate": "2025-01-01",
          "changedBy": "admin@isp.com"
        }
      ]
    }
    ```

---

## Database Schema

### Package Model (Prisma)

```prisma
model Package {
  id            String         @id @default(uuid())
  name          String
  type          ConnectionType  // PPPOE, HOTSPOT, DHCP, STATIC
  price         Float
  downloadSpeed Int            // Mbps
  uploadSpeed   Int            // Mbps
  burstDownload Int?           // Mbps
  burstUpload   Int?           // Mbps
  sessionTime   Int?           // Minutes (for hotspot)
  dataLimit     BigInt?        // Bytes
  isActive      Boolean        @default(true)
  tenantId      String
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt

  // Relations
  tenant    Tenant          @relation(fields: [tenantId], references: [id])
  customers Customer[]
  vouchers  Voucher[]
  routers   PackageRouter[]  // Many-to-many with routers
  
  @@index([tenantId])
  @@index([tenantId, type])
}

model PackageRouter {
  id        String   @id @default(uuid())
  packageId String
  nasId     String
  
  package   Package  @relation(fields: [packageId], references: [id])
  nas       NAS      @relation(fields: [nasId], references: [id])

  @@unique([packageId, nasId])
}
```

---

## Performance Considerations

### Database Indexing

Current indexes:
```prisma
@@index([tenantId])
@@index([tenantId, type])
```

**Recommended additions**:
```prisma
@@index([tenantId, isActive])  // Filter active packages
@@index([price])                // Sort by price
```

### Optimization Tips

1. **Eager Load Counts**: Use `_count` relation in Prisma for customer/voucher counts
2. **Cache Popular Packages**: Cache top 10 packages in Redis (1-hour TTL)
3. **Paginate Results**: For tenants with 100+ packages

---

## Related Modules

- **Customer Management**: Customers are assigned to packages
- **Voucher System**: Vouchers are linked to packages
- **RADIUS Server**: Returns package speed limits during auth
- **MikroTik Integration**: Applies package speed limits to customers
- **Payment Module**: Package price used in payments
- **Finance Module**: Revenue tracking by package
- **Hotspot Portal**: Displays available packages

---

## Testing Recommendations

1. **Unit Tests**
   - Package validation (speeds, prices, quotas)
   - Revenue calculation logic
   - Router assignment logic

2. **Integration Tests**
   - Create package → verify in DB
   - Update package → verify customers retain old price
   - Delete package with customers → expect error
   - Disable package with active customers → expect error

3. **Load Tests**
   - List 1000 packages
   - Calculate revenue for package with 10k customers
   - Bulk create 100 packages

---

## Common Use Cases

### 1. Residential ISP Packages
```typescript
// Create tiered packages
const packages = [
  { name: "Home Basic", speed: 5, price: 1000 },
  { name: "Home Standard", speed: 10, price: 2000 },
  { name: "Home Premium", speed: 20, price: 3500 },
  { name: "Home Ultra", speed: 50, price: 7000 }
];
```

### 2. Cafe Hotspot Packages
```typescript
// Time-based WiFi packages
const packages = [
  { name: "1 Hour WiFi", sessionTime: 60, price: 50 },
  { name: "Full Day WiFi", sessionTime: 1440, price: 200 },
  { name: "Weekly WiFi", sessionTime: 10080, price: 1000 }
];
```

### 3. Data-Capped Mobile Internet
```typescript
// Data bundle packages
const packages = [
  { name: "1 GB Daily", dataLimit: GB(1), sessionTime: 1440, price: 100 },
  { name: "5 GB Weekly", dataLimit: GB(5), sessionTime: 10080, price: 400 },
  { name: "20 GB Monthly", dataLimit: GB(20), sessionTime: 43200, price: 1200 }
];
```

---

## Migration Path

1. **Immediate** (Week 1):
   - Add audit logging for package changes
   - Implement package comparison API
   - Build customer migration tool

2. **Short-term** (Month 1):
   - Create package templates
   - Implement trial packages
   - Add Fair Usage Policy support

3. **Long-term** (Quarter 1):
   - Build package bundles
   - Implement time-based pricing
   - Add AI-powered recommendations
   - Create package versioning system
