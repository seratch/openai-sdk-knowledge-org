// Main Hono web application setup and routing
// Hono is a lightweight, fast web framework for Cloudflare Workers
// Documentation: https://hono.dev/

import { Context, Hono } from "hono";
import { errorHandler } from "./middleware/error-handler";
import { rateLimit } from "./middleware/rate-limit";
import {
  collectSchema,
  querySchema,
  validateRequest,
} from "./middleware/validation";
import {
  tokenDeletionHandler,
  getTokensHandler,
  healthHandler,
  tokenCreationHandler,
  webappQueryHandler,
} from "./handlers/api-handlers";
import {
  requireAdminAuth,
  requireApiToken,
  requireAuth,
} from "./middleware/auth";
import {
  adminApiCollectHanlder,
  adminApiGetCollectionRunDetailsHandler,
  adminApiGetCollectionRunsHandler,
  adminApiGetCollectStatusHandler,
  adminApiGetHealthHandler,
  adminApiGetJobQueueHandler,
} from "./handlers/admin-api-handlers";
import {
  adminPageHandler,
  myPageHandler,
  topPageHandler,
} from "./handlers/webapp-handlers";
import { Env } from "@/env";
import {
  setDefaultModelProvider,
  setDefaultOpenAITracingExporter,
} from "@openai/agents";
import {
  setDefaultOpenAIKey,
  setTracingExportApiKey,
} from "@openai/agents-openai";
import { buildOpenAIModelProviderForOnlineAccess } from "@/openai-client";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { Logger } from "@/logger";
import {
  authCallbackHandler,
  authLoginHandler,
  authLogoutHandler,
} from "./handlers/auth-handlers";
import {
  mcpOAuthAuthorizeHandler,
  mcpOAuthConsentHandler,
  mcpOAuthRegisterHandler,
  mcpOAuthTokenHandler,
  mcpOtherMethodsHandler,
  mcpServerHandler,
  mcpWellKnownHandler,
} from "./handlers/mcp-handlers";

// Main Hono application instance with environment bindings
// Hono Getting Started: https://hono.dev/getting-started/cloudflare-workers
// Hono Routing: https://hono.dev/api/routing
export const app = new Hono<{ Bindings: Env }>();

// Global middleware setup
// Hono Middleware: https://hono.dev/middleware/builtin/logger

// Built-in Hono logger middleware for request/response logging
app.use("*", logger());
// Custom error handling middleware
app.use("*", errorHandler());

// OpenAI Agents SDK setup middleware
// Configure tracing and model provider for each request
app.use("*", async (c: Context<{ Bindings: Env }>, next) => {
  // Enable OpenAI Agents SDK tracing for observability
  setDefaultOpenAITracingExporter();
  setTracingExportApiKey(c.env.OPENAI_API_KEY);

  // Use Cloudflare AI Gateway if configured, otherwise direct OpenAI access
  // AI Gateway: https://developers.cloudflare.com/ai-gateway/
  if (c.env.CLOUDFLARE_ACCOUNT_ID && c.env.CLOUDFLARE_AI_GATEWAY_ID) {
    setDefaultModelProvider(buildOpenAIModelProviderForOnlineAccess(c.env));
  } else {
    setDefaultOpenAIKey(c.env.OPENAI_API_KEY);
  }
  await next();
});

// CORS middleware for cross-origin requests
// Hono CORS: https://hono.dev/middleware/builtin/cors
app.use(
  "*",
  cors({
    origin: ["http://localhost:8787", "https://localhost:8787"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "X-Request-ID",
    ],
    credentials: true,
  }),
);

// Security headers and logging configuration middleware
app.use("*", async (c: Context<{ Bindings: Env }>, next) => {
  const logLevel = c.env.LOG_LEVEL || "info";
  Logger.setLogLevel(logLevel as any);

  // Security headers to protect against common attacks
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("X-XSS-Protection", "1; mode=block");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  await next();
});

// Health check endpoint
app.get("/health", healthHandler);

// --------------------
// Web app routes
// --------------------

app.get("/", topPageHandler);
app.get("/mypage", requireAuth, myPageHandler);

// --------------------
// Admin page routes
// --------------------

app.get("/admin", requireAdminAuth, adminPageHandler);

// --------------------
// Authentication routes
// Google OAuth integration for user authentication
// --------------------

app.get("/auth/login", authLoginHandler);
app.get("/auth/callback", authCallbackHandler);
app.get("/auth/logout", authLogoutHandler);

// --------------------
// MCP (Model Context Protocol) routes
// OAuth 2.0 server implementation for MCP client authorization
// MCP OAuth: https://spec.modelcontextprotocol.io/specification/authentication/
// --------------------

app.get("/.well-known/oauth-authorization-server", mcpWellKnownHandler);
app.get("/mcp", mcpOtherMethodsHandler);
app.delete("/mcp", mcpOtherMethodsHandler);
app.post("/mcp", requireApiToken, mcpServerHandler);

app.get("/mcp/oauth/authorize", mcpOAuthAuthorizeHandler);
app.post("/mcp/oauth/token", mcpOAuthTokenHandler);
app.post("/mcp/oauth/authorize/consent", requireAuth, mcpOAuthConsentHandler);
app.post("/mcp/oauth/register", mcpOAuthRegisterHandler);

// --------------------
// API endpoint routes
// Sub-application for REST API endpoints with separate middleware
// --------------------

export const api = new Hono();

// API-specific middleware
api.use("*", errorHandler());
api.use("*", rateLimit(60)); // 60 requests per minute rate limit

// Public API endpoints
api.post("/query", validateRequest(querySchema), webappQueryHandler);

// User token management endpoints
api.get("/tokens", requireAuth, getTokensHandler);
api.post("/tokens", requireAuth, tokenCreationHandler);
api.delete("/tokens/:tokenId", requireAuth, tokenDeletionHandler);

// --------------------
// Admin API endpoint routes
// Administrative endpoints for data collection and monitoring
// --------------------

api.post(
  "/admin/collect",
  requireAdminAuth,
  validateRequest(collectSchema),
  adminApiCollectHanlder,
);

api.get(
  "/admin/collect/status/:runId?",
  requireAdminAuth,
  adminApiGetCollectStatusHandler,
);

api.get("/admin/health", requireAdminAuth, adminApiGetHealthHandler);

api.get(
  "/admin/collection-runs",
  requireAdminAuth,
  adminApiGetCollectionRunsHandler,
);

api.get(
  "/admin/collection-runs/:id",
  requireAdminAuth,
  adminApiGetCollectionRunDetailsHandler,
);

api.get("/admin/job-queue", requireAdminAuth, adminApiGetJobQueueHandler);

// Mount API sub-application under /api prefix
// Hono Sub App: https://hono.dev/api/routing#sub-app
// Add /api/* routes before this line
app.route("/api", api);
