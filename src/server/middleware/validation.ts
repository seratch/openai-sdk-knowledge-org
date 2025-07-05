import { Context, Next } from "hono";
import { z } from "zod";

export const querySchema = z.object({
  query: z.string().min(1).max(1000),
  includeHistory: z.boolean().optional(),
  maxResults: z.number().min(1).max(50).optional(),
});

export const collectSchema = z.object({
  source: z.enum(["github", "discourse", "forum"]),
  url: z.string().url(),
  category: z.string().optional(),
  maxPages: z.number().min(1).max(50).optional(),
});

export const searchSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().min(1).max(100).optional(),
  threshold: z.number().min(0).max(1).optional(),
  searchType: z.enum(["search", "hybrid"]).optional(),
});

export function validateRequest<T>(schema: z.ZodSchema<T>) {
  return async (c: Context, next: Next) => {
    try {
      const body = await c.req.json();
      const validatedData = schema.parse(body);
      c.set("validatedData", validatedData);
      await next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json(
          {
            error: "Validation failed",
            details: error.errors.map((e) => ({
              field: e.path.join("."),
              message: e.message,
            })),
          },
          400,
        );
      }
      return c.json({ error: "Invalid request body" }, 400);
    }
  };
}

export function validateQuery() {
  return async (c: Context, next: Next) => {
    const query = c.req.query("q");
    const limit = c.req.query("limit");
    const threshold = c.req.query("threshold");

    if (!query || query.length === 0) {
      return c.json({ error: 'Query parameter "q" is required' }, 400);
    }

    if (query.length > 500) {
      return c.json({ error: "Query too long (max 500 characters)" }, 400);
    }

    if (
      limit &&
      (isNaN(Number(limit)) || Number(limit) < 1 || Number(limit) > 100)
    ) {
      return c.json({ error: "Limit must be between 1 and 100" }, 400);
    }

    if (
      threshold &&
      (isNaN(Number(threshold)) ||
        Number(threshold) < 0 ||
        Number(threshold) > 1)
    ) {
      return c.json({ error: "Threshold must be between 0 and 1" }, 400);
    }

    await next();
  };
}
