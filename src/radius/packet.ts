/**
 * RADIUS Packet Parser and Encoder
 * RFC 2865 (RADIUS Authentication) + RFC 2866 (RADIUS Accounting)
 * 
 * Packet Format:
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |     Code      |  Identifier   |            Length             |
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |                                                               |
 * |                     Request Authenticator                     |
 * |                         (16 bytes)                            |
 * |                                                               |
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |  Attributes ...
 * +-+-+-+-+-+-+-+-+-+-+-+-+-
 */

import { createHash, createHmac, randomBytes } from 'crypto';
import {
    RadiusCode,
    RadiusAttributeType,
    ATTRIBUTE_DICTIONARY,
    MIKROTIK_VENDOR_ID,
    MIKROTIK_DICTIONARY,
    type AttributeDefinition,
} from './dictionary.js';

// Parsed RADIUS Attribute
export interface RadiusAttribute {
    type: number;
    name: string;
    value: string | number | Buffer;
    raw: Buffer;
    vendorId?: number;
    vendorType?: number;
}

// Parsed RADIUS Packet
export interface RadiusPacket {
    code: RadiusCode;
    identifier: number;
    length: number;
    authenticator: Buffer;
    attributes: RadiusAttribute[];
    raw: Buffer;
}

// Attribute builder for responses
export interface AttributeBuilder {
    type: number;
    value: string | number | Buffer;
    vendorId?: number;
    vendorType?: number;
}

/**
 * Parse a raw RADIUS packet buffer into structured data
 */
export function parsePacket(buffer: Buffer): RadiusPacket {
    if (buffer.length < 20) {
        throw new Error('RADIUS packet too short (minimum 20 bytes)');
    }

    const code = buffer.readUInt8(0) as RadiusCode;
    const identifier = buffer.readUInt8(1);
    const length = buffer.readUInt16BE(2);
    const authenticator = buffer.subarray(4, 20);

    if (buffer.length < length) {
        throw new Error(`RADIUS packet truncated: expected ${length} bytes, got ${buffer.length}`);
    }

    const attributes = parseAttributes(buffer.subarray(20, length));

    return {
        code,
        identifier,
        length,
        authenticator,
        attributes,
        raw: buffer.subarray(0, length),
    };
}

/**
 * Parse attributes section of RADIUS packet
 */
function parseAttributes(buffer: Buffer): RadiusAttribute[] {
    const attributes: RadiusAttribute[] = [];
    let offset = 0;

    while (offset < buffer.length) {
        if (offset + 2 > buffer.length) break;

        const type = buffer.readUInt8(offset);
        const attrLength = buffer.readUInt8(offset + 1);

        if (attrLength < 2 || offset + attrLength > buffer.length) {
            break;
        }

        const valueBuffer = buffer.subarray(offset + 2, offset + attrLength);

        // Handle Vendor-Specific Attributes (VSA)
        if (type === RadiusAttributeType.VENDOR_SPECIFIC && valueBuffer.length >= 6) {
            const vendorId = valueBuffer.readUInt32BE(0);
            const vendorType = valueBuffer.readUInt8(4);
            const vendorLength = valueBuffer.readUInt8(5);
            const vendorValue = valueBuffer.subarray(6, 4 + vendorLength);

            // Parse MikroTik VSAs
            if (vendorId === MIKROTIK_VENDOR_ID) {
                const vsaDef = MIKROTIK_DICTIONARY.get(vendorType);
                attributes.push({
                    type: vendorType,
                    name: vsaDef?.name || `Vendor-${vendorId}-Attr-${vendorType}`,
                    value: decodeAttributeValue(vendorValue, vsaDef?.dataType || 'octets'),
                    raw: vendorValue,
                    vendorId,
                    vendorType,
                });
            } else {
                // Other vendor VSAs
                attributes.push({
                    type,
                    name: `Vendor-${vendorId}-Attr-${vendorType}`,
                    value: vendorValue,
                    raw: valueBuffer,
                    vendorId,
                    vendorType,
                });
            }
        } else {
            // Standard attribute
            const def = ATTRIBUTE_DICTIONARY.get(type);
            attributes.push({
                type,
                name: def?.name || `Attribute-${type}`,
                value: decodeAttributeValue(valueBuffer, def?.dataType || 'octets'),
                raw: valueBuffer,
            });
        }

        offset += attrLength;
    }

    return attributes;
}

