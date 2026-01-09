import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../lib/logger.js';
import {
    initiateSTKPush,
    querySTKStatus,
    parseMpesaSms,
    createHotspotCustomerFromPayment,
    formatPhoneNumber,
    getTenantMpesaConfig,
    validateBuyGoodsConfig,
} from '../services/mpesa.service.js';

export const portalRoutes = new Hono();

// These routes are mostly public for hotspot portal access

// GET /api/portal/packages - Get available packages for portal
portalRoutes.get('/packages', async (c) => {
    const tenantId = c.req.query('tenantId');

    if (!tenantId) {
        throw new AppError(400, 'Tenant ID required');
    }

    const packages = await prisma.package.findMany({
        where: {
            tenantId,
            isActive: true,
            type: 'HOTSPOT',
        },
        select: {
            id: true,
            name: true,
            price: true,
            downloadSpeed: true,
            uploadSpeed: true,
            sessionTime: true,
            dataLimit: true,
        },
        orderBy: { price: 'asc' },
    });

    return c.json({
        packages: packages.map((p: { id: string; name: string; price: number; downloadSpeed: number; uploadSpeed: number; sessionTime: number | null; dataLimit: bigint | null }) => ({
            id: p.id,
            name: p.name,
            price: p.price,
            speed: `${p.downloadSpeed}/${p.uploadSpeed} Mbps`,
            duration: p.sessionTime ? formatDuration(p.sessionTime) : 'Unlimited',
            data: p.dataLimit ? formatBytes(Number(p.dataLimit)) : 'Unlimited',
        })),
    });
});

// GET /api/portal/check-session - Check if MAC has active session
portalRoutes.get('/check-session', async (c) => {
    const macAddress = c.req.query('mac');
    const tenantId = c.req.query('tenantId');

    if (!macAddress || !tenantId) {
        return c.json({ hasActiveSession: false });
    }

    // Normalize MAC address (uppercase, colon-separated)
    const normalizedMac = macAddress.toUpperCase().replace(/[:-]/g, ':');

    // Find customer with this MAC address who has a valid session
    const customer = await prisma.customer.findFirst({
        where: {
            tenantId,
            lastMac: normalizedMac,
            connectionType: 'HOTSPOT',
            status: 'ACTIVE',
            deletedAt: null,
            expiresAt: { gt: new Date() }, // Not expired
        },
        include: {
            package: { select: { name: true } },
        },
    });

    if (!customer) {
        return c.json({ hasActiveSession: false });
    }

    // Calculate remaining time
    const now = new Date();
    const remaining = customer.expiresAt.getTime() - now.getTime();
    const remainingMinutes = Math.floor(remaining / 60000);

    logger.info({
        macAddress: normalizedMac,
        username: customer.username,
        remainingMinutes
    }, 'Found active session for MAC');

    return c.json({
        hasActiveSession: true,
        customer: {
            username: customer.username,
            password: customer.password, // For auto-login
            name: customer.name,
            packageName: customer.package?.name,
            expiresAt: customer.expiresAt,
            remainingMinutes,
        }
    });
});

