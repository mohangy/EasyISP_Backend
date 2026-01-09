# Finance Module

## Overview

The Finance module handles income/expense tracking, chart of accounts, and invoicing for ISP financial management. It provides basic accounting features with income from customer payments and manual entries.

**Source File**: `/root/easyisp/Backend/src/routes/finance.routes.ts` (498 lines, 15.4 KB)

---

## What It Does in the System

1. **Income Tracking** - List, filter, and aggregate completed payments
2. **Manual Income Entry** - Record cash/bank income not from M-Pesa
3. **Expense Tracking** - Record and categorize business expenses
4. **Chart of Accounts** - Double-entry accounting structure
5. **Invoice Management** - Create, track, and manage customer invoices

---

## API Endpoints

### Income Endpoints

#### GET `/api/finance/income`
**Purpose**: List income transactions with aggregations

**Auth**: Required  
**Permission**: `finance:income_view`

**Query Parameters**:
- `page`, `pageSize` (default: 20)
- `search` - Search description or transaction ID
- `method` - Filter by payment method
- `startDate`, `endDate` - Date range filter

**Response** (200):
```json
{
  "transactions": [
    {
      "id": "uuid",
      "date": "2026-01-04T12:00:00Z",
      "customer": "John Doe",
      "description": "Payment",
      "amount": 2000,
      "method": "MPESA",
      "reference": "QBX123ABC",
      "status": "completed"
    }
  ],
  "stats": {
    "totalIncome": 150000,
    "mpesaTotal": 120000,
    "cashTotal": 30000,
    "totalTransactions": 75
  },
  "total": 75,
  "page": 1,
  "pageSize": 20
}
```

**Aggregations**:
- `totalIncome`: Sum of all completed payments
- `mpesaTotal`: Sum of M-Pesa payments
- `cashTotal`: Sum of cash payments
- `totalTransactions`: Count of transactions

---

#### POST `/api/finance/income`
**Purpose**: Record manual income entry

**Auth**: Required  
**Permission**: `finance:income_create`

**Request Body**:
```json
{
  "customerName": "John Doe",
  "amount": 5000,
  "method": "Cash",
  "reference": "RCP-001",
  "date": "2026-01-04",
  "description": "Internet subscription"
}
```

**Supported Methods**:
- `M-Pesa` → `MPESA`
- `Cash` → `CASH`
- `Bank Transfer` → `BANK_TRANSFER`
- `Card` → `CARD`
- `Other` → `OTHER`

---

### Expense Endpoints

#### GET `/api/finance/expenses`
**Purpose**: List expenses with category totals

**Auth**: Required  
**Permission**: `finance:expenses_view`

**Query Parameters**:
- `page`, `pageSize` (default: 20)
- `search` - Search description or vendor
- `category` - Filter by category

**Response** (200):
```json
{
  "expenses": [
    {
      "id": "uuid",
      "description": "Bandwidth - January",
      "category": "Bandwidth",
      "vendor": "ISP Upstream",
      "amount": 50000,
      "paymentMethod": "Bank Transfer",
      "date": "2026-01-01T00:00:00Z",
      "isRecurring": true
    }
  ],
  "stats": {
    "totalExpenses": 150000,
    "byCategory": {
      "Bandwidth": 50000,
      "Salaries": 80000,
      "Equipment": 20000
    }
  },
  "total": 15,
  "page": 1,
  "pageSize": 20
}
```

---

#### POST `/api/finance/expenses`
**Purpose**: Record new expense

**Auth**: Required  
**Permission**: `finance:expenses_create`

**Request Body**:
```json
{
  "description": "Office Rent - January",
  "category": "Rent",
  "vendor": "Property Manager",
  "amount": 25000,
  "date": "2026-01-01",
  "paymentMethod": "Bank Transfer",
  "isRecurring": true,
  "notes": "Monthly rent"
}
```

---

### Chart of Accounts

#### GET `/api/finance/accounts`
**Purpose**: List chart of accounts

**Auth**: Required  
**Permission**: `finance:dashboard_view`

