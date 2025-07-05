CREATE TABLE IF NOT EXISTS collection_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL, -- 'github' or 'forum'
  status TEXT NOT NULL, -- 'running', 'completed', 'failed', 'cancelled'
  current_phase TEXT, -- 'collecting_forum', 'collecting_github', 'processing', 'storing'
  progress_message TEXT, -- detailed progress description
  documents_collected INTEGER DEFAULT 0,
  documents_processed INTEGER DEFAULT 0,
  total_estimated INTEGER DEFAULT 0,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS query_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  results_count INTEGER DEFAULT 0,
  response_time_ms INTEGER,
  search_type TEXT,
  vector_time_ms INTEGER,
  keyword_time_ms INTEGER,
  cache_hit BOOLEAN DEFAULT FALSE,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_query_stats_created_at ON query_stats(created_at);

CREATE TABLE IF NOT EXISTS job_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  payload TEXT NOT NULL,
  collection_run_id INTEGER,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  error_message TEXT,
  FOREIGN KEY (collection_run_id) REFERENCES collection_runs(id)
);

CREATE TABLE IF NOT EXISTS work_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_run_id INTEGER NOT NULL,
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  status TEXT NOT NULL,
  source_data TEXT NOT NULL,
  processed_data TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  processed_at TEXT,
  error_message TEXT,
  FOREIGN KEY (collection_run_id) REFERENCES collection_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_job_queue_status_priority ON job_queue(status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_job_queue_collection_run ON job_queue(collection_run_id);
CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(status);
CREATE INDEX IF NOT EXISTS idx_work_items_collection_run ON work_items(collection_run_id);

CREATE TABLE IF NOT EXISTS collection_timestamps (
  source TEXT PRIMARY KEY,
  last_successful_collection TEXT NOT NULL,
  etag TEXT,
  last_modified TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_query_stats_query ON query_stats(query);
CREATE INDEX IF NOT EXISTS idx_query_stats_response_time ON query_stats(response_time_ms);
CREATE INDEX IF NOT EXISTS idx_query_stats_search_type ON query_stats(search_type, response_time_ms);
CREATE INDEX IF NOT EXISTS idx_query_stats_performance ON query_stats(created_at, search_type, cache_hit);


CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  last_used_at TEXT,
  is_revoked BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_user_email ON api_tokens(user_email);
CREATE INDEX IF NOT EXISTS idx_api_tokens_token_hash ON api_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_api_tokens_is_revoked ON api_tokens(is_revoked);

CREATE TABLE IF NOT EXISTS mcp_clients (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  client_secret_hash TEXT NOT NULL,
  client_name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  scopes TEXT NOT NULL,
  user_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_mcp_clients_user_email ON mcp_clients(user_email);
CREATE INDEX IF NOT EXISTS idx_mcp_clients_client_id ON mcp_clients(client_id);

CREATE TABLE IF NOT EXISTS mcp_authorization_codes (
  code TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scopes TEXT NOT NULL,
  code_challenge TEXT,
  code_challenge_method TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT,
  FOREIGN KEY (client_id) REFERENCES mcp_clients(client_id)
);

CREATE INDEX IF NOT EXISTS idx_mcp_auth_codes_expires ON mcp_authorization_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_mcp_auth_codes_client ON mcp_authorization_codes(client_id);
