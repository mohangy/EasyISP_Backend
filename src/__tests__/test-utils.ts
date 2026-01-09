/**
 * Test utilities and mocks for Zero Touch module testing
 */

import { vi } from 'vitest';

// Mock NAS object for testing
export const mockNas = {
    id: 'test-router-id',
    name: 'Test Router',
    ipAddress: '192.168.1.1',
    vpnIp: '10.10.0.5',
    secret: 'testsecret12345678901234567890ab',
    coaPort: 3799,
    apiUsername: 'easyisp-api',
    apiPassword: 'testapipassword123',
    apiPort: 8728,
    status: 'ONLINE',
    tenantId: 'test-tenant-id',
    lastSeen: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
};

// Mock tenant
export const mockTenant = {
    id: 'test-tenant-id',
    name: 'Test ISP',
    businessName: 'Test ISP Business',
    email: 'test@example.com',
    status: 'ACTIVE',
};

// Mock system resources response
export const mockSystemResources = {
    uptime: '3d12h30m',
    version: '7.14.1',
    buildTime: '2025-12-01 12:00:00',
    factorySoftware: '7.12',
    freeMemory: 268435456,
    totalMemory: 536870912,
    cpu: 'ARM',
    cpuCount: 4,
    cpuFrequency: 1200,
    cpuLoad: 15,
    freeHddSpace: 67108864,
    totalHddSpace: 134217728,
    architectureName: 'arm64',
    boardName: 'RB5009UG+S+',
    platform: 'MikroTik',
};

// Mock interfaces
export const mockInterfaces = [
    {
        id: '*1',
        name: 'ether1',
        type: 'ether',
        macAddress: '00:11:22:33:44:55',
        running: true,
        disabled: false,
        comment: 'WAN',
        isWan: true,
    },
    {
        id: '*2',
        name: 'ether2',
        type: 'ether',
        macAddress: '00:11:22:33:44:56',
        running: true,
        disabled: false,
        comment: 'LAN',
        isWan: false,
    },
    {
        id: '*3',
        name: 'wlan1',
        type: 'wlan',
        macAddress: '00:11:22:33:44:57',
        running: true,
        disabled: false,
        comment: 'WiFi 2.4GHz',
        isWan: false,
    },
];

// Mock wireless interfaces
export const mockWirelessInterfaces = [
    {
        id: '*A1',
        name: 'wlan1',
        macAddress: '00:11:22:33:44:57',
        ssid: 'TestNetwork',
        band: '2ghz-b/g/n',
        channel: '6',
        frequency: 2437,
        mode: 'ap-bridge',
        securityProfile: 'default',
        running: true,
        disabled: false,
    },
    {
        id: '*A2',
        name: 'wlan2',
        macAddress: '00:11:22:33:44:58',
        ssid: 'TestNetwork-5G',
        band: '5ghz-a/n/ac',
        channel: 'auto',
        frequency: 5180,
        mode: 'ap-bridge',
        securityProfile: 'default',
        running: true,
        disabled: false,
    },
];

// Mock firmware info
export const mockFirmwareInfo = {
    currentVersion: '7.14.1',
    latestVersion: '7.15',
    updateAvailable: true,
    channel: 'stable',
    packages: [
        { name: 'routeros', version: '7.14.1', buildTime: '2025-12-01', scheduled: null },
        { name: 'system', version: '7.14.1', buildTime: '2025-12-01', scheduled: null },
    ],
};

// Create mock Prisma client
export function createMockPrisma() {
    return {
        nAS: {
            findFirst: vi.fn(),
            findUnique: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
        },
        tenant: {
            findUnique: vi.fn(),
        },
        session: {
            findFirst: vi.fn(),
            findMany: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
        },
    };
}

// Create mock MikroTik service
export function createMockMikrotikService() {
    return {
        getConnection: vi.fn(),
        getSystemResources: vi.fn().mockResolvedValue(mockSystemResources),
        getInterfaces: vi.fn().mockResolvedValue(mockInterfaces),
        getWirelessInterfaces: vi.fn().mockResolvedValue(mockWirelessInterfaces),
        getSecurityProfiles: vi.fn().mockResolvedValue([{ name: 'default', mode: 'none', authentication: '' }]),
        configureWireless: vi.fn().mockResolvedValue(true),
        configureHotspot: vi.fn().mockResolvedValue(true),
        configurePPPoE: vi.fn().mockResolvedValue(true),
        configureFirewall: vi.fn().mockResolvedValue(true),
        backupConfig: vi.fn().mockResolvedValue('easyisp-backup-123'),
        restoreBackup: vi.fn().mockResolvedValue(true),
        testConfiguration: vi.fn().mockResolvedValue({ hotspot: true, pppoe: true, radius: true }),
        getFirmwareInfo: vi.fn().mockResolvedValue(mockFirmwareInfo),
        checkFirmwareUpdates: vi.fn().mockResolvedValue({ available: true, currentVersion: '7.14.1', latestVersion: '7.15' }),
        updateFirmware: vi.fn().mockResolvedValue({ success: true, message: 'Update installed' }),
        closeAll: vi.fn(),
    };
}

// Helper to create test Hono app context
export function createMockContext(overrides: Record<string, any> = {}) {
    return {
        req: {
            param: vi.fn((key: string) => overrides.params?.[key]),
            query: vi.fn((key: string) => overrides.query?.[key]),
            json: vi.fn().mockResolvedValue(overrides.body || {}),
            header: vi.fn((key: string) => overrides.headers?.[key]),
            path: overrides.path || '/api/wizard/test',
        },
        get: vi.fn((key: string) => {
            if (key === 'tenantId') return 'test-tenant-id';
            if (key === 'userId') return 'test-user-id';
            return overrides.context?.[key];
        }),
        json: vi.fn((data: any, status?: number) => ({ data, status: status || 200 })),
        text: vi.fn((data: string, status?: number) => ({ data, status: status || 200 })),
        ...overrides,
    };
}