**Query Parameters**:
- `type` - Filter by account type (Asset, Liability, Equity, Revenue, Expense)

**Response** (200):
```json
[
  {
    "id": "uuid",
    "code": "1001",
    "name": "Cash on Hand",
    "type": "Asset",
    "balance": 50000,
    "isSystem": true,
    "description": "Physical cash"
  },
  {
    "id": "uuid",
    "code": "4001",
    "name": "Internet Revenue",
    "type": "Revenue",
    "balance": 250000,
    "isSystem": false,
    "description": "Customer subscriptions"
  }
]
```

---

#### POST `/api/finance/accounts`
**Purpose**: Create new account

**Auth**: Required  
**Permission**: `finance:dashboard_view`

**Request Body**:
```json
{
  "code": "5002",
  "name": "Marketing Expenses",
  "type": "Expense",
  "description": "Advertising and promotions"
}
```

**Account Types**:
- `Asset` - Things you own (cash, equipment, receivables)
- `Liability` - Things you owe (loans, payables)
- `Equity` - Owner's investment
- `Revenue` - Income earned
- `Expense` - Costs incurred

---

#### DELETE `/api/finance/accounts/:id`
**Purpose**: Delete an account

**Auth**: Required  
**Permission**: `finance:dashboard_view`

**Business Rules**:
- Cannot delete system accounts (`isSystem: true`)

---

### Invoice Endpoints

#### GET `/api/finance/invoices`
**Purpose**: List invoices with status summary

**Auth**: Required  
**Permission**: `finance:dashboard_view`

**Query Parameters**:
- `page`, `pageSize` (default: 20)
- `search` - Search invoice number or customer name
- `status` - Filter by status (pending, paid, overdue, cancelled)

**Response** (200):
```json
{
  "invoices": [
    {
      "id": "INV-20260001",
      "customerId": "uuid",
      "customerName": "John Doe",
      "amount": 5000,
      "status": "pending",
      "dueDate": "2026-01-15T00:00:00Z",
      "items": [
        { "description": "Internet - January", "amount": 5000 }
      ],
      "createdAt": "2026-01-01T00:00:00Z"
    }
  ],
  "stats": {
    "total": 250000,
    "paid": 200000,
    "pending": 40000,
    "overdue": 10000
  },
  "total": 50,
  "page": 1,
  "pageSize": 20
}
```

---

#### POST `/api/finance/invoices`
**Purpose**: Create new invoice

**Auth**: Required  
**Permission**: `finance:dashboard_view`

**Request Body**:
```json
{
  "customerId": "uuid",
  "amount": 5000,
  "dueDate": "2026-01-15",
  "items": [
    { "description": "Internet Subscription - Premium", "amount": 4000 },
    { "description": "Router Rental", "amount": 1000 }
  ]
}
```

**Invoice Number Generation**:
```typescript
const invoiceNo = `INV-${new Date().getFullYear()}${String(count + 1).padStart(4, '0')}`;
// Example: INV-20260001, INV-20260002, etc.
```

---

#### PUT `/api/finance/invoices/:id/status`
**Purpose**: Update invoice status

**Auth**: Required  
**Permission**: `finance:dashboard_view`

**Request Body**:
```json
{
  "status": "paid"
}
```

**Status Values**:
- `pending` - Awaiting payment
- `paid` - Payment received (sets `paidAt` timestamp)
- `overdue` - Past due date
- `cancelled` - Cancelled/voided

---

## What's Complete ✅

1. ✅ Income listing with filtering and search
2. ✅ Income aggregation by payment method
3. ✅ Manual income recording
4. ✅ Date range filtering for income
5. ✅ Expense CRUD operations
6. ✅ Expense categorization
7. ✅ Expense totals by category
8. ✅ Recurring expense flag
9. ✅ Chart of accounts CRUD
10. ✅ Account type filtering
11. ✅ System account protection
12. ✅ Invoice creation with line items
13. ✅ Auto-generated invoice numbers
14. ✅ Invoice status management
15. ✅ Invoice aggregation by status