/**
 * Decode attribute value based on data type
 */
function decodeAttributeValue(buffer: Buffer, dataType: string): string | number | Buffer {
    switch (dataType) {
        case 'string':
            return buffer.toString('utf8');
        case 'integer':
            return buffer.length === 4 ? buffer.readUInt32BE(0) : buffer.readUInt16BE(0);
        case 'ipaddr':
            return Array.from(buffer).join('.');
        case 'date':
            return buffer.readUInt32BE(0);
        case 'octets':
        default:
            return buffer;
    }
}

/**
 * Encode an attribute value to buffer
 */
function encodeAttributeValue(value: string | number | Buffer, dataType: string): Buffer {
    switch (dataType) {
        case 'string':
            return Buffer.from(value as string, 'utf8');
        case 'integer': {
            const buf = Buffer.alloc(4);
            buf.writeUInt32BE(value as number);
            return buf;
        }
        case 'ipaddr': {
            const parts = (value as string).split('.').map(Number);
            return Buffer.from(parts);
        }
        case 'date': {
            const buf = Buffer.alloc(4);
            buf.writeUInt32BE(value as number);
            return buf;
        }
        case 'octets':
        default:
            return Buffer.isBuffer(value) ? value : Buffer.from(value as string);
    }
}

/**
 * Encode attributes to buffer
 */
export function encodeAttributes(attributes: AttributeBuilder[]): Buffer {
    const buffers: Buffer[] = [];

    for (const attr of attributes) {
        if (attr.vendorId !== undefined && attr.vendorType !== undefined) {
            // Vendor-Specific Attribute
            const vsaDef = MIKROTIK_DICTIONARY.get(attr.vendorType);
            const valueBuffer = encodeAttributeValue(attr.value, vsaDef?.dataType || 'octets');

            // VSA format: Type(1) + Length(1) + VendorId(4) + VendorType(1) + VendorLength(1) + Value
            const vsaBuffer = Buffer.alloc(8 + valueBuffer.length);
            vsaBuffer.writeUInt8(RadiusAttributeType.VENDOR_SPECIFIC, 0);
            vsaBuffer.writeUInt8(8 + valueBuffer.length, 1);
            vsaBuffer.writeUInt32BE(attr.vendorId, 2);
            vsaBuffer.writeUInt8(attr.vendorType, 6);
            vsaBuffer.writeUInt8(2 + valueBuffer.length, 7);
            valueBuffer.copy(vsaBuffer, 8);
            buffers.push(vsaBuffer);
        } else {
            // Standard attribute
            const def = ATTRIBUTE_DICTIONARY.get(attr.type);
            const valueBuffer = encodeAttributeValue(attr.value, def?.dataType || 'octets');

            // Attribute format: Type(1) + Length(1) + Value
            const attrBuffer = Buffer.alloc(2 + valueBuffer.length);
            attrBuffer.writeUInt8(attr.type, 0);
            attrBuffer.writeUInt8(2 + valueBuffer.length, 1);
            valueBuffer.copy(attrBuffer, 2);
            buffers.push(attrBuffer);
        }
    }

    return Buffer.concat(buffers);
}

/**
 * Create a RADIUS response packet
 */
export function createResponse(
    code: RadiusCode,
    identifier: number,
    requestAuthenticator: Buffer,
    attributes: AttributeBuilder[],
    secret: string
): Buffer {
    const attributeBuffer = encodeAttributes(attributes);
    const length = 20 + attributeBuffer.length;

    // Build packet without authenticator first
    const packet = Buffer.alloc(length);
    packet.writeUInt8(code, 0);
    packet.writeUInt8(identifier, 1);
    packet.writeUInt16BE(length, 2);

    // For responses, authenticator is calculated
    requestAuthenticator.copy(packet, 4);
    attributeBuffer.copy(packet, 20);

    // Calculate Response Authenticator
    // ResponseAuth = MD5(Code + ID + Length + RequestAuth + Attributes + Secret)
    const hash = createHash('md5');
    hash.update(packet);
    hash.update(Buffer.from(secret));
    const responseAuth = hash.digest();
    responseAuth.copy(packet, 4);

    return packet;
}

