import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { config } from './lib/config.js';
import { logger } from './lib/logger.js';
import { serviceManager } from './lib/serviceManager.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRoutes } from './routes/auth.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { tenantRoutes } from './routes/tenant.routes.js';
import { dashboardRoutes } from './routes/dashboard.routes.js';
import { customerRoutes } from './routes/customer.routes.js';
import { packageRoutes } from './routes/package.routes.js';
import { financeRoutes } from './routes/finance.routes.js';
import { paymentRoutes } from './routes/payment.routes.js';
import { nasRoutes } from './routes/nas.routes.js';
import { mikrotikRoutes } from './routes/mikrotik.routes.js';
import { wizardRoutes } from './routes/wizard.routes.js';
import { voucherRoutes } from './routes/voucher.routes.js';
import { smsRoutes } from './routes/sms.routes.js';
import { mapRoutes } from './routes/map.routes.js';
import { superAdminRoutes } from './routes/superAdmin.routes.js';
// Phase 6: Advanced Features
import { radiusRoutes } from './routes/radius.routes.js';
import { portalRoutes } from './routes/portal.routes.js';
import { vpnRoutes } from './routes/vpn.routes.js';
import { snmpRoutes } from './routes/snmp.routes.js';
import { sessionRoutes } from './routes/session.routes.js';
// Initialize Hono app
const app = new Hono();
// Global middleware
app.use('*', secureHeaders());
app.use('*', requestLogger()); // Comprehensive request logging
app.use('*', cors({
    origin: config.corsOrigins,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));
// Error handler
app.onError(errorHandler);
// Health check routes (no auth required)
app.route('/health', healthRoutes);
// API routes
const api = new Hono();
api.route('/auth', authRoutes);
api.route('/tenant', tenantRoutes);
api.route('/dashboard', dashboardRoutes);
api.route('/customers', customerRoutes);
api.route('/packages', packageRoutes);
api.route('/finance', financeRoutes);
api.route('/payments', paymentRoutes);
api.route('/nas', nasRoutes);
api.route('/mikrotik', mikrotikRoutes);
api.route('/wizard', wizardRoutes);
api.route('/vouchers', voucherRoutes);
api.route('/sms', smsRoutes);
api.route('/map', mapRoutes);
api.route('/super-admin', superAdminRoutes);
// Phase 6: Advanced Features
api.route('/radius', radiusRoutes);
api.route('/portal', portalRoutes);
api.route('/vpn', vpnRoutes);
api.route('/snmp', snmpRoutes);
api.route('/sessions', sessionRoutes);
// Mount API routes
app.route('/api', api);
// 404 handler
app.notFound((c) => {
    return c.json({ error: 'Not Found', statusCode: 404 }, 404);
});
// Start services and server
const start = async () => {
    try {
        // Start all services (Database, Queue, RADIUS)
        await serviceManager.startAll();
        const port = config.port;
        serve({
            fetch: app.fetch,
            port,
        }, (info) => {
            logger.info(`🚀 API Server running at http://localhost:${info.port}`);
        });
    }
    catch (error) {
        logger.error({ error }, 'Failed to start application');
        process.exit(1);
    }
};
start();
// Graceful shutdown
const shutdown = async (signal) => {
    logger.info(`${signal} received, shutting down gracefully`);
    await serviceManager.stopAll();
    process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
export default app;
//# sourceMappingURL=index.js.map