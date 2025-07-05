import type { Queue } from "@cloudflare/workers-types";

export interface Env {
  VECTORIZE_PROD?: VectorizeIndex;
  VECTORIZE_DEV?: VectorizeIndex;
  DB: D1Database;
  OPENAI_API_KEY: string;
  GITHUB_TOKEN?: string;
  DISCOURSE_API_KEY?: string;
  LOG_LEVEL: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_AI_GATEWAY_ID?: string;
  CLOUDFLARE_ADMIN_DASHBOARD_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  GOOGLE_JWT_SECRET?: string;
  ADMIN_EMAILS?: string;
  DISABLE_ADMIN_AUTH_FOR_LOCAL_DEV?: string;
  ENABLE_WEB_SEARCH_FALLBACK?: string;
  ENVIRONMENT: string;
  JOB_QUEUE: Queue;
}
