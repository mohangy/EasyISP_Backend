/**
 * RADIUS Attribute Dictionary
 * RFC 2865 (Authentication) + RFC 2866 (Accounting) + MikroTik Vendor Specific
 */

// RADIUS Packet Types (RFC 2865)
export enum RadiusCode {
    ACCESS_REQUEST = 1,
    ACCESS_ACCEPT = 2,
    ACCESS_REJECT = 3,
    ACCOUNTING_REQUEST = 4,
    ACCOUNTING_RESPONSE = 5,
    ACCESS_CHALLENGE = 11,
    STATUS_SERVER = 12,
    STATUS_CLIENT = 13,
    DISCONNECT_REQUEST = 40,  // RFC 5176 (CoA)
    DISCONNECT_ACK = 41,
    DISCONNECT_NAK = 42,
    COA_REQUEST = 43,
    COA_ACK = 44,
    COA_NAK = 45,
}

// Standard RADIUS Attribute Types (RFC 2865/2866)
export enum RadiusAttributeType {
    USER_NAME = 1,
    USER_PASSWORD = 2,
    CHAP_PASSWORD = 3,
    NAS_IP_ADDRESS = 4,
    NAS_PORT = 5,
    SERVICE_TYPE = 6,
    FRAMED_PROTOCOL = 7,
    FRAMED_IP_ADDRESS = 8,
    FRAMED_IP_NETMASK = 9,
    FRAMED_ROUTING = 10,
    FILTER_ID = 11,
    FRAMED_MTU = 12,
    FRAMED_COMPRESSION = 13,
    LOGIN_IP_HOST = 14,
    LOGIN_SERVICE = 15,
    LOGIN_TCP_PORT = 16,
    REPLY_MESSAGE = 18,
    CALLBACK_NUMBER = 19,
    CALLBACK_ID = 20,
    FRAMED_ROUTE = 22,
    FRAMED_IPX_NETWORK = 23,
    STATE = 24,
    CLASS = 25,
    VENDOR_SPECIFIC = 26,
    SESSION_TIMEOUT = 27,
    IDLE_TIMEOUT = 28,
    TERMINATION_ACTION = 29,
    CALLED_STATION_ID = 30,
    CALLING_STATION_ID = 31,
    NAS_IDENTIFIER = 32,
    PROXY_STATE = 33,
    LOGIN_LAT_SERVICE = 34,
    LOGIN_LAT_NODE = 35,
    LOGIN_LAT_GROUP = 36,
    FRAMED_APPLETALK_LINK = 37,
    FRAMED_APPLETALK_NETWORK = 38,
    FRAMED_APPLETALK_ZONE = 39,
    ACCT_STATUS_TYPE = 40,
    ACCT_DELAY_TIME = 41,
    ACCT_INPUT_OCTETS = 42,
    ACCT_OUTPUT_OCTETS = 43,
    ACCT_SESSION_ID = 44,
    ACCT_AUTHENTIC = 45,
    ACCT_SESSION_TIME = 46,
    ACCT_INPUT_PACKETS = 47,
    ACCT_OUTPUT_PACKETS = 48,
    ACCT_TERMINATE_CAUSE = 49,
    ACCT_MULTI_SESSION_ID = 50,
    ACCT_LINK_COUNT = 51,
    ACCT_INPUT_GIGAWORDS = 52,
    ACCT_OUTPUT_GIGAWORDS = 53,
    EVENT_TIMESTAMP = 55,
    CHAP_CHALLENGE = 60,
    NAS_PORT_TYPE = 61,
    PORT_LIMIT = 62,
    LOGIN_LAT_PORT = 63,
    TUNNEL_TYPE = 64,
    TUNNEL_MEDIUM_TYPE = 65,
    TUNNEL_CLIENT_ENDPOINT = 66,
    TUNNEL_SERVER_ENDPOINT = 67,
    ACCT_TUNNEL_CONNECTION = 68,
    TUNNEL_PASSWORD = 69,
    ARAP_PASSWORD = 70,
    ARAP_FEATURES = 71,
    ARAP_ZONE_ACCESS = 72,
    ARAP_SECURITY = 73,
    ARAP_SECURITY_DATA = 74,
    PASSWORD_RETRY = 75,
    PROMPT = 76,
    CONNECT_INFO = 77,
    CONFIGURATION_TOKEN = 78,
    EAP_MESSAGE = 79,
    MESSAGE_AUTHENTICATOR = 80,
    TUNNEL_PRIVATE_GROUP_ID = 81,
    TUNNEL_ASSIGNMENT_ID = 82,
    TUNNEL_PREFERENCE = 83,
    ARAP_CHALLENGE_RESPONSE = 84,
    ACCT_INTERIM_INTERVAL = 85,
    ACCT_TUNNEL_PACKETS_LOST = 86,
    NAS_PORT_ID = 87,
    FRAMED_POOL = 88,
    CUI = 89,
    TUNNEL_CLIENT_AUTH_ID = 90,
    TUNNEL_SERVER_AUTH_ID = 91,
    NAS_FILTER_RULE = 92,
    ORIGINATING_LINE_INFO = 94,
    NAS_IPV6_ADDRESS = 95,
    FRAMED_INTERFACE_ID = 96,
    FRAMED_IPV6_PREFIX = 97,
    LOGIN_IPV6_HOST = 98,
    FRAMED_IPV6_ROUTE = 99,
    FRAMED_IPV6_POOL = 100,
    ERROR_CAUSE = 101,
    EAP_KEY_NAME = 102,
    DIGEST_RESPONSE = 103,
    DIGEST_REALM = 104,
    DIGEST_NONCE = 105,
    DIGEST_RESPONSE_AUTH = 106,
    DIGEST_NEXTNONCE = 107,
    DIGEST_METHOD = 108,
    DIGEST_URI = 109,
    DIGEST_QOP = 110,
    DIGEST_ALGORITHM = 111,
    DIGEST_ENTITY_BODY_HASH = 112,
    DIGEST_CNONCE = 113,
    DIGEST_NONCE_COUNT = 114,
    DIGEST_USERNAME = 115,
    DIGEST_OPAQUE = 116,
    DIGEST_AUTH_PARAM = 117,
    DIGEST_AKA_AUTS = 118,
    DIGEST_DOMAIN = 119,
    DIGEST_STALE = 120,
    DIGEST_HA1 = 121,
    SIP_AOR = 122,
    DELEGATED_IPV6_PREFIX = 123,
    MIP6_FEATURE_VECTOR = 124,
    MIP6_HOME_LINK_PREFIX = 125,
}

