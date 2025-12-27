import type { AuthUser } from '../middleware/auth.js';
export type AuditAction = 'LOGIN' | 'LOGOUT' | 'TENANT_CREATE' | 'TENANT_UPDATE' | 'OPERATOR_CREATE' | 'OPERATOR_UPDATE' | 'OPERATOR_DELETE' | 'PASSWORD_RESET' | 'PASSWORD_CHANGE' | 'CUSTOMER_CREATE' | 'CUSTOMER_UPDATE' | 'CUSTOMER_DELETE' | 'MAC_RESET' | 'CUSTOMER_DISCONNECT' | 'CUSTOMER_SUSPEND' | 'CUSTOMER_ACTIVATE' | 'PACKAGE_CHANGE' | 'EXPIRY_UPDATE' | 'MANUAL_RECHARGE' | 'PAYMENT_PROCESS' | 'PAYMENT_REFUND' | 'ROUTER_CREATE' | 'ROUTER_UPDATE' | 'ROUTER_DELETE' | 'ROUTER_REBOOT' | 'VOUCHER_GENERATE' | 'VOUCHER_DELETE' | 'SMS_SEND' | 'SETTINGS_UPDATE' | 'VPN_PEER_CREATE' | 'VPN_PEER_DELETE' | 'VPN_PEER_ENABLE' | 'VPN_PEER_DISABLE';
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
export declare function createAuditLog(params: AuditLogParams): Promise<void>;
/**
 * Get audit logs for a specific operator
 */
export declare function getOperatorAuditLogs(operatorId: string, tenantId: string, options?: {
    page?: number;
    pageSize?: number;
}): Promise<{
    logs: {
        id: string;
        action: string;
        targetType: string;
        targetName: string | null;
        details: string | null;
        timestamp: Date;
    }[];
    total: number;
    page: number;
    pageSize: number;
}>;
/**
 * Get all audit logs for a tenant
 */
export declare function getTenantAuditLogs(tenantId: string, options?: {
    page?: number;
    pageSize?: number;
    action?: string;
}): Promise<{
    logs: {
        id: string;
        action: string;
        targetType: string;
        targetId: string | null;
        targetName: string | null;
        details: string | null;
        timestamp: Date;
        operator: {
            name: string;
            email: string;
        };
    }[];
    total: number;
    page: number;
    pageSize: number;
}>;
//# sourceMappingURL=audit.d.ts.map