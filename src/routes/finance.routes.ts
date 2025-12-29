import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requirePermission } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

export const financeRoutes = new Hono();

// Apply auth middleware to all routes
financeRoutes.use('*', authMiddleware);

// ============ INCOME ENDPOINTS ============

const recordIncomeSchema = z.object({
    customerName: z.string().min(1),
    amount: z.number().positive(),
    method: z.enum(['M-Pesa', 'Cash', 'Bank Transfer', 'Card', 'Other']),
    reference: z.string().optional(),
    date: z.string().optional(),
    description: z.string().optional(),
});

// GET /api/finance/income
financeRoutes.get('/income', requirePermission('finance:income_view'), async (c) => {
    const tenantId = c.get('tenantId');
    const page = parseInt(c.req.query('page') ?? '1');
    const pageSize = parseInt(c.req.query('pageSize') ?? '20');
    const search = c.req.query('search');
    const method = c.req.query('method');
    const startDate = c.req.query('startDate');
    const endDate = c.req.query('endDate');

    interface WhereClause {
        tenantId: string;
        status: string;
        method?: { equals: string; mode: 'insensitive' };
        createdAt?: { gte?: Date; lte?: Date };
        OR?: Array<{
            description?: { contains: string; mode: 'insensitive' };
            transactionId?: { contains: string; mode: 'insensitive' };
        }>;
    }

    const where: WhereClause = { tenantId, status: 'COMPLETED' };

    if (method) {
        where.method = { equals: method, mode: 'insensitive' };
    }

    if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = new Date(startDate);
        if (endDate) where.createdAt.lte = new Date(endDate);
    }

    if (search) {
        where.OR = [
            { description: { contains: search, mode: 'insensitive' } },
            { transactionId: { contains: search, mode: 'insensitive' } },
        ];
    }

    const [transactions, total, mpesaTotal, cashTotal] = await Promise.all([
        prisma.payment.findMany({
            where: where as Parameters<typeof prisma.payment.findMany>[0]['where'],
            include: {
                customer: { select: { name: true, username: true } },
            },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.payment.aggregate({
            where: where as Parameters<typeof prisma.payment.aggregate>[0]['where'],
            _sum: { amount: true },
            _count: true,
        }),
        prisma.payment.aggregate({
            where: { ...where, method: 'MPESA' } as Parameters<typeof prisma.payment.aggregate>[0]['where'],
            _sum: { amount: true },
        }),
        prisma.payment.aggregate({
            where: { ...where, method: 'CASH' } as Parameters<typeof prisma.payment.aggregate>[0]['where'],
            _sum: { amount: true },
        }),
    ]);

    return c.json({
        transactions: transactions.map((t) => ({
            id: t.id,
            date: t.createdAt,
            customer: t.customer?.name ?? t.account ?? 'Unknown',
            description: t.description ?? 'Payment',
            amount: t.amount,
            method: t.method,
            reference: t.transactionId,
            status: t.status.toLowerCase(),
        })),
        stats: {
            totalIncome: total._sum.amount ?? 0,
            mpesaTotal: mpesaTotal._sum.amount ?? 0,
            cashTotal: cashTotal._sum.amount ?? 0,
            totalTransactions: total._count,
        },
        total: total._count,
        page,
        pageSize,
    });
});

// POST /api/finance/income
financeRoutes.post('/income', requirePermission('finance:income_create'), async (c) => {
    const tenantId = c.get('tenantId');
    const body = await c.req.json();
    const data = recordIncomeSchema.parse(body);

    // Map method string to enum
    const methodMap: Record<string, string> = {
        'M-Pesa': 'MPESA',
        'Cash': 'CASH',
        'Bank Transfer': 'BANK_TRANSFER',
        'Card': 'CARD',
        'Other': 'OTHER',
    };

    const payment = await prisma.payment.create({
        data: {
            amount: data.amount,
            method: (methodMap[data.method] ?? 'OTHER') as 'MPESA' | 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'OTHER',
            status: 'COMPLETED',
            description: data.description ?? `Income from ${data.customerName}`,
            transactionId: data.reference,
            account: data.customerName,
            tenantId,
            createdAt: data.date ? new Date(data.date) : new Date(),
        },
    });

    return c.json(payment, 201);
});

// ============ EXPENSE ENDPOINTS ============

const createExpenseSchema = z.object({
    description: z.string().min(1),
    category: z.string().min(1),
    vendor: z.string().optional(),
    amount: z.number().positive(),
    date: z.string(),
    paymentMethod: z.string().optional(),
    isRecurring: z.boolean().optional(),
    notes: z.string().optional(),
});

// GET /api/finance/expenses
financeRoutes.get('/expenses', requirePermission('finance:expenses_view'), async (c) => {
    const tenantId = c.get('tenantId');
    const page = parseInt(c.req.query('page') ?? '1');
    const pageSize = parseInt(c.req.query('pageSize') ?? '20');
    const search = c.req.query('search');
    const category = c.req.query('category');

    interface ExpenseWhere {
        tenantId: string;
        category?: string;
        OR?: Array<{
            description?: { contains: string; mode: 'insensitive' };
            vendor?: { contains: string; mode: 'insensitive' };
        }>;
    }

    const where: ExpenseWhere = { tenantId };

    if (category) where.category = category;

    if (search) {
        where.OR = [
            { description: { contains: search, mode: 'insensitive' } },
            { vendor: { contains: search, mode: 'insensitive' } },
        ];
    }

    const [expenses, total, categoryTotals] = await Promise.all([
        prisma.expense.findMany({
            where: where as Parameters<typeof prisma.expense.findMany>[0]['where'],
            orderBy: { date: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.expense.aggregate({
            where: where as Parameters<typeof prisma.expense.aggregate>[0]['where'],
            _sum: { amount: true },
            _count: true,
        }),
        prisma.expense.groupBy({
            by: ['category'],
            where: { tenantId },
            _sum: { amount: true },
        }),
    ]);

    const byCategory: Record<string, number> = {};
    categoryTotals.forEach((cat) => {
        byCategory[cat.category] = cat._sum.amount ?? 0;
    });

    return c.json({
        expenses: expenses.map((e) => ({
            id: e.id,
            description: e.description,
            category: e.category,
            vendor: e.vendor,
            amount: e.amount,
            paymentMethod: e.paymentMethod,
            date: e.date,
            isRecurring: e.isRecurring,
        })),
        stats: {
            totalExpenses: total._sum.amount ?? 0,
            byCategory,
        },
        total: total._count,
        page,
        pageSize,
    });
});

// POST /api/finance/expenses
financeRoutes.post('/expenses', requirePermission('finance:expenses_create'), async (c) => {
    const tenantId = c.get('tenantId');
    const body = await c.req.json();
    const data = createExpenseSchema.parse(body);

    const expense = await prisma.expense.create({
        data: {
            description: data.description,
            category: data.category,
            vendor: data.vendor,
            amount: data.amount,
            date: new Date(data.date),
            paymentMethod: data.paymentMethod,
            isRecurring: data.isRecurring ?? false,
            notes: data.notes,
            tenantId,
        },
    });

    return c.json(expense, 201);
});

// ============ CHART OF ACCOUNTS ENDPOINTS ============

const createAccountSchema = z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    type: z.enum(['Asset', 'Liability', 'Equity', 'Revenue', 'Expense']),
    description: z.string().optional(),
});

// GET /api/finance/accounts
financeRoutes.get('/accounts', requirePermission('finance:dashboard_view'), async (c) => {
    const tenantId = c.get('tenantId');
    const type = c.req.query('type');

    const where: { tenantId: string; type?: string } = { tenantId };
    if (type) where.type = type;

    const accounts = await prisma.chartOfAccount.findMany({
        where,
        orderBy: { code: 'asc' },
    });

    return c.json(
        accounts.map((a) => ({
            id: a.id,
            code: a.code,
            name: a.name,
            type: a.type,
            balance: a.balance,
            isSystem: a.isSystem,
            description: a.description,
        }))
    );
});

// POST /api/finance/accounts
financeRoutes.post('/accounts', requirePermission('finance:dashboard_view'), async (c) => {
    const tenantId = c.get('tenantId');
    const body = await c.req.json();
    const data = createAccountSchema.parse(body);

    // Check for duplicate code
    const existing = await prisma.chartOfAccount.findFirst({
        where: { code: data.code, tenantId },
    });
    if (existing) {
        throw new AppError(409, 'Account code already exists');
    }

    const account = await prisma.chartOfAccount.create({
        data: {
            code: data.code,
            name: data.name,
            type: data.type,
            description: data.description,
            tenantId,
        },
    });

    return c.json(account, 201);
});

// DELETE /api/finance/accounts/:id
financeRoutes.delete('/accounts/:id', requirePermission('finance:dashboard_view'), async (c) => {
    const tenantId = c.get('tenantId');
    const accountId = c.req.param('id');

    const account = await prisma.chartOfAccount.findFirst({
        where: { id: accountId, tenantId },
    });

    if (!account) {
        throw new AppError(404, 'Account not found');
    }

    if (account.isSystem) {
        throw new AppError(400, 'Cannot delete system accounts');
    }

    await prisma.chartOfAccount.delete({ where: { id: accountId } });

    return c.json({ success: true });
});

// ============ INVOICE ENDPOINTS ============

const createInvoiceSchema = z.object({
    customerId: z.string().uuid(),
    amount: z.number().positive(),
    dueDate: z.string(),
    items: z.array(z.object({
        description: z.string(),
        amount: z.number(),
    })),
});

const updateInvoiceStatusSchema = z.object({
    status: z.enum(['pending', 'paid', 'overdue', 'cancelled']),
});

// GET /api/finance/invoices
financeRoutes.get('/invoices', requirePermission('finance:dashboard_view'), async (c) => {
    const tenantId = c.get('tenantId');
    const page = parseInt(c.req.query('page') ?? '1');
    const pageSize = parseInt(c.req.query('pageSize') ?? '20');
    const search = c.req.query('search');
    const status = c.req.query('status');

    interface InvoiceWhere {
        tenantId: string;
        status?: string;
        OR?: Array<{
            invoiceNo?: { contains: string; mode: 'insensitive' };
            customer?: { name?: { contains: string; mode: 'insensitive' } };
        }>;
    }

    const where: InvoiceWhere = { tenantId };

    if (status) where.status = status;

    if (search) {
        where.OR = [
            { invoiceNo: { contains: search, mode: 'insensitive' } },
            { customer: { name: { contains: search, mode: 'insensitive' } } },
        ];
    }

    const [invoices, stats] = await Promise.all([
        prisma.invoice.findMany({
            where: where as Parameters<typeof prisma.invoice.findMany>[0]['where'],
            include: {
                customer: { select: { id: true, name: true, username: true } },
            },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.invoice.groupBy({
            by: ['status'],
            where: { tenantId },
            _sum: { amount: true },
            _count: true,
        }),
    ]);

    const total = await prisma.invoice.count({ where: where as Parameters<typeof prisma.invoice.count>[0]['where'] });

    // Calculate stats
    interface StatResult {
        total: number;
        paid: number;
        pending: number;
        overdue: number;
    }
    const statsSummary: StatResult = { total: 0, paid: 0, pending: 0, overdue: 0 };
    stats.forEach((s) => {
        const amount = s._sum.amount ?? 0;
        statsSummary.total += amount;
        if (s.status === 'paid') statsSummary.paid += amount;
        if (s.status === 'pending') statsSummary.pending += amount;
        if (s.status === 'overdue') statsSummary.overdue += amount;
    });

    return c.json({
        invoices: invoices.map((inv) => ({
            id: inv.invoiceNo,
            customerId: inv.customer?.id,
            customerName: inv.customer?.name ?? 'Unknown',
            amount: inv.amount,
            status: inv.status,
            dueDate: inv.dueDate,
            items: inv.items,
            createdAt: inv.createdAt,
        })),
        stats: statsSummary,
        total,
        page,
        pageSize,
    });
});

// POST /api/finance/invoices
financeRoutes.post('/invoices', requirePermission('finance:dashboard_view'), async (c) => {
    const tenantId = c.get('tenantId');
    const body = await c.req.json();
    const data = createInvoiceSchema.parse(body);

    // Generate invoice number
    const count = await prisma.invoice.count({ where: { tenantId } });
    const invoiceNo = `INV-${new Date().getFullYear()}${String(count + 1).padStart(4, '0')}`;

    const invoice = await prisma.invoice.create({
        data: {
            invoiceNo,
            amount: data.amount,
            dueDate: new Date(data.dueDate),
            items: data.items,
            customerId: data.customerId,
            tenantId,
        },
        include: {
            customer: { select: { name: true } },
        },
    });

    return c.json(
        {
            id: invoice.invoiceNo,
            customerName: invoice.customer?.name,
            amount: invoice.amount,
            status: invoice.status,
            dueDate: invoice.dueDate,
        },
        201
    );
});

// PUT /api/finance/invoices/:id/status
financeRoutes.put('/invoices/:id/status', requirePermission('finance:dashboard_view'), async (c) => {
    const tenantId = c.get('tenantId');
    const invoiceNo = c.req.param('id');
    const body = await c.req.json();
    const { status } = updateInvoiceStatusSchema.parse(body);

    const invoice = await prisma.invoice.findFirst({
        where: { invoiceNo, tenantId },
    });

    if (!invoice) {
        throw new AppError(404, 'Invoice not found');
    }

    const updated = await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
            status,
            paidAt: status === 'paid' ? new Date() : undefined,
        },
    });

    return c.json({
        id: updated.invoiceNo,
        status: updated.status,
        paidAt: updated.paidAt,
    });
});