// Acct-Status-Type values (RFC 2866)
export enum AcctStatusType {
    START = 1,
    STOP = 2,
    INTERIM_UPDATE = 3,
    ACCOUNTING_ON = 7,
    ACCOUNTING_OFF = 8,
}

// Acct-Terminate-Cause values (RFC 2866)
export enum AcctTerminateCause {
    USER_REQUEST = 1,
    LOST_CARRIER = 2,
    LOST_SERVICE = 3,
    IDLE_TIMEOUT = 4,
    SESSION_TIMEOUT = 5,
    ADMIN_RESET = 6,
    ADMIN_REBOOT = 7,
    PORT_ERROR = 8,
    NAS_ERROR = 9,
    NAS_REQUEST = 10,
    NAS_REBOOT = 11,
    PORT_UNNEEDED = 12,
    PORT_PREEMPTED = 13,
    PORT_SUSPENDED = 14,
    SERVICE_UNAVAILABLE = 15,
    CALLBACK = 16,
    USER_ERROR = 17,
    HOST_REQUEST = 18,
}

// Service-Type values (RFC 2865)
export enum ServiceType {
    LOGIN = 1,
    FRAMED = 2,
    CALLBACK_LOGIN = 3,
    CALLBACK_FRAMED = 4,
    OUTBOUND = 5,
    ADMINISTRATIVE = 6,
    NAS_PROMPT = 7,
    AUTHENTICATE_ONLY = 8,
    CALLBACK_NAS_PROMPT = 9,
    CALL_CHECK = 10,
    CALLBACK_ADMINISTRATIVE = 11,
}

