import { Hono } from 'hono';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

export const healthRoutes = new Hono();

// Basic health check
healthRoutes.get('/', async (c) => {
    return c.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
    });
});

// Readiness check (includes database)
healthRoutes.get('/ready', async (c) => {
    try {
        // Check database connection
        await prisma.$queryRaw`SELECT 1`;

        return c.json({
            status: 'ready',
            checks: {
                database: 'connected',
            },
        });
    } catch (error) {
        logger.error({ error }, 'Readiness check failed');
        return c.json(
            {
                status: 'not ready',
                checks: {
                    database: 'disconnected',
                },
            },
            503
        );
    }
});

// Liveness check (simple ping)
healthRoutes.get('/live', (c) => {
    return c.json({ status: 'alive' });
});
