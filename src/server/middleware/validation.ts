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

