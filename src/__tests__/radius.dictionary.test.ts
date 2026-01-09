/**
 * RADIUS Dictionary Tests
 * Tests for attribute types, codes, and vendor-specific attributes
 */

import { describe, it, expect } from 'vitest';

// RADIUS Codes
const RadiusCode = {
    ACCESS_REQUEST: 1,
    ACCESS_ACCEPT: 2,
    ACCESS_REJECT: 3,
    ACCOUNTING_REQUEST: 4,
    ACCOUNTING_RESPONSE: 5,
    ACCESS_CHALLENGE: 11,
    STATUS_SERVER: 12,
    STATUS_CLIENT: 13,
    DISCONNECT_REQUEST: 40,
    DISCONNECT_ACK: 41,
    DISCONNECT_NAK: 42,
    COA_REQUEST: 43,
    COA_ACK: 44,
    COA_NAK: 45,
};

// Standard RADIUS Attributes
const RadiusAttributeType = {
    USER_NAME: 1,
    USER_PASSWORD: 2,
    CHAP_PASSWORD: 3,
    NAS_IP_ADDRESS: 4,
    NAS_PORT: 5,
    SERVICE_TYPE: 6,
    FRAMED_PROTOCOL: 7,
    FRAMED_IP_ADDRESS: 8,
    FRAMED_IP_NETMASK: 9,
    FRAMED_ROUTING: 10,
    FILTER_ID: 11,
    FRAMED_MTU: 12,
    FRAMED_COMPRESSION: 13,
    LOGIN_IP_HOST: 14,
    LOGIN_SERVICE: 15,
    LOGIN_TCP_PORT: 16,
    REPLY_MESSAGE: 18,
    CALLBACK_NUMBER: 19,
    CALLBACK_ID: 20,
    FRAMED_ROUTE: 22,
    FRAMED_IPX_NETWORK: 23,
    STATE: 24,
    CLASS: 25,
    VENDOR_SPECIFIC: 26,
    SESSION_TIMEOUT: 27,
    IDLE_TIMEOUT: 28,
    TERMINATION_ACTION: 29,
    CALLED_STATION_ID: 30,
    CALLING_STATION_ID: 31,
    NAS_IDENTIFIER: 32,
    PROXY_STATE: 33,
    LOGIN_LAT_SERVICE: 34,
    LOGIN_LAT_NODE: 35,
    LOGIN_LAT_GROUP: 36,
    FRAMED_APPLETALK_LINK: 37,
    FRAMED_APPLETALK_NETWORK: 38,
    FRAMED_APPLETALK_ZONE: 39,
    ACCT_STATUS_TYPE: 40,
    ACCT_DELAY_TIME: 41,
    ACCT_INPUT_OCTETS: 42,
    ACCT_OUTPUT_OCTETS: 43,
    ACCT_SESSION_ID: 44,
    ACCT_AUTHENTIC: 45,
    ACCT_SESSION_TIME: 46,
    ACCT_INPUT_PACKETS: 47,
    ACCT_OUTPUT_PACKETS: 48,
    ACCT_TERMINATE_CAUSE: 49,
    ACCT_MULTI_SESSION_ID: 50,
    ACCT_LINK_COUNT: 51,
    ACCT_INPUT_GIGAWORDS: 52,
    ACCT_OUTPUT_GIGAWORDS: 53,
    CHAP_CHALLENGE: 60,
    NAS_PORT_TYPE: 61,
    PORT_LIMIT: 62,
    LOGIN_LAT_PORT: 63,
    TUNNEL_TYPE: 64,
    TUNNEL_MEDIUM_TYPE: 65,
    TUNNEL_CLIENT_ENDPOINT: 66,
    TUNNEL_SERVER_ENDPOINT: 67,
    ACCT_TUNNEL_CONNECTION: 68,
    TUNNEL_PASSWORD: 69,
    ARAP_PASSWORD: 70,
    ARAP_FEATURES: 71,
    ARAP_ZONE_ACCESS: 72,
    ARAP_SECURITY: 73,
    ARAP_SECURITY_DATA: 74,
    PASSWORD_RETRY: 75,
    PROMPT: 76,
    CONNECT_INFO: 77,
    CONFIGURATION_TOKEN: 78,
    EAP_MESSAGE: 79,
    MESSAGE_AUTHENTICATOR: 80,
    TUNNEL_PRIVATE_GROUP_ID: 81,
    TUNNEL_ASSIGNMENT_ID: 82,
    TUNNEL_PREFERENCE: 83,
    ARAP_CHALLENGE_RESPONSE: 84,
    ACCT_INTERIM_INTERVAL: 85,
    ACCT_TUNNEL_PACKETS_LOST: 86,
    NAS_PORT_ID: 87,
    FRAMED_POOL: 88,
    CHARGEABLE_USER_IDENTITY: 89,
    TUNNEL_CLIENT_AUTH_ID: 90,
    TUNNEL_SERVER_AUTH_ID: 91,
};

