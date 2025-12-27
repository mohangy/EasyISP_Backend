import { prisma } from './prisma.js';
import { queue } from './queue.js';
import { radiusService } from '../services/radius.service.js';
import { logger } from './logger.js';
class ServiceManager {
    async startAll() {
        console.log('\nInitializing EasyISP Backend Services...\n');
        const services = [
            { name: 'Database', start: () => prisma.$connect() },
            { name: 'Queue System', start: () => queue.start() },
            { name: 'RADIUS Auth', start: () => radiusService.start() },
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
            }
            catch (error) {
                logger.error({ error }, `Failed to start ${service.name}`);
                results.push({
                    Service: service.name,
                    Status: '❌ DOWN',
                    Info: error.message
                });
            }
        }
        console.table(results);
        console.log('\n');
    }
    async stopAll() {
        logger.info('Stopping all services...');
        await radiusService.stop();
        await queue.stop();
        await prisma.$disconnect();
        logger.info('All services stopped');
    }
}
export const serviceManager = new ServiceManager();
//# sourceMappingURL=serviceManager.js.map