/**
 * Create a CoA/Disconnect Request packet
 */
export function createRequest(
    code: RadiusCode,
    identifier: number,
    attributes: AttributeBuilder[],
    secret: string
): Buffer {
    const attributeBuffer = encodeAttributes(attributes);
    const length = 20 + attributeBuffer.length;

    const packet = Buffer.alloc(length);
    packet.writeUInt8(code, 0);
    packet.writeUInt8(identifier, 1);
    packet.writeUInt16BE(length, 2);

    // Generate random authenticator for requests
    const randomAuth = randomBytes(16);
    randomAuth.copy(packet, 4);
    attributeBuffer.copy(packet, 20);

    // For Access-Request and Status-Server, Authenticator is random (already set)
    // For Accounting-Request, CoA-Request, Disconnect-Request, it must be the MD5 hash
    if (code !== RadiusCode.ACCESS_REQUEST && code !== RadiusCode.STATUS_SERVER) {
        // Calculate Request Authenticator
        // RequestAuth = MD5(Code + ID + Length + 16 zero octets + Attributes + Secret)
        const hashInput = Buffer.alloc(length);
        packet.copy(hashInput);
        Buffer.alloc(16).copy(hashInput, 4); // Zero out authenticator position

        const hash = createHash('md5');
        hash.update(hashInput);
        hash.update(Buffer.from(secret));
        const requestAuth = hash.digest();
        requestAuth.copy(packet, 4);
    }

    return packet;
}

/**
 * Verify request authenticator for Access-Request
 * If Message-Authenticator (Type 80) is present, it MUST be verified.
 */
export function verifyRequestAuthenticator(packet: RadiusPacket, secret: string): boolean {
    const msgAuth = getAttribute(packet, RadiusAttributeType.MESSAGE_AUTHENTICATOR);

    // If Message-Authenticator attribute exists, verify HMAC-MD5
    if (msgAuth) {
        return verifyMessageAuthenticator(packet, secret);
    }

    // Otherwise, we accept it (Access-Request authenticator is mostly random/unverifiable 
    // without Message-Authenticator, though servers *use* it to encrypt the response)
    return true;
}

/**
 * Verify Message-Authenticator (Type 80)
 * Calculated as HMAC-MD5 of the entire packet with the Message-Authenticator field zeroed
 */
export function verifyMessageAuthenticator(packet: RadiusPacket, secret: string): boolean {
    const msgAuthAttr = getAttribute(packet, RadiusAttributeType.MESSAGE_AUTHENTICATOR);
    if (!msgAuthAttr || !Buffer.isBuffer(msgAuthAttr.value)) return false;

    const receivedHmac = msgAuthAttr.value;

    // Create a copy of the packet raw buffer to zero out the Message-Authenticator value
    // We need to find where the Message-Authenticator value is in the raw buffer
    // Type(1) + Length(1) + Value(16)
    // We scan the attributes to find the offset
    const calcBuffer = Buffer.from(packet.raw);

    // Re-locate the attribute in the raw buffer to zero it out
    // Since we parsed it, we know it exists. We need to find its offset.
    // The simplest way is to re-construct the packet for calculation if we trust our encode,
    // but better to use the raw buffer and zero out the specific bytes.
    // However, finding the specific offset in `raw` can be tricky if there are multiple similar attributes.
    // RFC says: "calculated over the stream ... with the Message-Authenticator Attribute value field set to zero"

    // Let's iterate attributes in the raw buffer again to find the offset
    let offset = 20; // Skip header
    while (offset < calcBuffer.length) {
        const type = calcBuffer.readUInt8(offset);
        const len = calcBuffer.readUInt8(offset + 1);

        if (type === RadiusAttributeType.MESSAGE_AUTHENTICATOR) {
            // Zero out the 16-byte value (offset + 2)
            calcBuffer.fill(0, offset + 2, offset + len);
            break;
        }
        offset += len;
    }

    const hmac = createHmac('md5', secret);
    hmac.update(calcBuffer);
    const expectedHmac = hmac.digest();

    return expectedHmac.equals(receivedHmac);
}

