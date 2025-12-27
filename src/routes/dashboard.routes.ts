import { Hono } from 'hono';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

export const dashboardRoutes = new Hono();

// Apply auth middleware to all routes
dashboardRoutes.use('*', authMiddleware);

// GET /api/dashboard/stats
dashboardRoutes.get('/stats', async (c) => {
    const tenantId = c.get('tenantId');

    // Get customer counts
    const [
        totalCustomers,
        pppoeCustomers,
        hotspotCustomers,
        activeCustomers,
    ] = await Promise.all([
        prisma.customer.count({
            where: { tenantId, deletedAt: null },
        }),
        prisma.customer.count({
            where: { tenantId, connectionType: 'PPPOE', deletedAt: null },
        }),
        prisma.customer.count({
            where: { tenantId, connectionType: 'HOTSPOT', deletedAt: null },
        }),
        prisma.customer.count({
            where: { tenantId, status: 'ACTIVE', deletedAt: null },
        }),
    ]);

    // Get payment stats for this month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [monthlyRevenue, todayRevenue] = await Promise.all([
        prisma.payment.aggregate({
            where: {
                tenantId,
                status: 'COMPLETED',
                createdAt: { gte: startOfMonth },
            },
            _sum: { amount: true },
        }),
        prisma.payment.aggregate({
            where: {
                tenantId,
                status: 'COMPLETED',
                createdAt: { gte: startOfDay },
            },
            _sum: { amount: true },
        }),
    ]);

    // Get voucher stats
    const [activeVouchers, usedVouchers] = await Promise.all([
        prisma.voucher.count({
            where: { tenantId, status: 'AVAILABLE' },
        }),
        prisma.voucher.count({
            where: { tenantId, status: 'USED' },
        }),
    ]);

    // Get active sessions (from RADIUS - placeholder for now)
    const activeSessions = 0; // TODO: Integrate with RADIUS session tracking

    return c.json({
        activeSessions,
        totalCustomers,
        pppoeCustomers,
        hotspotCustomers,
        activeCustomers,
        monthlyRevenue: monthlyRevenue._sum.amount ?? 0,
        todayRevenue: todayRevenue._sum.amount ?? 0,
        activeVouchers,
        usedVouchers,
    });
});

// GET /api/dashboard/revenue
dashboardRoutes.get('/revenue', async (c) => {
    const tenantId = c.get('tenantId');
    const period = c.req.query('period') || 'this_year';

    const now = new Date();
    let startDate: Date;

    switch (period) {
        case 'this_month':
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
        case 'last_year':
            startDate = new Date(now.getFullYear() - 1, 0, 1);
            break;
        case 'this_year':
        default:
            startDate = new Date(now.getFullYear(), 0, 1);
    }

    // Get monthly revenue aggregation
    const payments = await prisma.payment.findMany({
        where: {
            tenantId,
            status: 'COMPLETED',
            createdAt: { gte: startDate },
        },
        select: {
            amount: true,
            createdAt: true,
        },
    });

    // Aggregate by month
    const monthlyData: Record<string, number> = {};
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    payments.forEach((payment) => {
        const month = months[payment.createdAt.getMonth()];
        if (month) {
            monthlyData[month] = (monthlyData[month] ?? 0) + payment.amount;
        }
    });

    const revenueTrend = months.map((month) => ({
        month,
        amount: monthlyData[month] ?? 0,
    }));

    // Calculate totals
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const [today, thisWeek, thisMonth, thisYear] = await Promise.all([
        prisma.payment.aggregate({
            where: { tenantId, status: 'COMPLETED', createdAt: { gte: startOfDay } },
            _sum: { amount: true },
        }),
        prisma.payment.aggregate({
            where: { tenantId, status: 'COMPLETED', createdAt: { gte: startOfWeek } },
            _sum: { amount: true },
        }),
        prisma.payment.aggregate({
            where: { tenantId, status: 'COMPLETED', createdAt: { gte: startOfMonth } },
            _sum: { amount: true },
        }),
        prisma.payment.aggregate({
            where: { tenantId, status: 'COMPLETED', createdAt: { gte: startOfYear } },
            _sum: { amount: true },
        }),
    ]);

    return c.json({
        revenueTrend,
        totalByPeriod: {
            today: today._sum.amount ?? 0,
            thisWeek: thisWeek._sum.amount ?? 0,
            thisMonth: thisMonth._sum.amount ?? 0,
            thisYear: thisYear._sum.amount ?? 0,
        },
    });
});

// GET /api/dashboard/network-usage (placeholder)
dashboardRoutes.get('/network-usage', async (c) => {
    // TODO: Implement actual network usage from SNMP/RADIUS
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    return c.json({
        usageTrend: months.map((month) => ({
            month,
            usage: 0, // Placeholder - will be populated from RADIUS accounting
        })),
        totalByPeriod: {
            today: 0,
            thisWeek: 0,
            thisMonth: 0,
            thisYear: 0,
        },
    });
});
