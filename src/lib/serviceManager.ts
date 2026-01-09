import { prisma } from './prisma.js';
import { queue } from './queue.js';
import { radiusServer } from '../radius/index.js';
import { logger } from './logger.js';
import { startVpnStatusMonitor, stopVpnStatusMonitor } from '../services/vpn-status.service.js';

class ServiceManager {
    async startAll() {
        console.log('\nInitializing EasyISP Backend Services...\n');

        const services = [
            { name: 'Database', start: () => prisma.$connect() },
            { name: 'Queue System', start: () => queue.start() },
            { name: 'RADIUS Auth', start: () => radiusServer.start() },
            { name: 'VPN Monitor', start: () => { startVpnStatusMonitor(); return Promise.resolve(); } },
        ];

        const results = [];

        for (const service of services) {
            try {
                await service.start();
                results.push({
                    Service: service.name,
                    Status: '✅ UP',
                    Info: 'Running'
                });
            } catch (error) {
                logger.error({ error }, `Failed to start ${service.name}`);
                results.push({
                    Service: service.name,
                    Status: '❌ DOWN',
                    Info: (error as Error).message
                });
            }
        }

        console.table(results);
        console.log('\n');
    }

    async stopAll() {
        logger.info('Stopping all services...');
        stopVpnStatusMonitor();
        await radiusServer.stop();
        await queue.stop();
        await prisma.$disconnect();
        logger.info('All services stopped');
    }
}

export const serviceManager = new ServiceManager();

