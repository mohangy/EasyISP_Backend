/**
 * RADIUS Event Logger
 * Tracks all RADIUS events for analytics, debugging, and auditing
 */

import { logger } from '../lib/logger.js';

// RADIUS event types
export type RadiusEventType =
    | 'ACCESS_REQUEST'
    | 'ACCESS_ACCEPT'
    | 'ACCESS_REJECT'
    | 'ACCT_START'
    | 'ACCT_UPDATE'
    | 'ACCT_STOP'
    | 'ACCT_ON'
    | 'ACCT_OFF'
    | 'COA_DISCONNECT'
    | 'COA_SPEED_CHANGE'
    | 'COA_ACK'
    | 'COA_NAK';

export type RadiusEventResult = 'SUCCESS' | 'FAILURE' | 'TIMEOUT' | 'RATE_LIMITED';

export interface RadiusEvent {
    type: RadiusEventType;
    username?: string;
    nasIp: string;
    nasId?: string;
    framedIp?: string;
    macAddress?: string;
    sessionId?: string;
    result: RadiusEventResult;
    reason?: string;
    processingTimeMs: number;
    tenantId?: string;
    packetId?: number;
    bytesIn?: bigint;
    bytesOut?: bigint;
}

// Statistics interface
export interface RadiusStats {
    startTime: Date;
    authRequests: number;
    authAccepts: number;
    authRejects: number;
    authTimeouts: number;
    authRateLimited: number;
    acctStarts: number;
    acctUpdates: number;
    acctStops: number;
    coaDisconnects: number;
    coaSpeedChanges: number;
    coaAcks: number;
    coaNaks: number;
    totalProcessingTimeMs: number;
    avgProcessingTimeMs: number;
    bytesTransferredIn: bigint;
    bytesTransferredOut: bigint;
    activeSessions: number;
    nasCacheHits: number;
    nasCacheMisses: number;
    rateLimitHits: number;
    lastEventTime: Date | null;
}

// In-memory event buffer for recent events (circular buffer)
const MAX_EVENTS = 1000;

class RadiusEventLogger {
    private events: RadiusEvent[] = [];
    private eventIndex: number = 0;
    private stats: RadiusStats;

    constructor() {
        this.stats = this.createEmptyStats();
    }

    private createEmptyStats(): RadiusStats {
        return {
            startTime: new Date(),
            authRequests: 0,
            authAccepts: 0,
            authRejects: 0,
            authTimeouts: 0,
            authRateLimited: 0,
            acctStarts: 0,
            acctUpdates: 0,
            acctStops: 0,
            coaDisconnects: 0,
            coaSpeedChanges: 0,
            coaAcks: 0,
            coaNaks: 0,
            totalProcessingTimeMs: 0,
            avgProcessingTimeMs: 0,
            bytesTransferredIn: BigInt(0),
            bytesTransferredOut: BigInt(0),
            activeSessions: 0,
            nasCacheHits: 0,
            nasCacheMisses: 0,
            rateLimitHits: 0,
            lastEventTime: null,
        };
    }

    /**
     * Log a RADIUS event
     */
    logEvent(event: RadiusEvent): void {
        // Add to circular buffer
        this.events[this.eventIndex] = event;
        this.eventIndex = (this.eventIndex + 1) % MAX_EVENTS;

        // Update statistics
        this.updateStats(event);

        // Log to structured logger
        logger.info({
            radiusEvent: true,
            type: event.type,
            username: event.username,
            nasIp: event.nasIp,
            result: event.result,
            reason: event.reason,
            processingTimeMs: event.processingTimeMs,
            tenantId: event.tenantId,
        }, `RADIUS ${event.type}: ${event.result}`);
    }