// Accounting Status Types
const AcctStatusType = {
    START: 1,
    STOP: 2,
    INTERIM_UPDATE: 3,
    ACCOUNTING_ON: 7,
    ACCOUNTING_OFF: 8,
    TUNNEL_START: 9,
    TUNNEL_STOP: 10,
    TUNNEL_REJECT: 11,
    TUNNEL_LINK_START: 12,
    TUNNEL_LINK_STOP: 13,
    TUNNEL_LINK_REJECT: 14,
    FAILED: 15,
};

// Terminate Cause
const AcctTerminateCause = {
    USER_REQUEST: 1,
    LOST_CARRIER: 2,
    LOST_SERVICE: 3,
    IDLE_TIMEOUT: 4,
    SESSION_TIMEOUT: 5,
    ADMIN_RESET: 6,
    ADMIN_REBOOT: 7,
    PORT_ERROR: 8,
    NAS_ERROR: 9,
    NAS_REQUEST: 10,
    NAS_REBOOT: 11,
    PORT_UNNEEDED: 12,
    PORT_PREEMPTED: 13,
    PORT_SUSPENDED: 14,
    SERVICE_UNAVAILABLE: 15,
    CALLBACK: 16,
    USER_ERROR: 17,
    HOST_REQUEST: 18,
};

// Service Types
const ServiceType = {
    LOGIN: 1,
    FRAMED: 2,
    CALLBACK_LOGIN: 3,
    CALLBACK_FRAMED: 4,
    OUTBOUND: 5,
    ADMINISTRATIVE: 6,
    NAS_PROMPT: 7,
    AUTHENTICATE_ONLY: 8,
    CALLBACK_NAS_PROMPT: 9,
    CALL_CHECK: 10,
    CALLBACK_ADMINISTRATIVE: 11,
};

// MikroTik Vendor ID
const MIKROTIK_VENDOR_ID = 14988;

// MikroTik VSAs
const MikroTikAttribute = {
    RECV_LIMIT: 1,
    XMIT_LIMIT: 2,
    GROUP: 3,
    WIRELESS_FORWARD: 4,
    WIRELESS_SKIP_DOT1X: 5,
    WIRELESS_ENC_ALGO: 6,
    WIRELESS_ENC_KEY: 7,
    RATE_LIMIT: 8,
    REALM: 9,
    HOST_IP: 10,
    MARK_ID: 11,
    ADVERTISE_URL: 12,
    ADVERTISE_INTERVAL: 13,
    RECV_LIMIT_GIGAWORDS: 14,
    XMIT_LIMIT_GIGAWORDS: 15,
    WIRELESS_PSK: 16,
    TOTAL_LIMIT: 17,
    TOTAL_LIMIT_GIGAWORDS: 18,
    ADDRESS_LIST: 19,
    WIRELESS_MPK: 20,
    WIRELESS_COMMENT: 21,
    DELEGATED_IPV6_POOL: 22,
    DHCP_OPTION_SET: 23,
    DHCP_OPTION_PARAM_STR1: 24,
    DHCP_OPTION_PARAM_STR2: 25,
    WIRELESS_VLANID: 26,
    WIRELESS_VLANID_TYPE: 27,
    WIRELESS_MINSIGNAL: 28,
    WIRELESS_MAXSIGNAL: 29,
};

