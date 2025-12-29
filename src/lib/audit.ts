import { prisma } from './prisma.js';
import type { AuthUser } from '../middleware/auth.js';

export type AuditAction =
    | 'LOGIN'
    | 'LOGOUT'
    | 'TENANT_CREATE'
    | 'TENANT_UPDATE'
    | 'OPERATOR_CREATE'
    | 'OPERATOR_UPDATE'
    | 'OPERATOR_DELETE'
    | 'PASSWORD_RESET'
    | 'PASSWORD_CHANGE'
    | 'CUSTOMER_CREATE'
    | 'CUSTOMER_UPDATE'
    | 'CUSTOMER_DELETE'
    | 'MAC_RESET'
    | 'MAC_LOCK'
    | 'CUSTOMER_DISCONNECT'
    | 'CUSTOMER_SUSPEND'
    | 'CUSTOMER_ACTIVATE'
    | 'PACKAGE_CHANGE'
    | 'EXPIRY_UPDATE'
    | 'OVERRIDE_PLAN'
    | 'SPEED_BOOST'
    | 'ASSIGN_STATIC_IP'
    | 'SEND_MESSAGE'
    | 'MANUAL_RECHARGE'
    | 'PAYMENT_PROCESS'
    | 'PAYMENT_REFUND'
    | 'ROUTER_CREATE'
    | 'ROUTER_UPDATE'
    | 'ROUTER_DELETE'
    | 'ROUTER_REBOOT'
    | 'VOUCHER_GENERATE'
    | 'VOUCHER_DELETE'
    | 'SMS_SEND'
    | 'SETTINGS_UPDATE'
    | 'VPN_PEER_CREATE'
    | 'VPN_PEER_DELETE'
    | 'VPN_PEER_ENABLE'
    | 'VPN_PEER_DISABLE';

export interface AuditLogParams {
    action: AuditAction;
    targetType: string;
    targetId?: string;
    targetName?: string;
    details?: string;
    ipAddress?: string;
    user: AuthUser;
}

/**
 * Create an audit log entry
 */
export async function createAuditLog(params: AuditLogParams): Promise<void> {
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
    } catch (error) {
        // Log to console but don't fail the main operation
        console.error('Failed to create audit log:', error);
    }
}

/**
 * Get audit logs for a specific operator
 */
export async function getOperatorAuditLogs(
    operatorId: string,
    tenantId: string,
    options: { page?: number; pageSize?: number } = {}
) {
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
export async function getTenantAuditLogs(
    tenantId: string,
    options: { page?: number; pageSize?: number; action?: string } = {}
) {
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: { tenantId: string; action?: string } = { tenantId };
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
