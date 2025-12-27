import { PrismaClient } from '@prisma/client';
import { config } from './config.js';
import { logger } from './logger.js';
// Singleton Prisma client
const globalForPrisma = globalThis;
export const prisma = globalForPrisma.prisma ??
    new PrismaClient({
        log: config.isDev
            ? [
                { level: 'query', emit: 'event' },
                { level: 'error', emit: 'stdout' },
                { level: 'warn', emit: 'stdout' },
            ]
            : ['error'],
    });
if (config.isDev) {
    // Log queries in development
    prisma.$on('query', (e) => {
        logger.debug({ query: e.query, duration: `${e.duration}ms` }, 'Prisma Query');
    });
}
if (!config.isProd) {
    globalForPrisma.prisma = prisma;
}
export default prisma;
//# sourceMappingURL=prisma.js.map