// =============================================
// RADIUS Code Tests
// =============================================
describe('RADIUS Codes', () => {
    it('should have correct Access-Request code', () => {
        expect(RadiusCode.ACCESS_REQUEST).toBe(1);
    });

    it('should have correct Access-Accept code', () => {
        expect(RadiusCode.ACCESS_ACCEPT).toBe(2);
    });

    it('should have correct Access-Reject code', () => {
        expect(RadiusCode.ACCESS_REJECT).toBe(3);
    });

    it('should have correct Accounting-Request code', () => {
        expect(RadiusCode.ACCOUNTING_REQUEST).toBe(4);
    });

    it('should have correct Accounting-Response code', () => {
        expect(RadiusCode.ACCOUNTING_RESPONSE).toBe(5);
    });

    it('should have correct CoA codes', () => {
        expect(RadiusCode.DISCONNECT_REQUEST).toBe(40);
        expect(RadiusCode.DISCONNECT_ACK).toBe(41);
        expect(RadiusCode.DISCONNECT_NAK).toBe(42);
        expect(RadiusCode.COA_REQUEST).toBe(43);
        expect(RadiusCode.COA_ACK).toBe(44);
        expect(RadiusCode.COA_NAK).toBe(45);
    });
});

// =============================================
// Standard Attribute Type Tests
// =============================================
describe('Standard RADIUS Attributes', () => {
    describe('Authentication Attributes', () => {
        it('should have correct User-Name type', () => {
            expect(RadiusAttributeType.USER_NAME).toBe(1);
        });

        it('should have correct User-Password type', () => {
            expect(RadiusAttributeType.USER_PASSWORD).toBe(2);
        });

        it('should have correct CHAP-Password type', () => {
            expect(RadiusAttributeType.CHAP_PASSWORD).toBe(3);
        });

        it('should have correct CHAP-Challenge type', () => {
            expect(RadiusAttributeType.CHAP_CHALLENGE).toBe(60);
        });

        it('should have correct EAP-Message type', () => {
            expect(RadiusAttributeType.EAP_MESSAGE).toBe(79);
        });

        it('should have correct Message-Authenticator type', () => {
            expect(RadiusAttributeType.MESSAGE_AUTHENTICATOR).toBe(80);
        });
    });

    describe('NAS Attributes', () => {
        it('should have correct NAS-IP-Address type', () => {
            expect(RadiusAttributeType.NAS_IP_ADDRESS).toBe(4);
        });

        it('should have correct NAS-Port type', () => {
            expect(RadiusAttributeType.NAS_PORT).toBe(5);
        });

        it('should have correct NAS-Identifier type', () => {
            expect(RadiusAttributeType.NAS_IDENTIFIER).toBe(32);
        });

        it('should have correct NAS-Port-Type type', () => {
            expect(RadiusAttributeType.NAS_PORT_TYPE).toBe(61);
        });

        it('should have correct NAS-Port-Id type', () => {
            expect(RadiusAttributeType.NAS_PORT_ID).toBe(87);
        });
    });

    describe('Session Attributes', () => {
        it('should have correct Service-Type type', () => {
            expect(RadiusAttributeType.SERVICE_TYPE).toBe(6);
        });

        it('should have correct Framed-Protocol type', () => {
            expect(RadiusAttributeType.FRAMED_PROTOCOL).toBe(7);
        });

        it('should have correct Framed-IP-Address type', () => {
            expect(RadiusAttributeType.FRAMED_IP_ADDRESS).toBe(8);
        });

        it('should have correct Session-Timeout type', () => {
            expect(RadiusAttributeType.SESSION_TIMEOUT).toBe(27);
        });

        it('should have correct Idle-Timeout type', () => {
            expect(RadiusAttributeType.IDLE_TIMEOUT).toBe(28);
        });
    });

    describe('Accounting Attributes', () => {
        it('should have correct Acct-Status-Type type', () => {
            expect(RadiusAttributeType.ACCT_STATUS_TYPE).toBe(40);
        });

        it('should have correct Acct-Session-Id type', () => {
            expect(RadiusAttributeType.ACCT_SESSION_ID).toBe(44);
        });

        it('should have correct Acct-Session-Time type', () => {
            expect(RadiusAttributeType.ACCT_SESSION_TIME).toBe(46);
        });

        it('should have correct Acct-Input-Octets type', () => {
            expect(RadiusAttributeType.ACCT_INPUT_OCTETS).toBe(42);
        });

        it('should have correct Acct-Output-Octets type', () => {
            expect(RadiusAttributeType.ACCT_OUTPUT_OCTETS).toBe(43);
        });

        it('should have correct Gigawords types', () => {
            expect(RadiusAttributeType.ACCT_INPUT_GIGAWORDS).toBe(52);
            expect(RadiusAttributeType.ACCT_OUTPUT_GIGAWORDS).toBe(53);
        });

        it('should have correct Acct-Interim-Interval type', () => {
            expect(RadiusAttributeType.ACCT_INTERIM_INTERVAL).toBe(85);
        });

        it('should have correct Acct-Terminate-Cause type', () => {
            expect(RadiusAttributeType.ACCT_TERMINATE_CAUSE).toBe(49);
        });
    });

    describe('Station ID Attributes', () => {
        it('should have correct Called-Station-Id type', () => {
            expect(RadiusAttributeType.CALLED_STATION_ID).toBe(30);
        });

        it('should have correct Calling-Station-Id type', () => {
            expect(RadiusAttributeType.CALLING_STATION_ID).toBe(31);
        });
    });

    describe('Vendor-Specific Attribute', () => {
        it('should have correct Vendor-Specific type', () => {
            expect(RadiusAttributeType.VENDOR_SPECIFIC).toBe(26);
        });
    });
});

