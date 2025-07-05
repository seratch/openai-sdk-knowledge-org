import { Context, Next } from "hono";

import { RateLimiter } from "@/rate-limiter";

const rateLimiters = new Map<string, RateLimiter>();

export function rateLimit(requestsPerMinute: number = 60) {
  return async (c: Context, next: Next) => {
    const clientIP =
      c.req.header("CF-Connecting-IP") ||
      c.req.header("X-Forwarded-For") ||
      c.req.header("X-Real-IP") ||
      "unknown";

    const key = `${clientIP}:${requestsPerMinute}`;

    if (!rateLimiters.has(key)) {
      rateLimiters.set(
        key,
        new RateLimiter({
          requestsPerMinute: requestsPerMinute,
          retryAttempts: 3,
          baseDelayMs: 1000,
        }),
      );
    }

    const limiter = rateLimiters.get(key)!;

    try {
      await limiter.executeWithRateLimit(async () => {
        return Promise.resolve();
      });

      c.header("X-RateLimit-Limit", requestsPerMinute.toString());
      c.header("X-RateLimit-Remaining", (requestsPerMinute - 1).toString());

      await next();
    } catch (error) {
      c.header("X-RateLimit-Limit", requestsPerMinute.toString());
      c.header("X-RateLimit-Remaining", "0");
      c.header("Retry-After", "60");

      return c.json(
        {
          error: "Rate limit exceeded",
          message: `Too many requests. Limit: ${requestsPerMinute} requests per minute.`,
          retryAfter: 60,
        },
        429,
      );
    }
  };
}
