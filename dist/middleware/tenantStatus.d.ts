import type { Context, Next } from 'hono';
/**
 * Middleware to check if tenant's trial/subscription is valid
 * Blocks access if trial expired and not activated
 */
export declare const checkTenantStatus: (c: Context, next: Next) => Promise<void>;
/**
 * Helper function to check if tenant can authenticate customers (for RADIUS)
 * Returns { allowed: boolean, reason?: string }
 */
export declare function checkTenantCanAuthenticate(tenantId: string): Promise<{
    allowed: boolean;
    reason?: string;
}>;
//# sourceMappingURL=tenantStatus.d.ts.map