/**
 * Verify accounting request authenticator
 */
export function verifyAccountingAuthenticator(packet: RadiusPacket, secret: string): boolean {
    // First, if Message-Authenticator is present, it MUST be valid
    const msgAuth = getAttribute(packet, RadiusAttributeType.MESSAGE_AUTHENTICATOR);
    if (msgAuth && !verifyMessageAuthenticator(packet, secret)) {
        return false;
    }

    // Then verify the Accounting-Request Authenticator
    // Authenticator = MD5(Code + ID + Length + 16 zero octets + Attributes + Secret)
    const testPacket = Buffer.from(packet.raw);
    Buffer.alloc(16).copy(testPacket, 4); // Zero out authenticator

    const hash = createHash('md5');
    hash.update(testPacket);
    hash.update(Buffer.from(secret));
    const expectedAuth = hash.digest();

    return expectedAuth.equals(packet.authenticator);
}

/**
 * Decrypt User-Password (PAP)
 * Password is XOR'd with MD5(secret + authenticator) in 16-byte chunks
 */
export function decryptPassword(encryptedPassword: Buffer, authenticator: Buffer, secret: string): string {
    const result: number[] = [];
    const secretBuffer = Buffer.from(secret);
    let prev = authenticator;

    for (let i = 0; i < encryptedPassword.length; i += 16) {
        const hash = createHash('md5');
        hash.update(secretBuffer);
        hash.update(prev);
        const key = hash.digest();

        const chunk = encryptedPassword.subarray(i, Math.min(i + 16, encryptedPassword.length));
        for (let j = 0; j < chunk.length; j++) {
            result.push(chunk[j] ^ key[j]);
        }

        prev = chunk.length === 16 ? chunk : Buffer.concat([chunk, Buffer.alloc(16 - chunk.length)]);
    }

    // Remove padding (null bytes)
    const decoded = Buffer.from(result);
    const nullIndex = decoded.indexOf(0);
    return decoded.subarray(0, nullIndex === -1 ? decoded.length : nullIndex).toString('utf8');
}

/**
 * Verify CHAP password
 * CHAP-Password = CHAP-Id + MD5(CHAP-Id + Password + Challenge)
 */
export function verifyChapPassword(
    chapPassword: Buffer,
    chapChallenge: Buffer,
    expectedPassword: string
): boolean {
    if (chapPassword.length < 17) return false;

    const chapId = chapPassword.subarray(0, 1);
    const receivedHash = chapPassword.subarray(1, 17);

    const hash = createHash('md5');
    hash.update(chapId);
    hash.update(Buffer.from(expectedPassword));
    hash.update(chapChallenge);
    const expectedHash = hash.digest();

    return receivedHash.equals(expectedHash);
}

/**
 * Get a specific attribute from parsed packet
 */
export function getAttribute(packet: RadiusPacket, type: number): RadiusAttribute | undefined {
    return packet.attributes.find(attr => attr.type === type && !attr.vendorId);
}

/**
 * Get a MikroTik VSA from parsed packet
 */
export function getMikroTikAttribute(packet: RadiusPacket, type: number): RadiusAttribute | undefined {
    return packet.attributes.find(attr => attr.vendorId === MIKROTIK_VENDOR_ID && attr.vendorType === type);
}

/**
 * Get attribute value as string
 */
export function getAttributeString(packet: RadiusPacket, type: number): string | undefined {
    const attr = getAttribute(packet, type);
    if (!attr) return undefined;
    return typeof attr.value === 'string' ? attr.value : attr.value.toString();
}

/**
 * Get attribute value as number
 */
export function getAttributeNumber(packet: RadiusPacket, type: number): number | undefined {
    const attr = getAttribute(packet, type);
    if (!attr) return undefined;
    return typeof attr.value === 'number' ? attr.value : parseInt(attr.value.toString());
}