// POST /api/portal/login - Hotspot login
portalRoutes.post('/login', async (c) => {
    const body = await c.req.json();
    const { username, password, nasId, macAddress, ip } = body;

    if (!username || !password) {
        throw new AppError(400, 'Username and password required');
    }

    // Find customer
    const customer = await prisma.customer.findFirst({
        where: {
            OR: [
                { username },
                { phone: username },
            ],
            deletedAt: null,
        },
        include: {
            package: true,
            tenant: { select: { id: true, name: true } },
        },
    });

    if (!customer) {
        throw new AppError(401, 'Invalid credentials');
    }

    // Check if customer is active
    if (customer.status !== 'ACTIVE') {
        throw new AppError(403, `Account ${customer.status.toLowerCase()}`);
    }

    // Check expiry
    if (customer.expiresAt && customer.expiresAt < new Date()) {
        throw new AppError(403, 'Subscription expired');
    }

    // TODO: Verify password (would need password field or RADIUS auth)
    // For now, just check if password matches username or phone (for demo)

    // Create or update session
    const session = await prisma.session.create({
        data: {
            sessionId: `HS-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            username: customer.username,
            nasIpAddress: '0.0.0.0', // Will be updated by NAS
            customerId: customer.id,
            nasId: nasId ?? undefined,
            framedIp: ip,
            macAddress,
            startTime: new Date(),
            tenantId: customer.tenantId,
        },
    });

    logger.info({ username, sessionId: session.sessionId }, 'Hotspot login successful');

    return c.json({
        success: true,
        sessionId: session.sessionId,
        customer: {
            name: customer.name,
            package: customer.package?.name,
            expiresAt: customer.expiresAt,
        },
        quota: customer.package ? {
            speed: `${customer.package.downloadSpeed}/${customer.package.uploadSpeed} Mbps`,
            data: customer.package.dataLimit ? formatBytes(Number(customer.package.dataLimit)) : 'Unlimited',
            time: customer.package.sessionTime ? formatDuration(customer.package.sessionTime) : 'Unlimited',
        } : null,
    });
});

// POST /api/portal/logout - Hotspot logout
portalRoutes.post('/logout', async (c) => {
    const body = await c.req.json();
    const { sessionId, username, macAddress } = body;

    const session = await prisma.session.findFirst({
        where: {
            OR: [
                { sessionId },
                { username },
                { macAddress },
            ],
            stopTime: null,
        },
    });

    if (!session) {
        throw new AppError(404, 'Session not found');
    }

    await prisma.session.update({
        where: { id: session.id },
        data: {
            stopTime: new Date(),
            terminateCause: 'User-Logout',
        },
    });

    return c.json({ success: true });
});

// GET /api/portal/status - Get session status
portalRoutes.get('/status', async (c) => {
    const sessionId = c.req.query('sessionId');
    const macAddress = c.req.query('mac');

    if (!sessionId && !macAddress) {
        throw new AppError(400, 'Session ID or MAC address required');
    }

    const session = await prisma.session.findFirst({
        where: {
            OR: [
                { sessionId: sessionId ?? undefined },
                { macAddress: macAddress ?? undefined },
            ],
            stopTime: null,
        },
        include: {
            customer: {
                include: { package: true },
            },
        },
    });

    if (!session) {
        return c.json({ active: false });
    }

    const uptime = Math.floor((Date.now() - session.startTime.getTime()) / 1000);

    return c.json({
        active: true,
        sessionId: session.sessionId,
        uptime: formatUptime(uptime),
        uptimeSeconds: uptime,
        bytesIn: session.inputOctets,
        bytesOut: session.outputOctets,
        customer: session.customer ? {
            name: session.customer.name,
            package: session.customer.package?.name,
        } : null,
    });
});

// POST /api/portal/voucher - Redeem voucher from portal
portalRoutes.post('/voucher', async (c) => {
    const body = await c.req.json();
    const { code, macAddress, nasId } = body;

    if (!code) {
        throw new AppError(400, 'Voucher code required');
    }

    const voucher = await prisma.voucher.findFirst({
        where: { code: code.toUpperCase(), status: 'AVAILABLE' },
        include: { package: true, tenant: true },
    });

    if (!voucher) {
        throw new AppError(404, 'Invalid or unavailable voucher');
    }

    // Create a temporary customer/session for the voucher
    const username = `V-${code.toUpperCase()}`;

    // Mark voucher as used
    await prisma.voucher.update({
        where: { id: voucher.id },
        data: {
            status: 'USED',
            usedAt: new Date(),
        },
    });

    // Create session
    const session = await prisma.session.create({
        data: {
            sessionId: `VCH-${Date.now()}`,
            username,
            nasIpAddress: '0.0.0.0',
            nasId: nasId ?? undefined,
            macAddress,
            startTime: new Date(),
            tenantId: voucher.tenantId,
        },
    });

    return c.json({
        success: true,
        sessionId: session.sessionId,
        package: {
            name: voucher.package.name,
            speed: `${voucher.package.downloadSpeed}/${voucher.package.uploadSpeed} Mbps`,
            duration: voucher.package.sessionTime
                ? formatDuration(voucher.package.sessionTime)
                : '30 days',
        },
    });
});

// GET /api/portal/tenant - Get tenant info for branding
portalRoutes.get('/tenant', async (c) => {
    const tenantId = c.req.query('tenantId');
    const nasIp = c.req.query('nasIp');

    let tenant;

    if (tenantId) {
        tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: {
                id: true,
                name: true,
                businessName: true,
                logo: true,
                primaryColor: true,
                phone: true,
                email: true,
            },
        });
    } else if (nasIp) {
        // Find tenant by NAS IP
        const nas = await prisma.nAS.findFirst({
            where: { ipAddress: nasIp },
            include: { tenant: true },
        });
        tenant = nas?.tenant;
    }

    if (!tenant) {
        throw new AppError(404, 'Tenant not found');
    }

    return c.json({
        id: tenant.id,
        name: tenant.businessName ?? tenant.name,
        logo: tenant.logo,
        primaryColor: tenant.primaryColor ?? '#0ea5e9',
        contact: {
            phone: tenant.phone,
            email: tenant.email,
        },
    });
});

// ============ M-PESA HOTSPOT ENDPOINTS ============

// Validation schemas
const mpesaInitiateSchema = z.object({
    tenantId: z.string().uuid(),
    phone: z.string().min(9),
    packageId: z.string().uuid(),
    macAddress: z.string().optional(),
    nasIp: z.string().optional(),
});

const mpesaVerifySmsSchema = z.object({
    tenantId: z.string().uuid(),
    smsText: z.string().min(10),
    packageId: z.string().uuid(),
    macAddress: z.string().optional(),
    nasIp: z.string().optional(),
});

// GET /api/portal/mpesa/check - Check if tenant has M-Pesa configured
portalRoutes.get('/mpesa/check', async (c) => {
    const tenantId = c.req.query('tenantId');

    if (!tenantId) {
        throw new AppError(400, 'Tenant ID required');
    }

    const config = await getTenantMpesaConfig(tenantId);

    return c.json({
        configured: config !== null,
    });
});

// GET /api/portal/mpesa/validate - Validate M-Pesa configuration for BuyGoods/PayBill
portalRoutes.get('/mpesa/validate', async (c) => {
    const tenantId = c.req.query('tenantId');

    if (!tenantId) {
        throw new AppError(400, 'Tenant ID required');
    }

    const config = await getTenantMpesaConfig(tenantId);

    if (!config) {
        return c.json({
            configured: false,
            valid: false,
            errors: ['M-Pesa gateway not configured for this tenant'],
        });
    }

    const validation = validateBuyGoodsConfig(config);

    return c.json({
        configured: true,
        valid: validation.valid,
        configType: validation.configType,
        errors: validation.errors,
        details: {
            // Mask sensitive data
            tillNumber: config.subType === 'BUYGOODS' ? config.shortcode : undefined,
            paybillNumber: config.subType === 'PAYBILL' ? config.shortcode : undefined,
            storeNumber: config.storeNumber ? `${config.storeNumber.substring(0, 3)}***` : undefined,
            environment: config.env,
            hasPasskey: !!config.passkey,
            hasCredentials: !!config.consumerKey && !!config.consumerSecret,
        }
    });
});

// POST /api/portal/mpesa/initiate - Initiate STK push for package purchase
portalRoutes.post('/mpesa/initiate', async (c) => {
    const body = await c.req.json();
    const data = mpesaInitiateSchema.parse(body);

    // Get package details
    const pkg = await prisma.package.findFirst({
        where: { id: data.packageId, tenantId: data.tenantId, isActive: true },
    });

    if (!pkg) {
        throw new AppError(404, 'Package not found');
    }

    try {
        // Use cleaned, stripped MAC address as Account Reference (max 12 chars) if available
        const accountRef = data.macAddress
            ? data.macAddress.replace(/[^A-Fa-f0-9]/g, '').substring(0, 12).toUpperCase()
            : `HS-${pkg.name.substring(0, 9)}`;

        // Initiate STK push
        const response = await initiateSTKPush(
            data.tenantId,
            data.phone,
            pkg.price,
            accountRef,
            `Hotspot: ${pkg.name}`
        );

        // Create pending payment record
        const pendingPayment = await prisma.pendingHotspotPayment.create({
            data: {
                checkoutRequestId: response.CheckoutRequestID,
                merchantRequestId: response.MerchantRequestID,
                phone: formatPhoneNumber(data.phone),
                amount: pkg.price,
                packageId: data.packageId,
                macAddress: data.macAddress,
                nasIp: data.nasIp,
                tenantId: data.tenantId,
                expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
            },
        });

        logger.info({
            checkoutRequestId: response.CheckoutRequestID,
            packageName: pkg.name,
            phone: formatPhoneNumber(data.phone)
        }, 'M-Pesa STK Push initiated for hotspot');

        return c.json({
            success: true,
            checkoutRequestId: response.CheckoutRequestID,
            message: response.CustomerMessage,
        });
    } catch (error) {
        logger.error({ error, tenantId: data.tenantId }, 'Failed to initiate STK push');
        throw new AppError(500, error instanceof Error ? error.message : 'Failed to initiate payment');
    }
});

// GET /api/portal/mpesa/status - Check payment status by CheckoutRequestID
portalRoutes.get('/mpesa/status', async (c) => {
    const checkoutRequestId = c.req.query('checkoutRequestId');
    const tenantId = c.req.query('tenantId');

    if (!checkoutRequestId || !tenantId) {
        throw new AppError(400, 'checkoutRequestId and tenantId required');
    }

    // First check our database
    const pendingPayment = await prisma.pendingHotspotPayment.findUnique({
        where: { checkoutRequestId },
        include: { package: true },
    });

    if (!pendingPayment) {
        throw new AppError(404, 'Payment not found');
    }

    // If already completed, return success
    if (pendingPayment.status === 'COMPLETED' && pendingPayment.transactionCode) {
        return c.json({
            status: 'completed',
            username: pendingPayment.transactionCode,
            password: pendingPayment.transactionCode,
            package: pendingPayment.package.name,
        });
    }

    // If expired or failed
    if (pendingPayment.status === 'FAILED' || pendingPayment.status === 'EXPIRED') {
        return c.json({
            status: pendingPayment.status.toLowerCase(),
        });
    }

    // Check if expired by time
    if (new Date() > pendingPayment.expiresAt) {
        await prisma.pendingHotspotPayment.update({
            where: { id: pendingPayment.id },
            data: { status: 'EXPIRED' },
        });
        return c.json({ status: 'expired' });
    }

    // Query M-Pesa for status (fallback if callback wasn't received)
    try {
        const mpesaStatus = await querySTKStatus(tenantId, checkoutRequestId);

        if (mpesaStatus.ResultCode === '0') {
            // Payment successful! But first, re-check if callback already processed it
            const freshPayment = await prisma.pendingHotspotPayment.findUnique({
                where: { checkoutRequestId },
                include: { package: true },
            });

            // If already completed by callback, return the existing credentials
            if (freshPayment?.status === 'COMPLETED' && freshPayment.transactionCode) {
                logger.info({ checkoutRequestId }, 'Payment already completed by callback - returning existing credentials');

                // Get the customer that was created
                const existingCustomer = freshPayment.customerId
                    ? await prisma.customer.findUnique({ where: { id: freshPayment.customerId } })
                    : null;

                return c.json({
                    status: 'completed',
                    username: existingCustomer?.username || freshPayment.transactionCode,
                    password: existingCustomer?.password || freshPayment.transactionCode,
                    package: freshPayment.package.name,
                });
            }

            // Callback may not have been received - complete the payment now
            logger.info({ checkoutRequestId, mpesaStatus }, 'M-Pesa query shows successful payment - completing via polling');

            // Generate a receipt code from checkoutRequestId if not available
            const generatedReceipt = `HP${Date.now().toString(36).toUpperCase()}`;

            try {
                // Create hotspot customer
                const result = await createHotspotCustomerFromPayment(
                    tenantId,
                    generatedReceipt,
                    pendingPayment.phone,
                    pendingPayment.packageId,
                    pendingPayment.amount,
                    pendingPayment.macAddress || undefined
                );

                // Update pending payment
                await prisma.pendingHotspotPayment.update({
                    where: { id: pendingPayment.id },
                    data: {
                        status: 'COMPLETED',
                        transactionCode: generatedReceipt,
                        customerId: result.customerId,
                    },
                });

                logger.info({
                    checkoutRequestId,
                    username: result.username,
                    generatedReceipt
                }, 'Payment completed via status polling');

                return c.json({
                    status: 'completed',
                    username: result.username,
                    password: result.password,
                    package: pendingPayment.package.name,
                });
            } catch (createError) {
                logger.error({ createError, checkoutRequestId }, 'Failed to create customer from status poll');
                return c.json({ status: 'pending', message: 'Payment confirmed, processing...' });
            }
        } else if (mpesaStatus.ResultCode) {
            // Payment failed
            await prisma.pendingHotspotPayment.update({
                where: { id: pendingPayment.id },
                data: { status: 'FAILED' },
            });
            return c.json({ status: 'failed', message: mpesaStatus.ResultDesc });
        }
    } catch {
        // M-Pesa query failed, continue polling
    }

    return c.json({ status: 'pending' });
});

// POST /api/portal/mpesa/verify-sms - Verify payment from pasted SMS message
portalRoutes.post('/mpesa/verify-sms', async (c) => {
    const body = await c.req.json();
    const data = mpesaVerifySmsSchema.parse(body);

    // Parse the SMS to extract transaction code
    const parsed = parseMpesaSms(data.smsText);

    if (!parsed) {
        throw new AppError(400, 'Could not extract M-Pesa transaction code from message');
    }

    // Check if customer already exists with this code (Recovery scenario)
    const existingCustomer = await prisma.customer.findFirst({
        where: { username: parsed.code, tenantId: data.tenantId },
        include: { package: true }
    });

    if (existingCustomer) {
        // Customer already created - return credentials
        return c.json({
            success: true,
            username: parsed.code,
            password: parsed.code,
            message: 'Account already exists',
            package: existingCustomer.package?.name // Include package name if possible
        });
    }

    // Check if this transaction code is already used (but no customer found?)
    const existingPayment = await prisma.payment.findFirst({
        where: { transactionId: parsed.code },
    });

    if (existingPayment) {
        throw new AppError(400, 'This transaction has already been used');
    }

    if (existingCustomer) {
        // Customer already created - return credentials
        return c.json({
            success: true,
            username: parsed.code,
            password: parsed.code,
            message: 'Account already exists',
        });
    }

    // Get package details
    const pkg = await prisma.package.findFirst({
        where: { id: data.packageId, tenantId: data.tenantId, isActive: true },
    });

    if (!pkg) {
        throw new AppError(404, 'Package not found');
    }

    // Verify amount matches (if extracted from SMS)
    if (parsed.amount && parsed.amount < pkg.price) {
        throw new AppError(400, `Payment amount (${parsed.amount}) is less than package price (${pkg.price})`);
    }

    try {
        // Create the hotspot customer
        const result = await createHotspotCustomerFromPayment(
            data.tenantId,
            parsed.code,
            '', // Phone not available from SMS parse
            data.packageId,
            parsed.amount || pkg.price,
            data.macAddress
        );

        logger.info({
            transactionCode: parsed.code,
            packageName: pkg.name
        }, 'Hotspot customer created from SMS verification');

        return c.json({
            success: true,
            username: result.username,
            password: result.password,
            expiresAt: result.expiresAt,
            package: pkg.name,
        });
    } catch (error) {
        logger.error({ error, code: parsed.code }, 'Failed to create customer from SMS');
        throw new AppError(500, 'Failed to process payment');
    }
});

// GET /api/portal/mpesa/callback - M-Pesa callback URL verification
portalRoutes.get('/mpesa/callback', async (c) => {
    logger.info('M-Pesa callback URL verification (GET request)');
    return c.json({ ResultCode: 0, ResultDesc: 'Callback URL is reachable' });
});

// POST /api/portal/mpesa/callback - M-Pesa webhook callback (called by M-Pesa)
portalRoutes.post('/mpesa/callback', async (c) => {
    try {
        const rawBody = await c.req.json();
        logger.info({ body: rawBody }, 'M-Pesa hotspot callback received');

        const stkCallback = rawBody?.Body?.stkCallback;
        if (!stkCallback) {
            return c.json({ ResultCode: 0, ResultDesc: 'Accepted' });
        }

        const { CheckoutRequestID, ResultCode, CallbackMetadata } = stkCallback;

        // Find the pending payment
        const pendingPayment = await prisma.pendingHotspotPayment.findUnique({
            where: { checkoutRequestId: CheckoutRequestID },
            include: { package: true },
        });

        if (!pendingPayment) {
            logger.warn({ CheckoutRequestID }, 'Pending payment not found for callback');
            return c.json({ ResultCode: 0, ResultDesc: 'Accepted' });
        }

        // If payment failed
        if (ResultCode !== 0) {
            await prisma.pendingHotspotPayment.update({
                where: { id: pendingPayment.id },
                data: { status: 'FAILED' },
            });
            logger.info({ CheckoutRequestID, ResultCode }, 'M-Pesa hotspot payment failed');
            return c.json({ ResultCode: 0, ResultDesc: 'Accepted' });
        }

        // Extract transaction details from callback
        const metadata = CallbackMetadata?.Item ?? [];
        const getMetaValue = (name: string): string | number | undefined => {
            const item = metadata.find((m: { Name: string }) => m.Name === name);
            return item?.Value;
        };

        const mpesaReceiptNumber = String(getMetaValue('MpesaReceiptNumber') ?? '');
        const amount = Number(getMetaValue('Amount')) || pendingPayment.amount;
        const phone = String(getMetaValue('PhoneNumber') ?? pendingPayment.phone);
        const transactionType = String(getMetaValue('TransactionType') ?? 'Unknown');

        if (!mpesaReceiptNumber) {
            logger.error({ CheckoutRequestID }, 'No receipt number in callback');
            return c.json({ ResultCode: 0, ResultDesc: 'Accepted' });
        }

        // Security: Check for duplicate receipt (replay attack prevention)
        const existingPayment = await prisma.payment.findFirst({
            where: { transactionId: mpesaReceiptNumber },
        });

        if (existingPayment) {
            logger.warn({
                CheckoutRequestID,
                mpesaReceiptNumber,
                existingPaymentId: existingPayment.id
            }, 'Duplicate M-Pesa receipt detected - possible replay attack');
            return c.json({ ResultCode: 0, ResultDesc: 'Accepted' });
        }

        // Security: Validate amount matches or exceeds package price
        if (amount < pendingPayment.package.price) {
            logger.error({
                CheckoutRequestID,
                mpesaReceiptNumber,
                receivedAmount: amount,
                requiredAmount: pendingPayment.package.price,
                packageName: pendingPayment.package.name
            }, 'Payment amount less than package price - rejecting');

            await prisma.pendingHotspotPayment.update({
                where: { id: pendingPayment.id },
                data: { status: 'FAILED' },
            });
            return c.json({ ResultCode: 0, ResultDesc: 'Accepted' });
        }

        logger.info({
            CheckoutRequestID,
            mpesaReceiptNumber,
            amount,
            phone,
            transactionType,
            packageName: pendingPayment.package.name,
            tenantId: pendingPayment.tenantId
        }, 'M-Pesa callback validated - creating hotspot customer');

        // Create hotspot customer
        const result = await createHotspotCustomerFromPayment(
            pendingPayment.tenantId,
            mpesaReceiptNumber,
            phone,
            pendingPayment.packageId,
            amount,
            pendingPayment.macAddress || undefined
        );

        // Update pending payment
        await prisma.pendingHotspotPayment.update({
            where: { id: pendingPayment.id },
            data: {
                status: 'COMPLETED',
                transactionCode: mpesaReceiptNumber,
                customerId: result.customerId,
            },
        });

        logger.info({
            CheckoutRequestID,
            mpesaReceiptNumber,
            username: result.username,
            expiresAt: result.expiresAt,
            transactionType
        }, 'M-Pesa hotspot payment completed - customer created successfully');

        return c.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    } catch (error) {
        logger.error({ error }, 'M-Pesa callback processing error');
        return c.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }
});

// Helper functions
function formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes} min`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)} hours`;
    return `${Math.floor(minutes / 1440)} days`;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatUptime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours}h ${minutes}m ${secs}s`;
}