// NAS-Port-Type values (RFC 2865)
export enum NasPortType {
    ASYNC = 0,
    SYNC = 1,
    ISDN_SYNC = 2,
    ISDN_ASYNC_V120 = 3,
    ISDN_ASYNC_V110 = 4,
    VIRTUAL = 5,
    PIAFS = 6,
    HDLC_CLEAR_CHANNEL = 7,
    X25 = 8,
    X75 = 9,
    G3_FAX = 10,
    SDSL = 11,
    ADSL_CAP = 12,
    ADSL_DMT = 13,
    IDSL = 14,
    ETHERNET = 15,
    XDSL = 16,
    CABLE = 17,
    WIRELESS_OTHER = 18,
    WIRELESS_802_11 = 19,
}

// MikroTik Vendor ID
export const MIKROTIK_VENDOR_ID = 14988;

// MikroTik Vendor-Specific Attributes
export enum MikroTikAttribute {
    RECV_LIMIT = 1,           // Bytes limit download
    XMIT_LIMIT = 2,           // Bytes limit upload
    GROUP = 3,                // User group name
    WIRELESS_FORWARD = 4,     // Allow wireless forwarding
    WIRELESS_SKIP_DOT1X = 5,  // Skip 802.1x
    WIRELESS_ENC_ALGO = 6,    // Encryption algorithm
    WIRELESS_ENC_KEY = 7,     // Encryption key
    RATE_LIMIT = 8,           // Rate limit string (e.g., "1M/2M")
    REALM = 9,                // Realm
    HOST_IP = 10,             // Host IP
    MARK_ID = 11,             // Mark ID
    ADVERTISE_URL = 12,       // Advertisement URL
    ADVERTISE_INTERVAL = 13,  // Advertisement interval
    RECV_LIMIT_GIGAWORDS = 14,
    XMIT_LIMIT_GIGAWORDS = 15,
    WIRELESS_PSK = 16,
    TOTAL_LIMIT = 17,
    TOTAL_LIMIT_GIGAWORDS = 18,
    ADDRESS_LIST = 19,
    WIRELESS_MPKEY = 20,
    WIRELESS_COMMENT = 21,
    DELEGATED_IPV6_POOL = 22,
    DHCP_OPTION_SET = 23,
    DHCP_OPTION_PARAM_STR1 = 24,
    DHCP_OPTION_PARAM_STR2 = 25,
    WIRELESS_VLANID = 26,
    WIRELESS_VLANID_TYPE = 27,
    WIRELESS_MINSIGNAL = 28,
    WIRELESS_MAXSIGNAL = 29,
}

// Attribute definition for encoding/decoding
export interface AttributeDefinition {
    type: number;
    name: string;
    dataType: 'string' | 'ipaddr' | 'integer' | 'octets' | 'date' | 'ifid' | 'ipv6addr' | 'ipv6prefix';
    vendorId?: number;
}

