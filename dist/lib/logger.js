import pino from 'pino';
import { config } from './config.js';
export const logger = pino({
    level: config.logLevel,
    transport: config.isDev
        ? {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
            },
        }
        : undefined,
    base: {
        env: config.env,
    },
    formatters: {
        level: (label) => ({ level: label }),
    },
});
//# sourceMappingURL=logger.js.map