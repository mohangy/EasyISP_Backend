/**
 * RADIUS CoA (Change of Authorization) Tests
 * Tests for Disconnect-Request and CoA-Request handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// =============================================
// CoA Packet Building Tests
// =============================================
describe('CoA Packet Building', () => {
    const COA_CODES = {
        DISCONNECT_REQUEST: 40,
        DISCONNECT_ACK: 41,
        DISCONNECT_NAK: 42,
        COA_REQUEST: 43,
        COA_ACK: 44,
        COA_NAK: 45,
    };

    function buildCoaPacket(
        code: number,
        identifier: number,
        secret: string,
        attributes: Buffer
    ): Buffer {
        const length = 20 + attributes.length;
        const packet = Buffer.alloc(length);

        packet[0] = code;
        packet[1] = identifier;
        packet.writeUInt16BE(length, 2);

        // Calculate authenticator (zeros initially for calculation)
        const authenticator = crypto.createHash('md5')
            .update(packet.slice(0, 4))
            .update(Buffer.alloc(16, 0))
            .update(attributes)
            .update(Buffer.from(secret))
            .digest();

        authenticator.copy(packet, 4);
        attributes.copy(packet, 20);

        return packet;
    }

    it('should build Disconnect-Request packet', () => {
        const attrs = Buffer.alloc(0);
        const packet = buildCoaPacket(COA_CODES.DISCONNECT_REQUEST, 1, 'secret', attrs);

        expect(packet[0]).toBe(40); // Disconnect-Request
        expect(packet[1]).toBe(1); // Identifier
        expect(packet.readUInt16BE(2)).toBe(20); // Length
    });

    it('should build CoA-Request packet', () => {
        const attrs = Buffer.alloc(0);
        const packet = buildCoaPacket(COA_CODES.COA_REQUEST, 5, 'secret', attrs);

        expect(packet[0]).toBe(43); // CoA-Request
        expect(packet[1]).toBe(5);
    });

    it('should include correct length with attributes', () => {
        const attrs = Buffer.from([1, 8, 0x75, 0x73, 0x65, 0x72, 0x31, 0x00]); // User-Name = "user1"
        const packet = buildCoaPacket(COA_CODES.DISCONNECT_REQUEST, 1, 'secret', attrs);

        expect(packet.readUInt16BE(2)).toBe(20 + attrs.length);
    });

    it('should calculate correct authenticator', () => {
        const attrs = Buffer.alloc(0);
        const secret = 'testsecret';
        const packet = buildCoaPacket(COA_CODES.DISCONNECT_REQUEST, 1, secret, attrs);

        // Verify by recalculating
        const expectedAuth = crypto.createHash('md5')
            .update(packet.slice(0, 4))
            .update(Buffer.alloc(16, 0))
            .update(packet.slice(20))
            .update(Buffer.from(secret))
            .digest();

        expect(packet.slice(4, 20).equals(expectedAuth)).toBe(true);
    });
});

// =============================================
// Disconnect-Request Tests
// =============================================
describe('Disconnect-Request', () => {
    interface DisconnectRequest {
        username: string;
        sessionId?: string;
        nasPort?: number;
        framedIp?: string;
    }

    function buildDisconnectAttributes(req: DisconnectRequest): Buffer {
        const attrs: Buffer[] = [];

        // User-Name (type 1)
        const usernameAttr = Buffer.alloc(2 + req.username.length);
        usernameAttr[0] = 1;
        usernameAttr[1] = 2 + req.username.length;
        Buffer.from(req.username).copy(usernameAttr, 2);
        attrs.push(usernameAttr);

        // Acct-Session-Id (type 44)
        if (req.sessionId) {
            const sessionAttr = Buffer.alloc(2 + req.sessionId.length);
            sessionAttr[0] = 44;
            sessionAttr[1] = 2 + req.sessionId.length;
            Buffer.from(req.sessionId).copy(sessionAttr, 2);
            attrs.push(sessionAttr);
        }

        // NAS-Port (type 5)
        if (req.nasPort !== undefined) {
            const portAttr = Buffer.alloc(6);
            portAttr[0] = 5;
            portAttr[1] = 6;
            portAttr.writeUInt32BE(req.nasPort, 2);
            attrs.push(portAttr);
        }

        // Framed-IP-Address (type 8)
        if (req.framedIp) {
            const parts = req.framedIp.split('.').map(Number);
            const ipAttr = Buffer.alloc(6);
            ipAttr[0] = 8;
            ipAttr[1] = 6;
            ipAttr[2] = parts[0];
            ipAttr[3] = parts[1];
            ipAttr[4] = parts[2];
            ipAttr[5] = parts[3];
            attrs.push(ipAttr);
        }

        return Buffer.concat(attrs);
    }

    it('should include User-Name attribute', () => {
        const attrs = buildDisconnectAttributes({ username: 'testuser' });
        expect(attrs[0]).toBe(1); // User-Name type
        expect(attrs.slice(2, 2 + 8).toString()).toBe('testuser');
    });

    it('should include Session-Id attribute', () => {
        const attrs = buildDisconnectAttributes({
            username: 'user1',
            sessionId: 'abc123',
        });

        // Find Session-Id attribute (after User-Name)
        let offset = 2 + 'user1'.length;
        expect(attrs[offset]).toBe(44); // Acct-Session-Id type
        expect(attrs.slice(offset + 2, offset + 2 + 6).toString()).toBe('abc123');
    });

    it('should include Framed-IP-Address attribute', () => {
        const attrs = buildDisconnectAttributes({
            username: 'user1',
            framedIp: '10.0.0.5',
        });

        // Find IP attribute
        let offset = 2 + 'user1'.length;
        expect(attrs[offset]).toBe(8); // Framed-IP-Address type
        expect(attrs[offset + 2]).toBe(10);
        expect(attrs[offset + 3]).toBe(0);
        expect(attrs[offset + 4]).toBe(0);
        expect(attrs[offset + 5]).toBe(5);
    });
});

// =============================================
// CoA Speed Change Tests
// =============================================
describe('CoA Speed Change', () => {
    const MIKROTIK_VENDOR_ID = 14988;
    const MIKROTIK_RATE_LIMIT = 8;

    function buildSpeedChangeAttributes(
        username: string,
        rateLimit: string
    ): Buffer {
        const attrs: Buffer[] = [];

        // User-Name
        const usernameAttr = Buffer.alloc(2 + username.length);
        usernameAttr[0] = 1;
        usernameAttr[1] = 2 + username.length;
        Buffer.from(username).copy(usernameAttr, 2);
        attrs.push(usernameAttr);

        // MikroTik-Rate-Limit VSA
        const rateBytes = Buffer.from(rateLimit);
        const vsaLength = 2 + 4 + 2 + rateBytes.length;
        const vsa = Buffer.alloc(vsaLength);
        vsa[0] = 26; // Vendor-Specific
        vsa[1] = vsaLength;
        vsa.writeUInt32BE(MIKROTIK_VENDOR_ID, 2);
        vsa[6] = MIKROTIK_RATE_LIMIT;
        vsa[7] = 2 + rateBytes.length;
        rateBytes.copy(vsa, 8);
        attrs.push(vsa);

        return Buffer.concat(attrs);
    }

    it('should include User-Name for speed change', () => {
        const attrs = buildSpeedChangeAttributes('user1', '10M/20M');
        expect(attrs[0]).toBe(1); // User-Name
    });

    it('should include MikroTik-Rate-Limit VSA', () => {
        const attrs = buildSpeedChangeAttributes('user1', '10M/20M');

        // Find VSA after User-Name
        let offset = 2 + 'user1'.length;
        expect(attrs[offset]).toBe(26); // Vendor-Specific
        expect(attrs.readUInt32BE(offset + 2)).toBe(14988); // MikroTik Vendor ID
        expect(attrs[offset + 6]).toBe(8); // Rate-Limit type
        expect(attrs.slice(offset + 8, offset + 8 + 7).toString()).toBe('10M/20M');
    });

    it('should format different speed values', () => {
        const attrs = buildSpeedChangeAttributes('user1', '5M/50M');
        const offset = 2 + 'user1'.length;
        expect(attrs.slice(offset + 8, offset + 8 + 6).toString()).toBe('5M/50M');
    });
});

// =============================================
// CoA Response Handling Tests
// =============================================
describe('CoA Response Handling', () => {
    interface CoaResult {
        success: boolean;
        code: number;
        message: string;
    }

    function handleCoaResponse(responseCode: number): CoaResult {
        switch (responseCode) {
            case 41: // Disconnect-ACK
                return { success: true, code: 41, message: 'User disconnected successfully' };
            case 42: // Disconnect-NAK
                return { success: false, code: 42, message: 'Disconnect failed' };
            case 44: // CoA-ACK
                return { success: true, code: 44, message: 'Configuration updated successfully' };
            case 45: // CoA-NAK
                return { success: false, code: 45, message: 'Configuration update failed' };
            default:
                return { success: false, code: responseCode, message: 'Unknown response' };
        }
    }

    it('should handle Disconnect-ACK', () => {
        const result = handleCoaResponse(41);
        expect(result.success).toBe(true);
        expect(result.message).toContain('disconnected');
    });

    it('should handle Disconnect-NAK', () => {
        const result = handleCoaResponse(42);
        expect(result.success).toBe(false);
        expect(result.message).toContain('failed');
    });

    it('should handle CoA-ACK', () => {
        const result = handleCoaResponse(44);
        expect(result.success).toBe(true);
        expect(result.message).toContain('updated');
    });

    it('should handle CoA-NAK', () => {
        const result = handleCoaResponse(45);
        expect(result.success).toBe(false);
        expect(result.message).toContain('failed');
    });

    it('should handle unknown response', () => {
        const result = handleCoaResponse(99);
        expect(result.success).toBe(false);
        expect(result.message).toContain('Unknown');
    });
});

// =============================================
// CoA Timeout Handling Tests
// =============================================
describe('CoA Timeout Handling', () => {
    interface CoaRequest {
        id: number;
        sentAt: Date;
        retries: number;
        maxRetries: number;
        timeoutMs: number;
    }

    function isTimedOut(request: CoaRequest, now: Date = new Date()): boolean {
        return now.getTime() - request.sentAt.getTime() > request.timeoutMs;
    }

    function shouldRetry(request: CoaRequest): boolean {
        return request.retries < request.maxRetries && isTimedOut(request);
    }

    it('should not time out immediately', () => {
        const request: CoaRequest = {
            id: 1,
            sentAt: new Date(),
            retries: 0,
            maxRetries: 3,
            timeoutMs: 3000,
        };
        expect(isTimedOut(request)).toBe(false);
    });

    it('should time out after timeout period', () => {
        const request: CoaRequest = {
            id: 1,
            sentAt: new Date(Date.now() - 5000), // 5 seconds ago
            retries: 0,
            maxRetries: 3,
            timeoutMs: 3000,
        };
        expect(isTimedOut(request)).toBe(true);
    });

    it('should allow retry if under max retries', () => {
        const request: CoaRequest = {
            id: 1,
            sentAt: new Date(Date.now() - 5000),
            retries: 1,
            maxRetries: 3,
            timeoutMs: 3000,
        };
        expect(shouldRetry(request)).toBe(true);
    });

    it('should not retry if max retries reached', () => {
        const request: CoaRequest = {
            id: 1,
            sentAt: new Date(Date.now() - 5000),
            retries: 3,
            maxRetries: 3,
            timeoutMs: 3000,
        };
        expect(shouldRetry(request)).toBe(false);
    });
});

// =============================================
// CoA Port Configuration Tests
// =============================================
describe('CoA Port Configuration', () => {
    interface NasCoaConfig {
        ipAddress: string;
        coaPort: number;
        secret: string;
    }

    function getCoaEndpoint(nas: NasCoaConfig): { host: string; port: number } {
        return {
            host: nas.ipAddress,
            port: nas.coaPort || 3799, // Default CoA port
        };
    }

    it('should use default CoA port 3799', () => {
        const nas: NasCoaConfig = {
            ipAddress: '192.168.1.1',
            coaPort: 0,
            secret: 'secret',
        };
        const endpoint = getCoaEndpoint(nas);
        expect(endpoint.port).toBe(3799);
    });

    it('should use custom CoA port', () => {
        const nas: NasCoaConfig = {
            ipAddress: '192.168.1.1',
            coaPort: 1700,
            secret: 'secret',
        };
        const endpoint = getCoaEndpoint(nas);
        expect(endpoint.port).toBe(1700);
    });

    it('should return correct IP address', () => {
        const nas: NasCoaConfig = {
            ipAddress: '10.0.0.1',
            coaPort: 3799,
            secret: 'secret',
        };
        const endpoint = getCoaEndpoint(nas);
        expect(endpoint.host).toBe('10.0.0.1');
    });
});

// =============================================
// CoA Error Code Tests
// =============================================
describe('CoA Error Codes', () => {
    const ErrorCause = {
        RESIDUAL_SESSION_CONTEXT_REMOVED: 201,
        INVALID_EAP_PACKET: 202,
        UNSUPPORTED_ATTRIBUTE: 401,
        MISSING_ATTRIBUTE: 402,
        NAS_IDENTIFICATION_MISMATCH: 403,
        INVALID_REQUEST: 404,
        UNSUPPORTED_SERVICE: 405,
        UNSUPPORTED_EXTENSION: 406,
        INVALID_ATTRIBUTE_VALUE: 407,
        ADMINISTRATIVELY_PROHIBITED: 501,
        REQUEST_NOT_ROUTABLE: 502,
        SESSION_CONTEXT_NOT_FOUND: 503,
        SESSION_CONTEXT_NOT_REMOVABLE: 504,
        OTHER_PROXY_PROCESSING_ERROR: 505,
        RESOURCES_UNAVAILABLE: 506,
        REQUEST_INITIATED: 507,
        MULTIPLE_SESSION_SELECTION_UNSUPPORTED: 508,
    };

    function getErrorDescription(code: number): string {
        const descriptions: Record<number, string> = {
            201: 'Session context removed',
            401: 'Unsupported attribute',
            402: 'Missing required attribute',
            403: 'NAS identification mismatch',
            404: 'Invalid request',
            501: 'Administratively prohibited',
            503: 'Session not found',
            504: 'Session cannot be removed',
            506: 'Resources unavailable',
        };
        return descriptions[code] ?? `Unknown error (${code})`;
    }

    it('should describe session not found', () => {
        expect(getErrorDescription(ErrorCause.SESSION_CONTEXT_NOT_FOUND))
            .toBe('Session not found');
    });

    it('should describe missing attribute', () => {
        expect(getErrorDescription(ErrorCause.MISSING_ATTRIBUTE))
            .toBe('Missing required attribute');
    });

    it('should describe administratively prohibited', () => {
        expect(getErrorDescription(ErrorCause.ADMINISTRATIVELY_PROHIBITED))
            .toBe('Administratively prohibited');
    });

    it('should handle unknown error code', () => {
        expect(getErrorDescription(999)).toBe('Unknown error (999)');
    });
});

// =============================================
// Response Authenticator Verification Tests
// =============================================
describe('CoA Response Authenticator', () => {
    function verifyResponseAuthenticator(
        response: Buffer,
        requestAuthenticator: Buffer,
        secret: string
    ): boolean {
        const code = response[0];
        const identifier = response[1];
        const length = response.readUInt16BE(2);
        const receivedAuth = response.slice(4, 20);
        const attributes = response.slice(20, length);

        // Calculate expected authenticator
        const header = Buffer.alloc(4);
        header[0] = code;
        header[1] = identifier;
        header.writeUInt16BE(length, 2);

        const expectedAuth = crypto.createHash('md5')
            .update(header)
            .update(requestAuthenticator)
            .update(attributes)
            .update(Buffer.from(secret))
            .digest();

        return receivedAuth.equals(expectedAuth);
    }

    it('should verify valid response authenticator', () => {
        const secret = 'sharedsecret';
        const requestAuth = crypto.randomBytes(16);

        // Build valid response
        const response = Buffer.alloc(20);
        response[0] = 41; // Disconnect-ACK
        response[1] = 5;
        response.writeUInt16BE(20, 2);

        const auth = crypto.createHash('md5')
            .update(response.slice(0, 4))
            .update(requestAuth)
            .update(Buffer.alloc(0)) // No attributes
            .update(Buffer.from(secret))
            .digest();

        auth.copy(response, 4);

        expect(verifyResponseAuthenticator(response, requestAuth, secret)).toBe(true);
    });

    it('should reject invalid response authenticator', () => {
        const response = Buffer.alloc(20);
        response[0] = 41;
        response[1] = 5;
        response.writeUInt16BE(20, 2);
        crypto.randomBytes(16).copy(response, 4); // Random auth

        const requestAuth = crypto.randomBytes(16);

        expect(verifyResponseAuthenticator(response, requestAuth, 'secret')).toBe(false);
    });
});
