import type { Context, Next } from 'hono';
import type { ApiResponse } from '../types';

// ─── Custom error classes ─────────────────────────────────────────────────────

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class AuthError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, message, 'AUTH_ERROR');
    this.name = 'AuthError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(404, `${resource} not found`, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends AppError {
  constructor() {
    super(429, 'Too many requests', 'RATE_LIMIT');
    this.name = 'RateLimitError';
  }
}

// ─── Global error handler middleware ─────────────────────────────────────────

export function errorHandler() {
  return async (c: Context, next: Next) => {
    try {
      await next();
    } catch (err) {
      return handleError(c, err);
    }
  };
}

export function handleError(c: Context, err: unknown): Response {
  const isDev = process.env.NODE_ENV !== 'production';

  if (err instanceof AppError) {
    const body: ApiResponse = {
      success: false,
      error:   err.message,
      ...(isDev && { code: err.code }),
    };
    return c.json(body, err.statusCode as any);
  }

  // Postgres errors
  if (err && typeof err === 'object' && 'code' in err) {
    const pgErr = err as any;
    if (pgErr.code === '23505') {
      return c.json<ApiResponse>({ success: false, error: 'A record with this value already exists' }, 409);
    }
    if (pgErr.code === '23503') {
      return c.json<ApiResponse>({ success: false, error: 'Referenced record not found' }, 400);
    }
  }

  // Generic errors
  const message = err instanceof Error ? err.message : 'Internal server error';
  console.error('[error]', err);

  const body: ApiResponse = {
    success: false,
    error:   isDev ? message : 'Internal server error',
    ...(isDev && err instanceof Error && { stack: err.stack }),
  };

  return c.json(body, 500);
}
