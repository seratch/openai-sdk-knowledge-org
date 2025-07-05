import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

export const apiTokens = sqliteTable("api_tokens", {
  id: text("id").primaryKey(),
  userEmail: text("user_email").notNull(),
  tokenHash: text("token_hash").notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at"),
  lastUsedAt: text("last_used_at"),
  isRevoked: integer("is_revoked", { mode: "boolean" })
    .notNull()
    .default(false),
});

export const jobQueue = sqliteTable("job_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobType: text("job_type").notNull(),
  status: text("status").notNull(),
  priority: integer("priority").notNull().default(0),
  payload: text("payload").notNull(),
  collectionRunId: integer("collection_run_id"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  errorMessage: text("error_message"),
});

export const workItems = sqliteTable("work_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  collectionRunId: integer("collection_run_id").notNull(),
  itemType: text("item_type").notNull(),
  itemId: text("item_id").notNull(),
  status: text("status").notNull(),
  sourceData: text("source_data").notNull(),
  processedData: text("processed_data"),
  retryCount: integer("retry_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
  processedAt: text("processed_at"),
  errorMessage: text("error_message"),
});

export const collectionRuns = sqliteTable("collection_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  status: text("status").notNull(),
  currentPhase: text("current_phase"),
  progressMessage: text("progress_message"),
  documentsCollected: integer("documents_collected").default(0),
  documentsProcessed: integer("documents_processed").default(0),
  totalEstimated: integer("total_estimated").default(0),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  errorMessage: text("error_message"),
});

export const queryStats = sqliteTable("query_stats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  query: text("query").notNull(),
  resultsCount: integer("results_count").default(0),
  responseTimeMs: integer("response_time_ms"),
  searchType: text("search_type"),
  vectorTimeMs: integer("vector_time_ms"),
  keywordTimeMs: integer("keyword_time_ms"),
  cacheHit: integer("cache_hit", { mode: "boolean" }).default(false),
  createdAt: text("created_at").notNull(),
});

export const collectionTimestamps = sqliteTable("collection_timestamps", {
  source: text("source").primaryKey(),
  lastSuccessfulCollection: text("last_successful_collection").notNull(),
  etag: text("etag"),
  lastModified: text("last_modified"),
  updatedAt: text("updated_at").default("CURRENT_TIMESTAMP"),
});

export const mcpClients = sqliteTable("mcp_clients", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  clientSecretHash: text("client_secret_hash").notNull(),
  clientName: text("client_name").notNull(),
  redirectUris: text("redirect_uris").notNull(),
  scopes: text("scopes").notNull(),
  userEmail: text("user_email").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").default("CURRENT_TIMESTAMP"),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
});

export const mcpAuthorizationCodes = sqliteTable("mcp_authorization_codes", {
  code: text("code").primaryKey(),
  clientId: text("client_id").notNull(),
  userEmail: text("user_email").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  scopes: text("scopes").notNull(),
  codeChallenge: text("code_challenge"),
  codeChallengeMethod: text("code_challenge_method"),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
  usedAt: text("used_at"),
});
