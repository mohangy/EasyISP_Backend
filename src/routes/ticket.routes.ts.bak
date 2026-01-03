import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requirePermission } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { createAuditLog } from '../lib/audit.js';
import { smsService } from '../services/sms.service.js';
import { logger } from '../lib/logger.js';
import type { TicketStatus, TicketPriority } from '@prisma/client';

export const ticketRoutes = new Hono();

// Apply auth middleware to all routes
ticketRoutes.use('*', authMiddleware);

// Validation schemas
const createTicketSchema = z.object({
    title: z.string().min(3).max(200),
    description: z.string().min(10),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    customerId: z.string().uuid().optional(),
    customerName: z.string().optional(),
    customerPhone: z.string().optional(),
    assignedToId: z.string().uuid().optional(),
});

const updateTicketSchema = z.object({
    title: z.string().min(3).max(200).optional(),
    description: z.string().min(10).optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
});

const assignTicketSchema = z.object({
    assignedToId: z.string().uuid(),
});

const resolveTicketSchema = z.object({
    resolution: z.string().min(5).optional(),
});

// GET /api/tickets - List all tickets
ticketRoutes.get('/', requirePermission('tickets:view'), async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const page = parseInt(c.req.query('page') ?? '1');
    const pageSize = parseInt(c.req.query('pageSize') ?? '20');
    const status = c.req.query('status') as TicketStatus | undefined;
    const priority = c.req.query('priority') as TicketPriority | undefined;
    const assignedToId = c.req.query('assignedToId');

    const where: {
        tenantId: string;
        status?: TicketStatus;
        priority?: TicketPriority;
        assignedToId?: string;
    } = { tenantId };

    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (assignedToId) where.assignedToId = assignedToId;

    const [tickets, total] = await Promise.all([
        prisma.ticket.findMany({
            where,
            orderBy: [
                { priority: 'desc' }, // URGENT first
                { createdAt: 'desc' },
            ],
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.ticket.count({ where }),
    ]);

    // Get assignee names
    const assigneeIds = tickets.map(t => t.assignedToId).filter(Boolean) as string[];
    const creatorIds = tickets.map(t => t.createdById).filter(Boolean) as string[];
    const allUserIds = [...new Set([...assigneeIds, ...creatorIds])];

    const users = await prisma.user.findMany({
        where: { id: { in: allUserIds } },
        select: { id: true, name: true },
    });

    const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));

    return c.json({
        tickets: tickets.map(t => ({
            ...t,
            assignedToName: t.assignedToId ? userMap[t.assignedToId] : null,
            createdByName: userMap[t.createdById] || 'Unknown',
        })),
        total,
        page,
        pageSize,
    });
});

// GET /api/tickets/my-tickets - Get tickets assigned to current user
ticketRoutes.get('/my-tickets', async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');

    const tickets = await prisma.ticket.findMany({
        where: {
            tenantId,
            assignedToId: user.id,
            status: { in: ['OPEN', 'IN_PROGRESS'] },
        },
        orderBy: [
            { priority: 'desc' },
            { createdAt: 'desc' },
        ],
    });

    return c.json({ tickets });
});

// GET /api/tickets/stats - Get ticket statistics
ticketRoutes.get('/stats', requirePermission('tickets:view'), async (c) => {
    const tenantId = c.get('tenantId');

    const [open, inProgress, resolved, total] = await Promise.all([
        prisma.ticket.count({ where: { tenantId, status: 'OPEN' } }),
        prisma.ticket.count({ where: { tenantId, status: 'IN_PROGRESS' } }),
        prisma.ticket.count({ where: { tenantId, status: 'RESOLVED' } }),
        prisma.ticket.count({ where: { tenantId } }),
    ]);

    return c.json({ open, inProgress, resolved, total });
});