// =============================================
// Accounting Status Type Tests
// =============================================
describe('Accounting Status Types', () => {
    it('should have correct Start value', () => {
        expect(AcctStatusType.START).toBe(1);
    });

    it('should have correct Stop value', () => {
        expect(AcctStatusType.STOP).toBe(2);
    });

    it('should have correct Interim-Update value', () => {
        expect(AcctStatusType.INTERIM_UPDATE).toBe(3);
    });

    it('should have correct Accounting-On value', () => {
        expect(AcctStatusType.ACCOUNTING_ON).toBe(7);
    });

    it('should have correct Accounting-Off value', () => {
        expect(AcctStatusType.ACCOUNTING_OFF).toBe(8);
    });
});

// =============================================
// Terminate Cause Tests
// =============================================
describe('Termination Causes', () => {
    it('should have correct User-Request value', () => {
        expect(AcctTerminateCause.USER_REQUEST).toBe(1);
    });

    it('should have correct Lost-Carrier value', () => {
        expect(AcctTerminateCause.LOST_CARRIER).toBe(2);
    });

    it('should have correct Idle-Timeout value', () => {
        expect(AcctTerminateCause.IDLE_TIMEOUT).toBe(4);
    });

    it('should have correct Session-Timeout value', () => {
        expect(AcctTerminateCause.SESSION_TIMEOUT).toBe(5);
    });

    it('should have correct Admin-Reset value', () => {
        expect(AcctTerminateCause.ADMIN_RESET).toBe(6);
    });

    it('should have correct NAS-Reboot value', () => {
        expect(AcctTerminateCause.NAS_REBOOT).toBe(11);
    });
});

// =============================================
// Service Type Tests
// =============================================
describe('Service Types', () => {
    it('should have correct Login value', () => {
        expect(ServiceType.LOGIN).toBe(1);
    });

    it('should have correct Framed value (for PPP)', () => {
        expect(ServiceType.FRAMED).toBe(2);
    });

    it('should have correct Administrative value', () => {
        expect(ServiceType.ADMINISTRATIVE).toBe(6);
    });

    it('should have correct Authenticate-Only value', () => {
        expect(ServiceType.AUTHENTICATE_ONLY).toBe(8);
    });
});

