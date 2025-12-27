import type { Context, ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { logger } from '../lib/logger.js';

export class AppError extends Error {
    constructor(
        public statusCode: number,
        message: string,
        public code?: string
    ) {
        super(message);
        this.name = 'AppError';
    }
}

export const errorHandler: ErrorHandler = (err, c: Context) => {
    logger.error({ err, path: c.req.path, method: c.req.method }, 'Request error');

    // Zod validation errors
    if (err instanceof ZodError) {
        return c.json(
            {
                error: 'Validation failed',
                statusCode: 400,
                details: err.errors.map((e) => ({
                    field: e.path.join('.'),
                    message: e.message,
                })),
            },
            400
        );
    }

    // Custom app errors
    if (err instanceof AppError) {
        return c.json(
            {
                error: err.message,
                statusCode: err.statusCode,
                code: err.code,
            },
            err.statusCode as 400 | 401 | 403 | 404 | 500
        );
    }

    // Hono HTTP exceptions
    if (err instanceof HTTPException) {
        return c.json(
            {
                error: err.message,
                statusCode: err.status,
            },
            err.status
        );
    }

    // Prisma errors
    if (err.constructor.name === 'PrismaClientKnownRequestError') {
        const prismaError = err as unknown as { code: string; meta?: { target?: string[] } };
        if (prismaError.code === 'P2002') {
            return c.json(
                {
                    error: 'A record with this value already exists',
                    statusCode: 409,
                    field: prismaError.meta?.target?.[0],
                },
                409
            );
        }
        if (prismaError.code === 'P2025') {
            return c.json(
                {
                    error: 'Record not found',
                    statusCode: 404,
                },
                404
            );
        }
    }

    // Default 500 error
    return c.json(
        {
            error: 'Internal server error',
            statusCode: 500,
        },
        500
    );
};
