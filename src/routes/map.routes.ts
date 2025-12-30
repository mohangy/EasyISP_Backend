import { Hono } from 'hono';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requirePermission } from '../middleware/auth.js';

export const mapRoutes = new Hono();

// Apply auth middleware to all routes
mapRoutes.use('*', authMiddleware);

// GET /api/map/data - Get map data for customers and routers
mapRoutes.get('/data', requirePermission('maps:view'), async (c) => {
    const tenantId = c.get('tenantId');

    // Get customers with location data
    const customers = await prisma.customer.findMany({
        where: {
            tenantId,
            deletedAt: null,
            latitude: { not: null },
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

    // Get active sessions (customers currently connected)
    const activeSessions = await prisma.session.findMany({
        where: {
            tenantId,
            stopTime: null, // Active sessions have no stop time
        },
        select: {
            customerId: true,
            framedIp: true,
            startTime: true,
        },
    });

    // Create a map of online customer IDs with their session data
    const onlineCustomerMap = new Map(
        activeSessions
            .filter(s => s.customerId)
            .map(s => [s.customerId, { ip: s.framedIp, startTime: s.startTime }])
    );

    // Get routers (NAS) - typically have fixed locations
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
            _count: { select: { customers: true } },
        },
    });

    // Calculate coverage areas and customer clusters
    const customerMarkers = customers.map((c) => {
        const sessionData = onlineCustomerMap.get(c.id);
        const isOnline = !!sessionData;
        return {
            id: c.id,
            type: 'customer' as const,
            name: c.name,
            username: c.username,
            latitude: c.latitude,
            longitude: c.longitude,
            status: c.status.toLowerCase(),
            connectionType: c.connectionType.toLowerCase(),
            ipAddress: isOnline ? sessionData?.ip : c.lastIp,
            expiresAt: c.expiresAt,
            package: c.package,
            location: c.location,
            isOnline,
            sessionStartTime: sessionData?.startTime,
        };
    });

    const routerMarkers = routers.map((r) => ({
        id: r.id,
        type: 'router' as const,
        name: r.name,
        ipAddress: r.ipAddress,
        status: r.status.toLowerCase(),
        customerCount: r._count.customers,
        latitude: r.latitude,
        longitude: r.longitude,
        location: r.location,
    }));

    // Calculate stats
    const stats = {
        totalCustomers: customers.length,
        activeCustomers: customers.filter((c) => c.status === 'ACTIVE').length,
        totalRouters: routers.length,
        onlineRouters: routers.filter((r) => r.status === 'ONLINE').length,
    };

    return c.json({
        customers: customerMarkers,
        routers: routerMarkers,
        stats,
        // Default center (can be calculated from customer locations)
        center: customers.length > 0
            ? {
                latitude: customers.reduce((sum, c) => sum + (c.latitude ?? 0), 0) / customers.length,
                longitude: customers.reduce((sum, c) => sum + (c.longitude ?? 0), 0) / customers.length,
            }
            : { latitude: -1.2921, longitude: 36.8219 }, // Default to Nairobi
    });
});