// =============================================
// MikroTik VSA Tests
// =============================================
describe('MikroTik Vendor-Specific Attributes', () => {
    it('should have correct MikroTik Vendor ID', () => {
        expect(MIKROTIK_VENDOR_ID).toBe(14988);
    });

    describe('Rate Limiting Attributes', () => {
        it('should have correct Rate-Limit type', () => {
            expect(MikroTikAttribute.RATE_LIMIT).toBe(8);
        });

        it('should have correct Recv-Limit type', () => {
            expect(MikroTikAttribute.RECV_LIMIT).toBe(1);
        });

        it('should have correct Xmit-Limit type', () => {
            expect(MikroTikAttribute.XMIT_LIMIT).toBe(2);
        });

        it('should have correct Total-Limit type', () => {
            expect(MikroTikAttribute.TOTAL_LIMIT).toBe(17);
        });

        it('should have correct Gigawords types', () => {
            expect(MikroTikAttribute.RECV_LIMIT_GIGAWORDS).toBe(14);
            expect(MikroTikAttribute.XMIT_LIMIT_GIGAWORDS).toBe(15);
            expect(MikroTikAttribute.TOTAL_LIMIT_GIGAWORDS).toBe(18);
        });
    });

    describe('Wireless Attributes', () => {
        it('should have correct Wireless-PSK type', () => {
            expect(MikroTikAttribute.WIRELESS_PSK).toBe(16);
        });

        it('should have correct Wireless-VLANID type', () => {
            expect(MikroTikAttribute.WIRELESS_VLANID).toBe(26);
        });
    });

    describe('Other MikroTik Attributes', () => {
        it('should have correct Group type', () => {
            expect(MikroTikAttribute.GROUP).toBe(3);
        });

        it('should have correct Realm type', () => {
            expect(MikroTikAttribute.REALM).toBe(9);
        });

        it('should have correct Host-IP type', () => {
            expect(MikroTikAttribute.HOST_IP).toBe(10);
        });

        it('should have correct Address-List type', () => {
            expect(MikroTikAttribute.ADDRESS_LIST).toBe(19);
        });

        it('should have correct Delegated-IPv6-Pool type', () => {
            expect(MikroTikAttribute.DELEGATED_IPV6_POOL).toBe(22);
        });
    });
});

// =============================================
// VSA Encoding Tests
// =============================================
describe('VSA Encoding', () => {
    function encodeVSA(vendorId: number, vendorType: number, value: Buffer): Buffer {
        // VSA format: Type (26) | Length | Vendor-Id (4) | Vendor-Type | Vendor-Length | Value
        const attrLength = 2 + 4 + 2 + value.length;
        const buffer = Buffer.alloc(attrLength);

        buffer[0] = 26; // Vendor-Specific
        buffer[1] = attrLength;
        buffer.writeUInt32BE(vendorId, 2);
        buffer[6] = vendorType;
        buffer[7] = 2 + value.length;
        value.copy(buffer, 8);

        return buffer;
    }

    it('should encode MikroTik Rate-Limit correctly', () => {
        const rateLimit = Buffer.from('10M/10M');
        const vsa = encodeVSA(MIKROTIK_VENDOR_ID, MikroTikAttribute.RATE_LIMIT, rateLimit);

        expect(vsa[0]).toBe(26); // Vendor-Specific
        expect(vsa.readUInt32BE(2)).toBe(14988); // MikroTik Vendor ID
        expect(vsa[6]).toBe(8); // Rate-Limit type
        expect(vsa.slice(8).toString()).toBe('10M/10M');
    });

    it('should encode MikroTik Total-Limit correctly', () => {
        const totalLimit = Buffer.alloc(4);
        totalLimit.writeUInt32BE(1073741824); // 1GB
        const vsa = encodeVSA(MIKROTIK_VENDOR_ID, MikroTikAttribute.TOTAL_LIMIT, totalLimit);

        expect(vsa[0]).toBe(26);
        expect(vsa.readUInt32BE(2)).toBe(14988);
        expect(vsa[6]).toBe(17); // Total-Limit type
        expect(vsa.slice(8).readUInt32BE()).toBe(1073741824);
    });
});
