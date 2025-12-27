import PgBoss from 'pg-boss';
import { config } from './config.js';
import { logger } from './logger.js';

class Queue {
    private boss: PgBoss | null = null;

    constructor() {
        if (config.databaseUrl) {
            this.boss = new PgBoss(config.databaseUrl);
            this.boss.on('error', (error) => logger.error({ error }, 'Queue error'));
        }
    }

    async start() {
        if (!this.boss) {
            logger.warn('Queue system disabled: No database URL configured');
            return;
        }

        try {
            await this.boss.start();
            logger.info('Queue system started');
        } catch (error) {
            logger.error({ error }, 'Failed to start queue system');
            throw error;
        }
    }

    async stop() {
        if (this.boss) {
            await this.boss.stop();
            logger.info('Queue system stopped');
        }
    }

    get instance() {
        return this.boss;
    }
}

export const queue = new Queue();
