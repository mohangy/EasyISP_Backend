import type { Context, Next } from 'hono';
export interface AuthUser {
    id: string;
    email: string;
    name: string;
    role: string;
    tenantId: string;
    addedPermissions: string[];
    removedPermissions: string[];
}
declare module 'hono' {
    interface ContextVariableMap {
        user: AuthUser;
        tenantId: string;
    }
}
export declare const authMiddleware: (c: Context, next: Next) => Promise<void>;
export declare const requirePermission: (permission: string) => (c: Context, next: Next) => Promise<void>;
export declare const requireRole: (...roles: string[]) => (c: Context, next: Next) => Promise<void>;
//# sourceMappingURL=auth.d.ts.map