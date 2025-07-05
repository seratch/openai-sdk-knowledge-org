import { Context } from "hono";

import { Logger } from "@/logger";

export interface APIError {
  code: string;
  message: string;
  details?: any;
  statusCode: number;
}

export class ValidationError extends Error implements APIError {
  code = "VALIDATION_ERROR";
  statusCode = 400;
  details?: any;

  constructor(message: string, details?: any) {
    super(message);
    this.details = details;
  }
}

export class NotFoundError extends Error implements APIError {
  code = "NOT_FOUND";
  statusCode = 404;
  message = "Resource not found";
}

export class RateLimitError extends Error implements APIError {
  code = "RATE_LIMIT_EXCEEDED";
  statusCode = 429;
  message = "Rate limit exceeded";
}

export class InternalServerError extends Error implements APIError {
  code = "INTERNAL_SERVER_ERROR";
  statusCode = 500;
  message = "Internal server error";
}

export function handleError(error: Error, c: Context) {
  const requestId =
    c.req.header("X-Request-ID") || Math.random().toString(36).substring(7);

  Logger.error("API Error", {
    requestId,
    error: error.message,
    stack: error.stack,
    path: c.req.path,
    method: c.req.method,
  });

  if (error instanceof ValidationError) {
    return c.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId,
        },
      },
      400,
    );
  }

  if (error instanceof NotFoundError) {
    return c.json(
      {
        error: {
          code: error.code,
          message: error.message,
          requestId,
        },
      },
      404,
    );
  }

  if (error instanceof RateLimitError) {
    return c.json(
      {
        error: {
          code: error.code,
          message: error.message,
          requestId,
        },
      },
      429,
    );
  }

  return c.json(
    {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred",
        requestId,
      },
    },
    500,
  );
}

export function errorHandler() {
  return async (c: Context, next: any) => {
    try {
      await next();
    } catch (error) {
      return handleError(error as Error, c);
    }
  };
}