// Build attribute dictionary
export const ATTRIBUTE_DICTIONARY: Map<number, AttributeDefinition> = new Map([
    [RadiusAttributeType.USER_NAME, { type: 1, name: 'User-Name', dataType: 'string' }],
    [RadiusAttributeType.USER_PASSWORD, { type: 2, name: 'User-Password', dataType: 'octets' }],
    [RadiusAttributeType.CHAP_PASSWORD, { type: 3, name: 'CHAP-Password', dataType: 'octets' }],
    [RadiusAttributeType.NAS_IP_ADDRESS, { type: 4, name: 'NAS-IP-Address', dataType: 'ipaddr' }],
    [RadiusAttributeType.NAS_PORT, { type: 5, name: 'NAS-Port', dataType: 'integer' }],
    [RadiusAttributeType.SERVICE_TYPE, { type: 6, name: 'Service-Type', dataType: 'integer' }],
    [RadiusAttributeType.FRAMED_PROTOCOL, { type: 7, name: 'Framed-Protocol', dataType: 'integer' }],
    [RadiusAttributeType.FRAMED_IP_ADDRESS, { type: 8, name: 'Framed-IP-Address', dataType: 'ipaddr' }],
    [RadiusAttributeType.FRAMED_IP_NETMASK, { type: 9, name: 'Framed-IP-Netmask', dataType: 'ipaddr' }],
    [RadiusAttributeType.FILTER_ID, { type: 11, name: 'Filter-Id', dataType: 'string' }],
    [RadiusAttributeType.FRAMED_MTU, { type: 12, name: 'Framed-MTU', dataType: 'integer' }],
    [RadiusAttributeType.REPLY_MESSAGE, { type: 18, name: 'Reply-Message', dataType: 'string' }],
    [RadiusAttributeType.STATE, { type: 24, name: 'State', dataType: 'octets' }],
    [RadiusAttributeType.CLASS, { type: 25, name: 'Class', dataType: 'octets' }],
    [RadiusAttributeType.VENDOR_SPECIFIC, { type: 26, name: 'Vendor-Specific', dataType: 'octets' }],
    [RadiusAttributeType.SESSION_TIMEOUT, { type: 27, name: 'Session-Timeout', dataType: 'integer' }],
    [RadiusAttributeType.IDLE_TIMEOUT, { type: 28, name: 'Idle-Timeout', dataType: 'integer' }],
    [RadiusAttributeType.CALLED_STATION_ID, { type: 30, name: 'Called-Station-Id', dataType: 'string' }],
    [RadiusAttributeType.CALLING_STATION_ID, { type: 31, name: 'Calling-Station-Id', dataType: 'string' }],
    [RadiusAttributeType.NAS_IDENTIFIER, { type: 32, name: 'NAS-Identifier', dataType: 'string' }],
    [RadiusAttributeType.ACCT_STATUS_TYPE, { type: 40, name: 'Acct-Status-Type', dataType: 'integer' }],
    [RadiusAttributeType.ACCT_DELAY_TIME, { type: 41, name: 'Acct-Delay-Time', dataType: 'integer' }],
    [RadiusAttributeType.ACCT_INPUT_OCTETS, { type: 42, name: 'Acct-Input-Octets', dataType: 'integer' }],
    [RadiusAttributeType.ACCT_OUTPUT_OCTETS, { type: 43, name: 'Acct-Output-Octets', dataType: 'integer' }],
    [RadiusAttributeType.ACCT_SESSION_ID, { type: 44, name: 'Acct-Session-Id', dataType: 'string' }],
    [RadiusAttributeType.ACCT_AUTHENTIC, { type: 45, name: 'Acct-Authentic', dataType: 'integer' }],
    [RadiusAttributeType.ACCT_SESSION_TIME, { type: 46, name: 'Acct-Session-Time', dataType: 'integer' }],
    [RadiusAttributeType.ACCT_INPUT_PACKETS, { type: 47, name: 'Acct-Input-Packets', dataType: 'integer' }],
    [RadiusAttributeType.ACCT_OUTPUT_PACKETS, { type: 48, name: 'Acct-Output-Packets', dataType: 'integer' }],
    [RadiusAttributeType.ACCT_TERMINATE_CAUSE, { type: 49, name: 'Acct-Terminate-Cause', dataType: 'integer' }],
    [RadiusAttributeType.ACCT_INPUT_GIGAWORDS, { type: 52, name: 'Acct-Input-Gigawords', dataType: 'integer' }],
    [RadiusAttributeType.ACCT_OUTPUT_GIGAWORDS, { type: 53, name: 'Acct-Output-Gigawords', dataType: 'integer' }],
    [RadiusAttributeType.EVENT_TIMESTAMP, { type: 55, name: 'Event-Timestamp', dataType: 'date' }],
    [RadiusAttributeType.CHAP_CHALLENGE, { type: 60, name: 'CHAP-Challenge', dataType: 'octets' }],
    [RadiusAttributeType.NAS_PORT_TYPE, { type: 61, name: 'NAS-Port-Type', dataType: 'integer' }],
    [RadiusAttributeType.NAS_PORT_ID, { type: 87, name: 'NAS-Port-Id', dataType: 'string' }],
    [RadiusAttributeType.FRAMED_POOL, { type: 88, name: 'Framed-Pool', dataType: 'string' }],
    [RadiusAttributeType.MESSAGE_AUTHENTICATOR, { type: 80, name: 'Message-Authenticator', dataType: 'octets' }],
    [RadiusAttributeType.ACCT_INTERIM_INTERVAL, { type: 85, name: 'Acct-Interim-Interval', dataType: 'integer' }],
    [RadiusAttributeType.ERROR_CAUSE, { type: 101, name: 'Error-Cause', dataType: 'integer' }],
]);

