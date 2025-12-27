import { Hono } from 'hono';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../lib/logger.js';
export const snmpRoutes = new Hono();
// Apply auth middleware to all routes
snmpRoutes.use('*', authMiddleware);
// GET /api/snmp/status - Get SNMP polling status
snmpRoutes.get('/status', async (c) => {
    const tenantId = c.get('tenantId');
    // Get NAS devices with SNMP enabled
    const nasDevices = await prisma.nAS.findMany({
        where: { tenantId },
        select: {
            id: true,
            name: true,
            ipAddress: true,
            status: true,
            lastSeen: true,
        },
    });
    return c.json({
        enabled: true,
        pollInterval: parseInt(process.env['SNMP_POLL_INTERVAL'] ?? '60'),
        version: process.env['SNMP_VERSION'] ?? 'v2c',
        devices: nasDevices.map((d) => ({
            id: d.id,
            name: d.name,
            ip: d.ipAddress,
            status: d.status,
            lastPolled: d.lastSeen,
        })),
        stats: {
            total: nasDevices.length,
            online: nasDevices.filter((d) => d.status === 'ONLINE').length,
            offline: nasDevices.filter((d) => d.status === 'OFFLINE').length,
        },
    });
});
// GET /api/snmp/poll/:nasId - Poll specific device
snmpRoutes.get('/poll/:nasId', async (c) => {
    const tenantId = c.get('tenantId');
    const nasId = c.req.param('nasId');
    const nas = await prisma.nAS.findFirst({
        where: { id: nasId, tenantId },
    });
    if (!nas) {
        throw new AppError(404, 'Device not found');
    }
    // TODO: Implement actual SNMP polling
    // This would use net-snmp library to poll the device
    // For now, return mock/stored data
    const mockData = {
        system: {
            sysDescr: nas.boardName ?? 'MikroTik RouterOS',
            sysUpTime: nas.uptime ?? 'Unknown',
            sysName: nas.name,
        },
        interfaces: [
            { ifIndex: 1, ifDescr: 'ether1', ifOperStatus: 'up', ifInOctets: 1234567890, ifOutOctets: 9876543210 },
            { ifIndex: 2, ifDescr: 'ether2', ifOperStatus: 'up', ifInOctets: 2345678901, ifOutOctets: 8765432109 },
        ],
        cpu: nas.cpuLoad ?? 0,
        memory: {
            used: nas.memoryUsage ?? 0,
            total: nas.memoryTotal ?? 0,
            percent: nas.memoryTotal ? Math.round((nas.memoryUsage ?? 0) / nas.memoryTotal * 100) : 0,
        },
    };
    // Update last seen
    await prisma.nAS.update({
        where: { id: nasId },
        data: { lastSeen: new Date() },
    });
    return c.json({
        nasId: nas.id,
        nasName: nas.name,
        polledAt: new Date(),
        data: mockData,
    });
});
// GET /api/snmp/metrics - Get aggregated metrics
snmpRoutes.get('/metrics', async (c) => {
    const tenantId = c.get('tenantId');
    const period = c.req.query('period') ?? '1h'; // 1h, 24h, 7d, 30d
    // Get all NAS devices
    const nasDevices = await prisma.nAS.findMany({
        where: { tenantId },
        select: {
            id: true,
            name: true,
            cpuLoad: true,
            memoryUsage: true,
            memoryTotal: true,
        },
    });
    // Calculate aggregated metrics
    const totalCpu = nasDevices.reduce((sum, d) => sum + (d.cpuLoad ?? 0), 0);
    const avgCpu = nasDevices.length > 0 ? Math.round(totalCpu / nasDevices.length) : 0;
    const totalMemUsed = nasDevices.reduce((sum, d) => sum + (d.memoryUsage ?? 0), 0);
    const totalMemTotal = nasDevices.reduce((sum, d) => sum + (d.memoryTotal ?? 0), 0);
    const avgMemPercent = totalMemTotal > 0 ? Math.round((totalMemUsed / totalMemTotal) * 100) : 0;
    return c.json({
        period,
        deviceCount: nasDevices.length,
        aggregated: {
            avgCpuLoad: avgCpu,
            avgMemoryPercent: avgMemPercent,
            totalMemoryUsed: totalMemUsed,
            totalMemoryTotal: totalMemTotal,
        },
        devices: nasDevices.map((d) => ({
            id: d.id,
            name: d.name,
            cpu: d.cpuLoad ?? 0,
            memoryPercent: d.memoryTotal ? Math.round((d.memoryUsage ?? 0) / d.memoryTotal * 100) : 0,
        })),
    });
});
// POST /api/snmp/settings - Update SNMP settings for a device
snmpRoutes.post('/settings', async (c) => {
    const tenantId = c.get('tenantId');
    const body = await c.req.json();
    const { nasId, community, version, port } = body;
    const nas = await prisma.nAS.findFirst({
        where: { id: nasId, tenantId },
    });
    if (!nas) {
        throw new AppError(404, 'Device not found');
    }
    // TODO: Store SNMP settings (would need to add fields to NAS model)
    // For now, just acknowledge
    logger.info({ nasId, version }, 'SNMP settings updated');
    return c.json({
        success: true,
        nasId,
        settings: {
            community: community ?? 'public',
            version: version ?? 'v2c',
            port: port ?? 161,
        },
    });
});
// GET /api/snmp/alerts - Get SNMP-based alerts
snmpRoutes.get('/alerts', async (c) => {
    const tenantId = c.get('tenantId');
    // Get devices with potential issues
    const nasDevices = await prisma.nAS.findMany({
        where: { tenantId },
        select: {
            id: true,
            name: true,
            status: true,
            cpuLoad: true,
            memoryUsage: true,
            memoryTotal: true,
            lastSeen: true,
        },
    });
    const alerts = [];
    for (const nas of nasDevices) {
        // Offline device
        if (nas.status === 'OFFLINE') {
            alerts.push({
                severity: 'critical',
                device: nas.name,
                message: 'Device is offline',
                timestamp: nas.lastSeen ?? new Date(),
            });
        }
        // High CPU
        if (nas.cpuLoad && nas.cpuLoad > 90) {
            alerts.push({
                severity: 'warning',
                device: nas.name,
                message: `High CPU usage: ${nas.cpuLoad}%`,
                timestamp: new Date(),
            });
        }
        // High memory
        const memPercent = nas.memoryTotal
            ? Math.round((nas.memoryUsage ?? 0) / nas.memoryTotal * 100)
            : 0;
        if (memPercent > 90) {
            alerts.push({
                severity: 'warning',
                device: nas.name,
                message: `High memory usage: ${memPercent}%`,
                timestamp: new Date(),
            });
        }
        // Not seen recently (> 5 minutes)
        if (nas.lastSeen && (Date.now() - nas.lastSeen.getTime()) > 5 * 60 * 1000) {
            alerts.push({
                severity: 'info',
                device: nas.name,
                message: 'Device not responding to polls',
                timestamp: nas.lastSeen,
            });
        }
    }
    return c.json({
        alerts: alerts.sort((a, b) => {
            const severityOrder = { critical: 0, warning: 1, info: 2 };
            return severityOrder[a.severity] - severityOrder[b.severity];
        }),
        summary: {
            critical: alerts.filter((a) => a.severity === 'critical').length,
            warning: alerts.filter((a) => a.severity === 'warning').length,
            info: alerts.filter((a) => a.severity === 'info').length,
        },
    });
});
//# sourceMappingURL=snmp.routes.js.map