---

## What's NOT Complete ⚠️

1. ⚠️ **Profit/Loss Statement** - No P&L report endpoint
2. ⚠️ **Balance Sheet** - No balance sheet generation
3. ⚠️ **Cash Flow Statement** - No cash flow tracking
4. ⚠️ **Tax Calculations** - No VAT/tax handling
5. ⚠️ **Journal Entries** - No double-entry journaling
6. ⚠️ **Recurring Expenses Auto-Creation** - `isRecurring` flag exists but not processed
7. ⚠️ **Invoice PDF Generation** - No PDF export
8. ⚠️ **Invoice Email Sending** - No email integration
9. ⚠️ **Overdue Auto-Detection** - No cron to mark overdue invoices
10. ⚠️ **Payment Linking** - Payments not linked to invoices
11. ⚠️ **Multi-Currency** - No currency support
12. ⚠️ **Financial Year Closing** - No year-end procedures

---

## What's Working ✅

All implemented features are functional:
- Income/expense tracking ✓
- Chart of accounts ✓
- Invoice management ✓
- Status/category aggregations ✓

---

## What's NOT Working ❌

No critical issues. Minor concerns:

1. **Customer Link on Manual Income**
   - `customerName` stored in `account` field
   - Not linked to actual Customer record
   - **Fix**: Add optional `customerId` to schema

---

## Security Issues 🔐

### Low Priority

1. **Permission Reuse**
   - Most endpoints use `finance:dashboard_view`
   - Should have separate permissions for create/delete

2. **No Audit Trail**
   - No logging of who modified invoices/accounts
   - **Fix**: Add audit log entries

---

## Possible Improvements 🚀

### High Priority

1. **Link Payments to Invoices**
   ```typescript
   // Add to Payment model
   invoiceId?: String
   
   // When payment received, mark invoice paid
   await prisma.invoice.update({
       where: { id: payment.invoiceId },
       data: { status: 'paid', paidAt: new Date() }
   });
   ```

2. **Overdue Detection Cron**
   ```typescript
   // Run daily
   await prisma.invoice.updateMany({
       where: {
           status: 'pending',
           dueDate: { lt: new Date() }
       },
       data: { status: 'overdue' }
   });
   ```

3. **Profit/Loss Endpoint**
   ```typescript
   GET /api/finance/reports/profit-loss?year=2026&month=1
   
   {
       "revenue": 500000,
       "expenses": 300000,
       "netProfit": 200000,
       "breakdown": {
           "revenue": { "Subscriptions": 450000, "Setup Fees": 50000 },
           "expenses": { "Bandwidth": 100000, "Salaries": 150000, ... }
       }
   }
   ```

### Medium Priority

4. **Invoice PDF Generation**
   - Use puppeteer or PDFKit
   - Include company branding

5. **Recurring Expense Processing**
   ```typescript
   // Monthly cron job
   const recurring = await prisma.expense.findMany({
       where: { isRecurring: true }
   });
   for (const expense of recurring) {
       await prisma.expense.create({
           data: { ...expense, id: undefined, date: new Date() }
       });
   }
   ```

---

## Related Modules

- **Payment Module** - Source of income data
- **Customer Management** - Customer references
- **Dashboard** - Financial summaries
- **Audit Logging** - Should track changes

---

## Testing Recommendations

1. **Unit Tests**
   - Invoice number generation format
   - Method mapping (M-Pesa → MPESA)
   - Date filtering logic

2. **Integration Tests**
   - Create income → verify in listing
   - Create invoice → update status → verify
   - Category aggregation accuracy

---

## Migration Path

1. **Immediate** (Week 1):
   - Add audit logging for financial mutations
   - Implement overdue detection cron

2. **Short-term** (Month 1):
   - Link payments to invoices
   - Add P&L report endpoint
   - Implement recurring expense processing

3. **Long-term** (Quarter 1):
   - Add PDF invoice generation
   - Implement balance sheet
   - Add tax/VAT calculations