// MikroTik VSA Dictionary
export const MIKROTIK_DICTIONARY: Map<number, AttributeDefinition> = new Map([
    [MikroTikAttribute.RECV_LIMIT, { type: 1, name: 'Mikrotik-Recv-Limit', dataType: 'integer', vendorId: MIKROTIK_VENDOR_ID }],
    [MikroTikAttribute.XMIT_LIMIT, { type: 2, name: 'Mikrotik-Xmit-Limit', dataType: 'integer', vendorId: MIKROTIK_VENDOR_ID }],
    [MikroTikAttribute.GROUP, { type: 3, name: 'Mikrotik-Group', dataType: 'string', vendorId: MIKROTIK_VENDOR_ID }],
    [MikroTikAttribute.RATE_LIMIT, { type: 8, name: 'Mikrotik-Rate-Limit', dataType: 'string', vendorId: MIKROTIK_VENDOR_ID }],
    [MikroTikAttribute.REALM, { type: 9, name: 'Mikrotik-Realm', dataType: 'string', vendorId: MIKROTIK_VENDOR_ID }],
    [MikroTikAttribute.HOST_IP, { type: 10, name: 'Mikrotik-Host-IP', dataType: 'ipaddr', vendorId: MIKROTIK_VENDOR_ID }],
    [MikroTikAttribute.MARK_ID, { type: 11, name: 'Mikrotik-Mark-Id', dataType: 'string', vendorId: MIKROTIK_VENDOR_ID }],
    [MikroTikAttribute.ADVERTISE_URL, { type: 12, name: 'Mikrotik-Advertise-URL', dataType: 'string', vendorId: MIKROTIK_VENDOR_ID }],
    [MikroTikAttribute.ADVERTISE_INTERVAL, { type: 13, name: 'Mikrotik-Advertise-Interval', dataType: 'integer', vendorId: MIKROTIK_VENDOR_ID }],
    [MikroTikAttribute.TOTAL_LIMIT, { type: 17, name: 'Mikrotik-Total-Limit', dataType: 'integer', vendorId: MIKROTIK_VENDOR_ID }],
    [MikroTikAttribute.ADDRESS_LIST, { type: 19, name: 'Mikrotik-Address-List', dataType: 'string', vendorId: MIKROTIK_VENDOR_ID }],
    [MikroTikAttribute.DELEGATED_IPV6_POOL, { type: 22, name: 'Mikrotik-Delegated-IPv6-Pool', dataType: 'string', vendorId: MIKROTIK_VENDOR_ID }],
]);
