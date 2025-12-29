// Backend permission constants - must match frontend permissions.ts

export const PERMISSIONS = {
    // Dashboard
    DASHBOARD_VIEW: 'dashboard:view',
    DASHBOARD_ACTIVE_SESSIONS: 'dashboard:active_sessions',
    DASHBOARD_TOTAL_CUSTOMERS: 'dashboard:total_customers',
    DASHBOARD_MONTHLY_REVENUE: 'dashboard:monthly_revenue',
    DASHBOARD_TODAY_REVENUE: 'dashboard:today_revenue',
    DASHBOARD_NETWORK_USAGE: 'dashboard:network_usage',
    DASHBOARD_PAYMENTS: 'dashboard:payments',

    // PPPoE
    PPPOE_VIEW: 'pppoe:view',
    PPPOE_ADD_USER: 'pppoe:add_user',
    PPPOE_SEND_BULK_SMS: 'pppoe:send_bulk_sms',
    PPPOE_DETAILS_VIEW: 'pppoe:details_view',
    PPPOE_EDIT: 'pppoe:edit',
    PPPOE_ADD_CHILD: 'pppoe:add_child',
    PPPOE_SEND_SMS: 'pppoe:send_sms',
    PPPOE_DELETE: 'pppoe:delete',
    PPPOE_SUSPEND: 'pppoe:suspend',
    PPPOE_RESET_MAC: 'pppoe:reset_mac',
    PPPOE_LOCK_MAC: 'pppoe:lock_mac',
    PPPOE_PURGE: 'pppoe:purge',
    PPPOE_OVERRIDE_PLAN: 'pppoe:override_plan',
    PPPOE_SPEED_BOOST: 'pppoe:speed_boost',
    PPPOE_STATIC_IP: 'pppoe:static_ip',
    PPPOE_CHANGE_PLAN: 'pppoe:change_plan',
    PPPOE_CHANGE_EXPIRY: 'pppoe:change_expiry',
    PPPOE_RESOLVE: 'pppoe:resolve',

    // Hotspot
    HOTSPOT_VIEW: 'hotspot:view',
    HOTSPOT_ADD_USER: 'hotspot:add_user',
    HOTSPOT_DELETE_EXPIRED: 'hotspot:delete_expired',
    HOTSPOT_DELETE_UNUSED: 'hotspot:delete_unused',
    HOTSPOT_DETAILS_VIEW: 'hotspot:details_view',
    HOTSPOT_DELETE: 'hotspot:delete',
    HOTSPOT_RESET_MAC: 'hotspot:reset_mac',
    HOTSPOT_PURGE: 'hotspot:purge',
    HOTSPOT_RESET_COUNTERS: 'hotspot:reset_counters',
    HOTSPOT_CHANGE_PACKAGE: 'hotspot:change_package',

    // Payments
    PAYMENTS_VIEW_ELECTRONIC: 'payments:view_electronic',
    PAYMENTS_VIEW_MANUAL: 'payments:view_manual',

    // SMS
    SMS_VIEW: 'sms:view',
    SMS_SETTINGS: 'sms:settings',
    SMS_COMPOSE: 'sms:compose',
    SMS_CLEAR: 'sms:clear',
    SMS_DELETE: 'sms:delete',
    SMS_RESEND: 'sms:resend',

    // Maps
    MAPS_VIEW: 'maps:view',

    // Packages
    PACKAGES_VIEW: 'packages:view',
    PACKAGES_ADD_HOTSPOT: 'packages:add_hotspot',
    PACKAGES_ADD_PPPOE: 'packages:add_pppoe',
    PACKAGES_DETAILS_VIEW: 'packages:details_view',
    PACKAGES_EDIT: 'packages:edit',
    PACKAGES_DELETE: 'packages:delete',

    // Routers
    ROUTERS_VIEW: 'routers:view',
    ROUTERS_ADD: 'routers:add',
    ROUTERS_TUTORIAL: 'routers:tutorial',
    ROUTERS_DETAILS_VIEW: 'routers:details_view',
    ROUTERS_EDIT: 'routers:edit',
    ROUTERS_DELETE: 'routers:delete',
    ROUTERS_TEST: 'routers:test',
    ROUTERS_CONFIG: 'routers:config',
    ROUTERS_DISCONNECT: 'routers:disconnect',

    // Finance
    FINANCE_DASHBOARD_VIEW: 'finance:dashboard_view',
    FINANCE_VIEW_CHARTS: 'finance:view_charts',
    FINANCE_INCOME_VIEW: 'finance:income_view',
    FINANCE_INCOME_CREATE: 'finance:income_create',
    FINANCE_EXPENSES_VIEW: 'finance:expenses_view',
    FINANCE_EXPENSES_CREATE: 'finance:expenses_create',
    FINANCE_REPORTS_VIEW: 'finance:reports_view',
    FINANCE_REPORTS_GENERATE: 'finance:reports_generate',

    // Operators
    OPERATORS_VIEW: 'operators:view',
    OPERATORS_ADD: 'operators:add',
    OPERATORS_DETAILS_VIEW: 'operators:details_view',
    OPERATORS_EDIT: 'operators:edit',
    OPERATORS_DELETE: 'operators:delete',
    OPERATORS_MANAGE_PERMISSIONS: 'operators:manage_permissions',

    // Settings
    SETTINGS_GENERAL: 'settings:general',
    SETTINGS_LICENCE: 'settings:licence',
    SETTINGS_INVOICES: 'settings:invoices',
    SETTINGS_PAYMENT_GATEWAY: 'settings:payment_gateway',
    SETTINGS_SMS: 'settings:sms',
    SETTINGS_PASSWORD: 'settings:password',
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

// Role-based default permissions
export const ROLE_PERMISSIONS: Record<string, string[]> = {
    SUPER_ADMIN: [...ALL_PERMISSIONS],

    ADMIN: ALL_PERMISSIONS.filter(p =>
        !['settings:licence', 'settings:payment_gateway'].includes(p)
    ),

    CUSTOMER_CARE: [
        PERMISSIONS.DASHBOARD_VIEW,
        PERMISSIONS.DASHBOARD_ACTIVE_SESSIONS,
        PERMISSIONS.DASHBOARD_TOTAL_CUSTOMERS,
        PERMISSIONS.DASHBOARD_PAYMENTS,
        PERMISSIONS.PPPOE_VIEW,
        PERMISSIONS.PPPOE_DETAILS_VIEW,
        PERMISSIONS.PPPOE_EDIT,
        PERMISSIONS.PPPOE_SEND_SMS,
        PERMISSIONS.PPPOE_SEND_BULK_SMS,
        PERMISSIONS.PPPOE_SUSPEND,
        PERMISSIONS.PPPOE_CHANGE_EXPIRY,
        PERMISSIONS.PPPOE_RESOLVE,
        PERMISSIONS.HOTSPOT_VIEW,
        PERMISSIONS.HOTSPOT_DETAILS_VIEW,
        PERMISSIONS.HOTSPOT_CHANGE_PACKAGE,
        PERMISSIONS.PAYMENTS_VIEW_ELECTRONIC,
        PERMISSIONS.PAYMENTS_VIEW_MANUAL,
        PERMISSIONS.SMS_VIEW,
        PERMISSIONS.SMS_COMPOSE,
        PERMISSIONS.PACKAGES_VIEW,
        PERMISSIONS.PACKAGES_DETAILS_VIEW,
        PERMISSIONS.SETTINGS_PASSWORD,
    ],

    FIELD_TECH: [
        PERMISSIONS.DASHBOARD_VIEW,
        PERMISSIONS.DASHBOARD_ACTIVE_SESSIONS,
        PERMISSIONS.PPPOE_VIEW,
        PERMISSIONS.PPPOE_DETAILS_VIEW,
        PERMISSIONS.PPPOE_RESET_MAC,
        PERMISSIONS.PPPOE_PURGE,
        PERMISSIONS.PPPOE_RESOLVE,
        PERMISSIONS.HOTSPOT_VIEW,
        PERMISSIONS.HOTSPOT_DETAILS_VIEW,
        PERMISSIONS.HOTSPOT_RESET_MAC,
        PERMISSIONS.HOTSPOT_PURGE,
        PERMISSIONS.HOTSPOT_RESET_COUNTERS,
        PERMISSIONS.MAPS_VIEW,
        PERMISSIONS.ROUTERS_VIEW,
        PERMISSIONS.ROUTERS_ADD,
        PERMISSIONS.ROUTERS_DETAILS_VIEW,
        PERMISSIONS.ROUTERS_EDIT,
        PERMISSIONS.ROUTERS_TEST,
        PERMISSIONS.ROUTERS_CONFIG,
        PERMISSIONS.PACKAGES_VIEW,
        PERMISSIONS.PACKAGES_DETAILS_VIEW,
        PERMISSIONS.SETTINGS_PASSWORD,
    ],
};

/**
 * Check if a user has a specific permission
 */
export function hasPermission(
    role: string,
    addedPermissions: string[],
    removedPermissions: string[],
    permission: string
): boolean {
    // Super Admin always has all permissions
    if (role === 'SUPER_ADMIN') return true;

    // Check if explicitly removed
    if (removedPermissions.includes(permission)) return false;

    // Check if explicitly added
    if (addedPermissions.includes(permission)) return true;

    // Check role defaults
    const roleDefaults = ROLE_PERMISSIONS[role] || [];
    return roleDefaults.includes(permission);
}
