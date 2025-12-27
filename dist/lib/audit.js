import { prisma } from './prisma.js';
/**
 * Create an audit log entry
 */
export async function createAuditLog(params) {
    try {
        await prisma.auditLog.create({
            data: {
                action: params.action,
                targetType: params.targetType,
                targetId: params.targetId,
                targetName: params.targetName,
                details: params.details,
                ipAddress: params.ipAddress,
                userId: params.user.id,
                tenantId: params.user.tenantId,
            },
        });
    }
    catch (error) {
        // Log to console but don't fail the main operation
        console.error('Failed to create audit log:', error);
    }
}
/**
 * Get audit logs for a specific operator
 */
export async function getOperatorAuditLogs(operatorId, tenantId, options = {}) {
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 10;
    const skip = (page - 1) * pageSize;
    const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
            where: { userId: operatorId, tenantId },
            orderBy: { createdAt: 'desc' },
            skip,
            take: pageSize,
            select: {
                id: true,
                action: true,
                targetType: true,
                targetName: true,
                details: true,
                createdAt: true,
            },
        }),
        prisma.auditLog.count({ where: { userId: operatorId, tenantId } }),
    ]);
    return {
        logs: logs.map((log) => ({
            id: log.id,
            action: log.action,
            targetType: log.targetType,
            targetName: log.targetName,
            details: log.details,
            timestamp: log.createdAt,
        })),
        total,
        page,
        pageSize,
    };
}
/**
 * Get all audit logs for a tenant
 */
export async function getTenantAuditLogs(tenantId, options = {}) {
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const where = { tenantId };
    if (options.action) {
        where.action = options.action;
    }
    const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take: pageSize,
            include: {
                user: {
                    select: { name: true, email: true },
                },
            },
        }),
        prisma.auditLog.count({ where }),
    ]);
    return {
        logs: logs.map((log) => ({
            id: log.id,
            action: log.action,
            targetType: log.targetType,
            targetId: log.targetId,
            targetName: log.targetName,
            details: log.details,
            timestamp: log.createdAt,
            operator: {
                name: log.user.name,
                email: log.user.email,
            },
        })),
        total,
        page,
        pageSize,
    };
}
//# sourceMappingURL=audit.js.map