import type { ErrorHandler } from 'hono';
export declare class AppError extends Error {
    statusCode: number;
    code?: string | undefined;
    constructor(statusCode: number, message: string, code?: string | undefined);
}
export declare const errorHandler: ErrorHandler;
//# sourceMappingURL=errorHandler.d.ts.map