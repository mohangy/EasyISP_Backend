import dotenv from 'dotenv';
import path from 'path';
// Debug: Log startup directory
console.log(`[Config] CWD: ${process.cwd()}`);
const envPath = path.resolve(process.cwd(), '.env');
console.log(`[Config] Loading .env from: ${envPath}`);
// Load .env explicitly
const result = dotenv.config({ path: envPath });
if (result.error) {
    console.warn(`[Config] Warning: Failed to load .env file: ${result.error.message}`);
}
else {
    console.log('[Config] .env loaded successfully');
}
function getEnv(key, defaultValue) {
    const value = process.env[key];
    if (value === undefined) {
        if (defaultValue !== undefined) {
            return defaultValue;
        }
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}
function getEnvNumber(key, defaultValue) {
    const value = process.env[key];
    if (value === undefined) {
        return defaultValue;
    }
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
        throw new Error(`Environment variable ${key} must be a number`);
    }
    return parsed;
}
export const config = {
    // Environment
    env: getEnv('NODE_ENV', 'development'),
    isDev: getEnv('NODE_ENV', 'development') === 'development',
    isProd: getEnv('NODE_ENV', 'development') === 'production',
    // Server
    port: getEnvNumber('PORT', 3000),
    host: getEnv('HOST', '0.0.0.0'),
    // Database
    databaseUrl: getEnv('DATABASE_URL'),
    // JWT
    jwtSecret: getEnv('JWT_SECRET'),
    jwtExpiresIn: getEnv('JWT_EXPIRES_IN', '7d'),
    // Queue
    queueDriver: getEnv('QUEUE_DRIVER', 'pgboss'),
    redisUrl: process.env['REDIS_URL'],
    // M-Pesa
    mpesa: {
        env: getEnv('MPESA_ENV', 'sandbox'),
        consumerKey: getEnv('MPESA_CONSUMER_KEY', ''),
        consumerSecret: getEnv('MPESA_CONSUMER_SECRET', ''),
        shortcode: getEnv('MPESA_SHORTCODE', ''),
        passkey: getEnv('MPESA_PASSKEY', ''),
        callbackUrl: getEnv('MPESA_CALLBACK_URL', ''),
        webhookKey: getEnv('MPESA_WEBHOOK_KEY', ''),
    },
    // SMS
    sms: {
        provider: getEnv('SMS_PROVIDER', 'africastalking'),
        apiKey: getEnv('SMS_API_KEY', ''),
        senderId: getEnv('SMS_SENDER_ID', 'EASYISP'),
    },
    // CORS
    corsOrigins: getEnv('CORS_ORIGINS', 'http://localhost:5173').split(','),
    // Logging
    logLevel: getEnv('LOG_LEVEL', 'info'),
    // Sentry (optional)
    sentryDsn: process.env['SENTRY_DSN'],
};
//# sourceMappingURL=config.js.map