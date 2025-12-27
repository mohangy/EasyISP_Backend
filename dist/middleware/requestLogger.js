import { logger } from '../lib/logger.js';
import { performance } from 'perf_hooks';
export const requestLogger = () => {
    return async (c, next) => {
        const start = performance.now();
        const { method, path } = c.req;
        await next();
        const end = performance.now();
        const duration = Math.round(end - start);
        const status = c.res.status;
        // Extract user context if available (from auth middleware)
        const user = c.get('user');
        const tenantId = c.get('tenantId');
        const logData = {
            method,
            path,
            status,
            duration: `${duration}ms`,
        };
        if (user) {
            logData.user = user.email;
            logData.role = user.role;
        }
        if (tenantId) {
            logData.tenant = tenantId;
        }
        // Log level based on status
        if (status >= 500) {
            logger.error(logData, 'Request failed');
        }
        else if (status >= 400) {
            logger.warn(logData, 'Client error');
        }
        else {
            logger.info(logData, 'Request completed');
        }
    };
};
//# sourceMappingURL=requestLogger.js.map