// GET /api/tickets/:id - Get ticket details
ticketRoutes.get('/:id', requirePermission('tickets:view'), async (c) => {
    const tenantId = c.get('tenantId');
    const ticketId = c.req.param('id');

    const ticket = await prisma.ticket.findFirst({
        where: { id: ticketId, tenantId },
    });

    if (!ticket) {
        throw new AppError(404, 'Ticket not found');
    }

    // Get user names
    const userIds = [ticket.createdById, ticket.assignedToId, ticket.resolvedById].filter(Boolean) as string[];
    const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true },
    });
    const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));

    return c.json({
        ...ticket,
        createdByName: userMap[ticket.createdById] || 'Unknown',
        assignedToName: ticket.assignedToId ? userMap[ticket.assignedToId] : null,
        resolvedByName: ticket.resolvedById ? userMap[ticket.resolvedById] : null,
    });
});

// POST /api/tickets - Create new ticket
ticketRoutes.post('/', requirePermission('tickets:create'), async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const body = await c.req.json();
    const data = createTicketSchema.parse(body);

    const ticket = await prisma.ticket.create({
        data: {
            title: data.title,
            description: data.description,
            priority: (data.priority as TicketPriority) || 'MEDIUM',
            customerId: data.customerId,
            customerName: data.customerName,
            customerPhone: data.customerPhone,
            assignedToId: data.assignedToId,
            assignedAt: data.assignedToId ? new Date() : null,
            createdById: user.id,
            tenantId,
        },
    });

    // If assigned, send SMS notification
    if (data.assignedToId) {
        await sendAssignmentNotification(tenantId, ticket.id, data.assignedToId, ticket.title, ticket.description, ticket.priority);
    }

    // Audit log
    await createAuditLog({
        action: 'TICKET_CREATE',
        targetType: 'Ticket',
        targetId: ticket.id,
        targetName: ticket.title,
        details: `Priority: ${ticket.priority}${data.assignedToId ? ', Assigned on creation' : ''}`,
        user,
        ipAddress: c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip'),
    });

    return c.json(ticket, 201);
});

// PUT /api/tickets/:id - Update ticket
ticketRoutes.put('/:id', requirePermission('tickets:create'), async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const ticketId = c.req.param('id');
    const body = await c.req.json();
    const data = updateTicketSchema.parse(body);

    const existing = await prisma.ticket.findFirst({
        where: { id: ticketId, tenantId },
    });

    if (!existing) {
        throw new AppError(404, 'Ticket not found');
    }

    const ticket = await prisma.ticket.update({
        where: { id: ticketId },
        data: {
            title: data.title,
            description: data.description,
            priority: data.priority as TicketPriority,
            status: data.status as TicketStatus,
        },
    });

    // Audit log
    await createAuditLog({
        action: 'TICKET_UPDATE',
        targetType: 'Ticket',
        targetId: ticket.id,
        targetName: ticket.title,
        details: 'Ticket updated',
        user,
    });

    return c.json(ticket);
});

// PUT /api/tickets/:id/assign - Assign ticket to team member
ticketRoutes.put('/:id/assign', requirePermission('tickets:assign'), async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const ticketId = c.req.param('id');
    const body = await c.req.json();
    const { assignedToId } = assignTicketSchema.parse(body);

    const existing = await prisma.ticket.findFirst({
        where: { id: ticketId, tenantId },
    });

    if (!existing) {
        throw new AppError(404, 'Ticket not found');
    }

    // Verify assignee exists and belongs to tenant
    const assignee = await prisma.user.findFirst({
        where: { id: assignedToId, tenantId, status: 'ACTIVE' },
    });

    if (!assignee) {
        throw new AppError(404, 'Team member not found');
    }

    const ticket = await prisma.ticket.update({
        where: { id: ticketId },
        data: {
            assignedToId,
            assignedAt: new Date(),
            status: existing.status === 'OPEN' ? 'IN_PROGRESS' : existing.status,
        },
    });

    // Send SMS notification to assignee
    await sendAssignmentNotification(tenantId, ticket.id, assignedToId, ticket.title, ticket.description, ticket.priority);

    // Audit log
    await createAuditLog({
        action: 'TICKET_ASSIGN',
        targetType: 'Ticket',
        targetId: ticket.id,
        targetName: ticket.title,
        details: `Assigned to ${assignee.name}`,
        user,
    });

    return c.json({ success: true, ticket });
});

