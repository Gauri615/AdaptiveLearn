import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  let status = 500;
  let message = 'An unexpected server error occurred. Please try again.';
  if (err instanceof ZodError) {
    status = 400;
    message = err.issues[0]?.message || 'Please check the submitted information.';
  } else if (err instanceof ApiError) {
    status = err.status;
    message = err.message;
  } else if (typeof err === 'object' && err !== null && 'type' in err && err.type === 'entity.parse.failed') {
    status = 400;
    message = 'The request body contains invalid JSON. Check the format and try again.';
  } else if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ER_DUP_ENTRY') {
    status = 409;
    message = 'This record already exists. Check for duplicate values and try again.';
  }

  if (status >= 500) console.error(err);
  res.status(status).json({ error: { message } });
}
