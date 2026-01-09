/**
 * RADIUS Packet Tests
 * Tests for packet parsing, encoding, encryption, and authenticator verification
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// =============================================
// RADIUS Packet Parsing Tests
// =============================================
describe('RADIUS Packet Parsing', () => {
    // RADIUS packet structure:
    // [Code (1)] [Identifier (1)] [Length (2)] [Authenticator (16)] [Attributes (...)]

    function createMockPacket(
        code: number,
        identifier: number,
        authenticator: Buffer,
        attributes: Buffer = Buffer.alloc(0)
    ): Buffer {
        const length = 20 + attributes.length;
        const packet = Buffer.alloc(length);
        packet[0] = code;
        packet[1] = identifier;
        packet.writeUInt16BE(length, 2);
        authenticator.copy(packet, 4);
        attributes.copy(packet, 20);
        return packet;
    }

    describe('Header Parsing', () => {
        it('should parse Access-Request code (1)', () => {
            const authenticator = crypto.randomBytes(16);
            const packet = createMockPacket(1, 42, authenticator);

            expect(packet[0]).toBe(1); // Access-Request
            expect(packet[1]).toBe(42); // Identifier
            expect(packet.readUInt16BE(2)).toBe(20); // Length
        });

        it('should parse Access-Accept code (2)', () => {
            const authenticator = crypto.randomBytes(16);
            const packet = createMockPacket(2, 100, authenticator);

            expect(packet[0]).toBe(2); // Access-Accept
        });

        it('should parse Access-Reject code (3)', () => {
            const authenticator = crypto.randomBytes(16);
            const packet = createMockPacket(3, 50, authenticator);

            expect(packet[0]).toBe(3); // Access-Reject
        });

        it('should parse Accounting-Request code (4)', () => {
            const authenticator = crypto.randomBytes(16);
            const packet = createMockPacket(4, 1, authenticator);

            expect(packet[0]).toBe(4); // Accounting-Request
        });

        it('should correctly read 16-byte authenticator', () => {
            const authenticator = Buffer.from('0123456789abcdef');
            const packet = createMockPacket(1, 1, authenticator);

            const extracted = packet.slice(4, 20);
            expect(extracted.equals(authenticator)).toBe(true);
        });
    });

    describe('Attribute Parsing', () => {
        function createAttributeBuffer(type: number, value: Buffer): Buffer {
            const attr = Buffer.alloc(2 + value.length);
            attr[0] = type;
            attr[1] = 2 + value.length;
            value.copy(attr, 2);
            return attr;
        }

        it('should parse User-Name attribute (type 1)', () => {
            const username = Buffer.from('testuser');
            const attr = createAttributeBuffer(1, username);

            expect(attr[0]).toBe(1); // User-Name type
            expect(attr[1]).toBe(10); // 2 + 8 = 10 bytes
            expect(attr.slice(2).toString()).toBe('testuser');
        });

        it('should parse NAS-IP-Address attribute (type 4)', () => {
            const ip = Buffer.from([192, 168, 1, 1]);
            const attr = createAttributeBuffer(4, ip);

            expect(attr[0]).toBe(4); // NAS-IP-Address type
            expect(attr.slice(2).toString('hex')).toBe('c0a80101');
        });

        it('should parse Service-Type attribute (type 6)', () => {
            const serviceType = Buffer.alloc(4);
            serviceType.writeUInt32BE(2); // Framed
            const attr = createAttributeBuffer(6, serviceType);

            expect(attr[0]).toBe(6);
            expect(attr.slice(2).readUInt32BE()).toBe(2);
        });

        it('should parse Acct-Status-Type attribute (type 40)', () => {
            const statusType = Buffer.alloc(4);
            statusType.writeUInt32BE(1); // Start
            const attr = createAttributeBuffer(40, statusType);

            expect(attr[0]).toBe(40);
            expect(attr.slice(2).readUInt32BE()).toBe(1);
        });

        it('should parse multiple attributes', () => {
            const username = createAttributeBuffer(1, Buffer.from('user1'));
            const password = createAttributeBuffer(2, Buffer.from('pass'));
            const combined = Buffer.concat([username, password]);

            // First attribute
            expect(combined[0]).toBe(1);
            expect(combined[1]).toBe(7); // 2 + 5

            // Second attribute starts after first
            expect(combined[7]).toBe(2);
            expect(combined[8]).toBe(6); // 2 + 4
        });
    });
});

// =============================================
// PAP Password Encryption/Decryption Tests
// =============================================
describe('PAP Password Encryption', () => {
    function encryptPapPassword(password: string, authenticator: Buffer, secret: string): Buffer {
        const paddedLength = Math.ceil(password.length / 16) * 16;
        const padded = Buffer.alloc(paddedLength);
        Buffer.from(password).copy(padded);

        const encrypted = Buffer.alloc(paddedLength);
        let lastBlock = authenticator;

        for (let i = 0; i < paddedLength; i += 16) {
            const hash = crypto.createHash('md5')
                .update(Buffer.from(secret))
                .update(lastBlock)
                .digest();

            for (let j = 0; j < 16 && i + j < paddedLength; j++) {
                encrypted[i + j] = padded[i + j] ^ hash[j];
            }
            lastBlock = encrypted.slice(i, i + 16);
        }

        return encrypted;
    }

    function decryptPapPassword(encrypted: Buffer, authenticator: Buffer, secret: string): string {
        const decrypted = Buffer.alloc(encrypted.length);
        let lastBlock = authenticator;

        for (let i = 0; i < encrypted.length; i += 16) {
            const hash = crypto.createHash('md5')
                .update(Buffer.from(secret))
                .update(lastBlock)
                .digest();

            for (let j = 0; j < 16 && i + j < encrypted.length; j++) {
                decrypted[i + j] = encrypted[i + j] ^ hash[j];
            }
            lastBlock = encrypted.slice(i, i + 16);
        }

        // Remove null padding
        let end = decrypted.length;
        while (end > 0 && decrypted[end - 1] === 0) end--;
        return decrypted.slice(0, end).toString();
    }

    it('should encrypt and decrypt short password', () => {
        const password = 'secret123';
        const authenticator = crypto.randomBytes(16);
        const secret = 'radiussecret';

        const encrypted = encryptPapPassword(password, authenticator, secret);
        const decrypted = decryptPapPassword(encrypted, authenticator, secret);

        expect(decrypted).toBe(password);
    });

    it('should encrypt and decrypt password longer than 16 chars', () => {
        const password = 'thisisaverylongpassword12345';
        const authenticator = crypto.randomBytes(16);
        const secret = 'sharedsecret';

        const encrypted = encryptPapPassword(password, authenticator, secret);
        const decrypted = decryptPapPassword(encrypted, authenticator, secret);

        expect(decrypted).toBe(password);
    });

    it('should handle exactly 16 character password', () => {
        const password = '1234567890123456';
        const authenticator = crypto.randomBytes(16);
        const secret = 'mysecret';

        const encrypted = encryptPapPassword(password, authenticator, secret);
        const decrypted = decryptPapPassword(encrypted, authenticator, secret);

        expect(decrypted).toBe(password);
    });

    it('should produce different ciphertext with different authenticator', () => {
        const password = 'testpass';
        const authenticator1 = crypto.randomBytes(16);
        const authenticator2 = crypto.randomBytes(16);
        const secret = 'sharedsecret';

        const encrypted1 = encryptPapPassword(password, authenticator1, secret);
        const encrypted2 = encryptPapPassword(password, authenticator2, secret);

        expect(encrypted1.equals(encrypted2)).toBe(false);
    });

    it('should fail decryption with wrong secret', () => {
        const password = 'mypassword';
        const authenticator = crypto.randomBytes(16);

        const encrypted = encryptPapPassword(password, authenticator, 'correctsecret');
        const decrypted = decryptPapPassword(encrypted, authenticator, 'wrongsecret');

        expect(decrypted).not.toBe(password);
    });
});

// =============================================
// CHAP Authentication Tests
// =============================================
describe('CHAP Authentication', () => {
    function verifyChap(
        chapId: number,
        challenge: Buffer,
        response: Buffer,
        password: string
    ): boolean {
        const expected = crypto.createHash('md5')
            .update(Buffer.from([chapId]))
            .update(Buffer.from(password))
            .update(challenge)
            .digest();

        return expected.equals(response);
    }

    it('should verify correct CHAP response', () => {
        const chapId = 1;
        const challenge = crypto.randomBytes(16);
        const password = 'userpassword';

        // Generate correct response
        const response = crypto.createHash('md5')
            .update(Buffer.from([chapId]))
            .update(Buffer.from(password))
            .update(challenge)
            .digest();

        expect(verifyChap(chapId, challenge, response, password)).toBe(true);
    });

    it('should reject wrong password', () => {
        const chapId = 1;
        const challenge = crypto.randomBytes(16);

        const response = crypto.createHash('md5')
            .update(Buffer.from([chapId]))
            .update(Buffer.from('correctpassword'))
            .update(challenge)
            .digest();

        expect(verifyChap(chapId, challenge, response, 'wrongpassword')).toBe(false);
    });

    it('should reject wrong CHAP ID', () => {
        const challenge = crypto.randomBytes(16);
        const password = 'test123';

        const responseWithId1 = crypto.createHash('md5')
            .update(Buffer.from([1]))
            .update(Buffer.from(password))
            .update(challenge)
            .digest();

        // Verify with different ID should fail
        expect(verifyChap(2, challenge, responseWithId1, password)).toBe(false);
    });

    it('should reject tampered challenge', () => {
        const chapId = 1;
        const challenge1 = crypto.randomBytes(16);
        const challenge2 = crypto.randomBytes(16);
        const password = 'test123';

        const response = crypto.createHash('md5')
            .update(Buffer.from([chapId]))
            .update(Buffer.from(password))
            .update(challenge1)
            .digest();

        expect(verifyChap(chapId, challenge2, response, password)).toBe(false);
    });
});

// =============================================
// Response Authenticator Tests
// =============================================
describe('Response Authenticator', () => {
    function calculateResponseAuthenticator(
        code: number,
        identifier: number,
        requestAuthenticator: Buffer,
        attributes: Buffer,
        secret: string
    ): Buffer {
        const length = 20 + attributes.length;
        const header = Buffer.alloc(4);
        header[0] = code;
        header[1] = identifier;
        header.writeUInt16BE(length, 2);

        return crypto.createHash('md5')
            .update(header)
            .update(requestAuthenticator)
            .update(attributes)
            .update(Buffer.from(secret))
            .digest();
    }

    it('should calculate Access-Accept authenticator', () => {
        const requestAuth = crypto.randomBytes(16);
        const attributes = Buffer.from([6, 6, 0, 0, 0, 2]); // Service-Type = Framed
        const secret = 'testsecret';

        const responseAuth = calculateResponseAuthenticator(
            2, // Access-Accept
            1,
            requestAuth,
            attributes,
            secret
        );

        expect(responseAuth).toHaveLength(16);
    });

    it('should produce different authenticator with different secret', () => {
        const requestAuth = crypto.randomBytes(16);
        const attributes = Buffer.alloc(0);

        const auth1 = calculateResponseAuthenticator(2, 1, requestAuth, attributes, 'secret1');
        const auth2 = calculateResponseAuthenticator(2, 1, requestAuth, attributes, 'secret2');

        expect(auth1.equals(auth2)).toBe(false);
    });

    it('should verify response authenticator', () => {
        const requestAuth = crypto.randomBytes(16);
        const attributes = Buffer.from([6, 6, 0, 0, 0, 2]);
        const secret = 'sharedsecret';

        const expectedAuth = calculateResponseAuthenticator(2, 5, requestAuth, attributes, secret);

        // Build complete response packet
        const response = Buffer.alloc(20 + attributes.length);
        response[0] = 2;
        response[1] = 5;
        response.writeUInt16BE(20 + attributes.length, 2);
        expectedAuth.copy(response, 4);
        attributes.copy(response, 20);

        // Verify by recalculating
        const calculatedAuth = calculateResponseAuthenticator(
            response[0],
            response[1],
            requestAuth,
            response.slice(20),
            secret
        );

        expect(calculatedAuth.equals(expectedAuth)).toBe(true);
    });
});

// =============================================
// Accounting Authenticator Tests
// =============================================
describe('Accounting Request Authenticator', () => {
    function calculateAccountingAuthenticator(
        code: number,
        identifier: number,
        attributes: Buffer,
        secret: string
    ): Buffer {
        const length = 20 + attributes.length;
        const header = Buffer.alloc(4);
        header[0] = code;
        header[1] = identifier;
        header.writeUInt16BE(length, 2);

        return crypto.createHash('md5')
            .update(header)
            .update(Buffer.alloc(16, 0)) // 16 zeros for accounting request
            .update(attributes)
            .update(Buffer.from(secret))
            .digest();
    }

    function verifyAccountingAuthenticator(
        packet: Buffer,
        secret: string
    ): boolean {
        const code = packet[0];
        const identifier = packet[1];
        const length = packet.readUInt16BE(2);
        const authenticator = packet.slice(4, 20);
        const attributes = packet.slice(20, length);

        const calculated = calculateAccountingAuthenticator(code, identifier, attributes, secret);
        return calculated.equals(authenticator);
    }

    it('should calculate Accounting-Request authenticator', () => {
        const attributes = Buffer.from([40, 6, 0, 0, 0, 1]); // Acct-Status-Type = Start
        const secret = 'acctsecret';

        const auth = calculateAccountingAuthenticator(4, 1, attributes, secret);
        expect(auth).toHaveLength(16);
    });

    it('should verify valid Accounting-Request', () => {
        const attributes = Buffer.from([40, 6, 0, 0, 0, 1]);
        const secret = 'testsecret';

        const auth = calculateAccountingAuthenticator(4, 1, attributes, secret);

        // Build packet
        const packet = Buffer.alloc(20 + attributes.length);
        packet[0] = 4;
        packet[1] = 1;
        packet.writeUInt16BE(20 + attributes.length, 2);
        auth.copy(packet, 4);
        attributes.copy(packet, 20);

        expect(verifyAccountingAuthenticator(packet, secret)).toBe(true);
    });

    it('should reject invalid Accounting-Request', () => {
        const attributes = Buffer.from([40, 6, 0, 0, 0, 1]);
        const correctSecret = 'correctsecret';
        const wrongSecret = 'wrongsecret';

        const auth = calculateAccountingAuthenticator(4, 1, attributes, correctSecret);

        // Build packet
        const packet = Buffer.alloc(20 + attributes.length);
        packet[0] = 4;
        packet[1] = 1;
        packet.writeUInt16BE(20 + attributes.length, 2);
        auth.copy(packet, 4);
        attributes.copy(packet, 20);

        expect(verifyAccountingAuthenticator(packet, wrongSecret)).toBe(false);
    });
});

// =============================================
// Message-Authenticator (HMAC-MD5) Tests
// =============================================
describe('Message-Authenticator', () => {
    const MESSAGE_AUTHENTICATOR_TYPE = 80;

    function calculateMessageAuthenticator(
        packet: Buffer,
        secret: string
    ): Buffer {
        // Create a copy with Message-Authenticator set to zeros
        const packetCopy = Buffer.from(packet);

        // Find Message-Authenticator attribute and zero it
        let offset = 20;
        while (offset < packetCopy.length) {
            const type = packetCopy[offset];
            const length = packetCopy[offset + 1];

            if (type === MESSAGE_AUTHENTICATOR_TYPE) {
                // Zero out the 16-byte value
                Buffer.alloc(16, 0).copy(packetCopy, offset + 2);
            }

            offset += length;
        }

        return crypto.createHmac('md5', Buffer.from(secret))
            .update(packetCopy)
            .digest();
    }

    it('should calculate Message-Authenticator HMAC', () => {
        const packet = Buffer.alloc(38); // 20 header + 18 Message-Auth attribute
        packet[0] = 1; // Access-Request
        packet[1] = 1;
        packet.writeUInt16BE(38, 2);
        crypto.randomBytes(16).copy(packet, 4);
        packet[20] = MESSAGE_AUTHENTICATOR_TYPE;
        packet[21] = 18; // 2 + 16
        // Value will be zeros initially

        const secret = 'radiussecret';
        const hmac = calculateMessageAuthenticator(packet, secret);

        expect(hmac).toHaveLength(16);
    });

    it('should verify valid Message-Authenticator', () => {
        const secret = 'testsecret';

        // Build packet with placeholder
        const packet = Buffer.alloc(38);
        packet[0] = 1;
        packet[1] = 5;
        packet.writeUInt16BE(38, 2);
        crypto.randomBytes(16).copy(packet, 4);
        packet[20] = MESSAGE_AUTHENTICATOR_TYPE;
        packet[21] = 18;

        // Calculate and insert
        const hmac = calculateMessageAuthenticator(packet, secret);
        hmac.copy(packet, 22);

        // Verify
        const recalculated = calculateMessageAuthenticator(packet, secret);
        expect(recalculated.equals(hmac)).toBe(true);
    });
});