    /**
     * Update statistics based on event
     */
    private updateStats(event: RadiusEvent): void {
        this.stats.lastEventTime = new Date();
        this.stats.totalProcessingTimeMs += event.processingTimeMs;

        switch (event.type) {
            case 'ACCESS_REQUEST':
                this.stats.authRequests++;
                break;
            case 'ACCESS_ACCEPT':
                this.stats.authAccepts++;
                break;
            case 'ACCESS_REJECT':
                this.stats.authRejects++;
                break;
            case 'ACCT_START':
                this.stats.acctStarts++;
                this.stats.activeSessions++;
                break;
            case 'ACCT_UPDATE':
                this.stats.acctUpdates++;
                if (event.bytesIn) this.stats.bytesTransferredIn += event.bytesIn;
                if (event.bytesOut) this.stats.bytesTransferredOut += event.bytesOut;
                break;
            case 'ACCT_STOP':
                this.stats.acctStops++;
                this.stats.activeSessions = Math.max(0, this.stats.activeSessions - 1);
                if (event.bytesIn) this.stats.bytesTransferredIn += event.bytesIn;
                if (event.bytesOut) this.stats.bytesTransferredOut += event.bytesOut;
                break;
            case 'COA_DISCONNECT':
                this.stats.coaDisconnects++;
                break;
            case 'COA_SPEED_CHANGE':
                this.stats.coaSpeedChanges++;
                break;
            case 'COA_ACK':
                this.stats.coaAcks++;
                break;
            case 'COA_NAK':
                this.stats.coaNaks++;
                break;
        }

        if (event.result === 'RATE_LIMITED') {
            this.stats.rateLimitHits++;
            this.stats.authRateLimited++;
        }

        // Calculate average processing time
        const totalEvents = this.stats.authRequests + this.stats.acctStarts +
            this.stats.acctUpdates + this.stats.acctStops;
        if (totalEvents > 0) {
            this.stats.avgProcessingTimeMs = this.stats.totalProcessingTimeMs / totalEvents;
        }
    }

    /**
     * Record a NAS cache hit
     */
    recordCacheHit(): void {
        this.stats.nasCacheHits++;
    }

    /**
     * Record a NAS cache miss
     */
    recordCacheMiss(): void {
        this.stats.nasCacheMisses++;
    }

    /**
     * Get current statistics
     */
    getStats(): RadiusStats {
        return { ...this.stats };
    }

    /**
     * Get recent events (most recent first)
     */
    getRecentEvents(count: number = 100): RadiusEvent[] {
        const result: RadiusEvent[] = [];
        let index = this.eventIndex - 1;

        for (let i = 0; i < Math.min(count, this.events.length); i++) {
            if (index < 0) index = this.events.length - 1;
            if (this.events[index]) {
                result.push(this.events[index]);
            }
            index--;
        }

        return result;
    }

    /**
     * Get events filtered by criteria
     */
    getFilteredEvents(filter: Partial<RadiusEvent>, count: number = 100): RadiusEvent[] {
        return this.getRecentEvents(MAX_EVENTS)
            .filter(event => {
                for (const key of Object.keys(filter) as (keyof RadiusEvent)[]) {
                    if (filter[key] !== undefined && event[key] !== filter[key]) {
                        return false;
                    }
                }
                return true;
            })
            .slice(0, count);
    }

    /**
     * Get statistics for a specific tenant
     */
    getTenantStats(tenantId: string): {
        authRequests: number;
        authAccepts: number;
        authRejects: number;
    } {
        const tenantEvents = this.getFilteredEvents({ tenantId }, MAX_EVENTS);

        return {
            authRequests: tenantEvents.filter(e => e.type === 'ACCESS_REQUEST').length,
            authAccepts: tenantEvents.filter(e => e.type === 'ACCESS_ACCEPT').length,
            authRejects: tenantEvents.filter(e => e.type === 'ACCESS_REJECT').length,
        };
    }

    /**
     * Reset all statistics
     */
    resetStats(): void {
        this.stats = this.createEmptyStats();
        this.events = [];
        this.eventIndex = 0;
    }

    /**
     * Get uptime in seconds
     */
    getUptimeSeconds(): number {
        return Math.floor((Date.now() - this.stats.startTime.getTime()) / 1000);
    }

    /**
     * Get summary for API response
     */
    getSummary(): {
        uptime: string;
        totalRequests: number;
        successRate: number;
        avgResponseTime: number;
        activeSessions: number;
        cacheHitRate: number;
    } {
        const totalAuth = this.stats.authAccepts + this.stats.authRejects;
        const successRate = totalAuth > 0
            ? (this.stats.authAccepts / totalAuth) * 100
            : 0;

        const totalCacheOps = this.stats.nasCacheHits + this.stats.nasCacheMisses;
        const cacheHitRate = totalCacheOps > 0
            ? (this.stats.nasCacheHits / totalCacheOps) * 100
            : 0;

        const uptimeSeconds = this.getUptimeSeconds();
        const days = Math.floor(uptimeSeconds / 86400);
        const hours = Math.floor((uptimeSeconds % 86400) / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        const uptime = `${days}d ${hours}h ${minutes}m`;

        return {
            uptime,
            totalRequests: this.stats.authRequests,
            successRate: Math.round(successRate * 100) / 100,
            avgResponseTime: Math.round(this.stats.avgProcessingTimeMs * 100) / 100,
            activeSessions: this.stats.activeSessions,
            cacheHitRate: Math.round(cacheHitRate * 100) / 100,
        };
    }
}

// Export singleton instance
export const radiusLogger = new RadiusEventLogger();

// Export class for testing
export { RadiusEventLogger };
