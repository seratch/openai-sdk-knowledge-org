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
import { buildOpenAIModelProviderForOnlineAccess } from "@/oepnai-client";
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

export const app = new Hono<{ Bindings: Env }>();

app.use("*", logger());
app.use("*", errorHandler());

app.use("*", async (c: Context<{ Bindings: Env }>, next) => {
  setDefaultOpenAITracingExporter();
  setTracingExportApiKey(c.env.OPENAI_API_KEY);

  if (c.env.CLOUDFLARE_ACCOUNT_ID && c.env.CLOUDFLARE_AI_GATEWAY_ID) {
    setDefaultModelProvider(buildOpenAIModelProviderForOnlineAccess(c.env));
  } else {
    setDefaultOpenAIKey(c.env.OPENAI_API_KEY);
  }
  await next();
});

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

app.use("*", async (c: Context<{ Bindings: Env }>, next) => {
  const logLevel = c.env.LOG_LEVEL || "info";
  Logger.setLogLevel(logLevel as any);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("X-XSS-Protection", "1; mode=block");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  await next();
});

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
// Auth routes
// --------------------

app.get("/auth/login", authLoginHandler);
app.get("/auth/callback", authCallbackHandler);
app.get("/auth/logout", authLogoutHandler);

// --------------------
// MCP routes
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
// --------------------

export const api = new Hono();

api.use("*", errorHandler());
api.use("*", rateLimit(60));

api.post("/query", validateRequest(querySchema), webappQueryHandler);

api.get("/tokens", requireAuth, getTokensHandler);
api.post("/tokens", requireAuth, tokenCreationHandler);
api.delete("/tokens/:tokenId", requireAuth, tokenDeletionHandler);

// --------------------
// Admin API endpoint routes
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

// Registering api routes to the root one
// Add /api/* routes before this line
app.route("/api", api);
