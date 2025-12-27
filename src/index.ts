import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { config } from './lib/config.js';
import { logger } from './lib/logger.js';
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
app.use('*', honoLogger());
app.use('*', cors({
    origin: config.corsOrigins,
    credentials: true,
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

// Start server
const port = config.port;
logger.info({ port, env: config.env }, 'Starting EasyISP Backend');

serve({
    fetch: app.fetch,
    port,
}, (info) => {
    logger.info(`🚀 Server running at http://localhost:${info.port}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    process.exit(0);
});

export default app;