// PUT /api/tickets/:id/resolve - Mark ticket as resolved
ticketRoutes.put('/:id/resolve', requirePermission('tickets:resolve'), async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const ticketId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const { resolution } = resolveTicketSchema.parse(body);

    const existing = await prisma.ticket.findFirst({
        where: { id: ticketId, tenantId },
    });

    if (!existing) {
        throw new AppError(404, 'Ticket not found');
    }

    const ticket = await prisma.ticket.update({
        where: { id: ticketId },
        data: {
            status: 'RESOLVED',
            resolvedAt: new Date(),
            resolvedById: user.id,
            resolution: resolution || null,
        },
    });

    // Audit log
    await createAuditLog({
        action: 'TICKET_RESOLVE',
        targetType: 'Ticket',
        targetId: ticket.id,
        targetName: ticket.title,
        details: resolution ? `Resolution: ${resolution}` : 'Ticket resolved',
        user,
    });

    return c.json({ success: true, ticket });
});

// DELETE /api/tickets/:id - Delete ticket (admin only)
ticketRoutes.delete('/:id', requirePermission('tickets:create'), async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const ticketId = c.req.param('id');

    const existing = await prisma.ticket.findFirst({
        where: { id: ticketId, tenantId },
    });

    if (!existing) {
        throw new AppError(404, 'Ticket not found');
    }

    await prisma.ticket.delete({
        where: { id: ticketId },
    });

    // Audit log
    await createAuditLog({
        action: 'TICKET_DELETE',
        targetType: 'Ticket',
        targetId: existing.id,
        targetName: existing.title,
        details: 'Ticket deleted',
        user,
    });

    return c.json({ success: true });
});

// Helper: Send SMS notification to assigned team member
async function sendAssignmentNotification(tenantId: string, ticketId: string, userId: string, ticketTitle: string, ticketDescription?: string, priority?: string) {
    try {
        const assignee = await prisma.user.findUnique({
            where: { id: userId },
            select: { name: true, email: true, phone: true },
        });

        if (!assignee) {
            logger.warn({ ticketId, userId }, 'Assignee not found for ticket notification');
            return;
        }

        if (!assignee.phone) {
            logger.warn({
                ticketId,
                assignee: assignee.name,
            }, 'Assignee has no phone number - cannot send SMS notification');
            return;
        }

        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { businessName: true },
        });

        // Build the SMS message with ticket details
        const priorityLabel = priority ? ` [${priority}]` : '';
        const message = `New Support Ticket${priorityLabel} assigned to you:\n` +
            `Title: ${ticketTitle}\n` +
            `${ticketDescription ? `Details: ${ticketDescription.substring(0, 100)}${ticketDescription.length > 100 ? '...' : ''}\n` : ''}` +
            `Login to ${tenant?.businessName || 'the portal'} to view and resolve.`;

        // Send SMS
        const result = await smsService.sendSms(
            tenantId,
            assignee.phone,
            message,
            'TICKET_ASSIGNMENT'
        );

        if (result.success) {
            logger.info({
                ticketId,
                assignee: assignee.name,
                phone: assignee.phone,
            }, 'Ticket assignment SMS notification sent');
        } else {
            logger.warn({
                ticketId,
                assignee: assignee.name,
                error: result.error,
            }, 'Failed to send ticket assignment SMS');
        }

    } catch (error) {
        logger.error({ error, ticketId, userId }, 'Failed to send ticket assignment notification');
    }
}
