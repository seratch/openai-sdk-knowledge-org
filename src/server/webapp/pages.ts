import type { AuthUser } from "@/server/middleware/auth";
import type { Env } from "@/env";

interface PageOptions {
  title: string;
  body: string;
  styles?: string;
  script?: string;
}

function renderPage({
  title,
  body,
  styles = "",
  script = "",
}: PageOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="robots" content="noai, noimageai">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="icon" href="/favicon.ico" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/site.webmanifest" />
  ${styles ? `<style>${styles}</style>` : ""}
</head>
<body>
${body}
${script ? `<script>${script}</script>` : ""}
</body>
</html>`;
}

const TOKEN_MODAL_CSS = `
        .token-modal {
            display: none;
            position: fixed;
            z-index: 2000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.5);
        }
        .token-modal-content {
            background-color: white;
            margin: 10% auto;
            padding: 30px;
            border-radius: 8px;
            width: 90%;
            max-width: 600px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        }
        .token-display {
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 4px;
            padding: 15px;
            margin: 15px 0;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 14px;
            word-break: break-all;
            user-select: all;
        }
        .copy-button {
            background: #28a745;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            margin-right: 10px;
            font-weight: bold;
        }
        .copy-button:hover {
            background: #218838;
        }
        .close-modal-button {
            background: #6c757d;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
        }
        .close-modal-button:hover {
            background: #5a6268;
        }
`;

export interface OAuthAuthorizePageOptions {
  clientId: string;
  redirectUri: string;
  scope?: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  clientName: string;
  user: AuthUser;
  scopes: string[];
}

export function renderOAuthAuthorizePage(options: OAuthAuthorizePageOptions) {
  const {
    clientId,
    redirectUri,
    scope,
    state,
    codeChallenge,
    codeChallengeMethod,
    clientName,
    user,
    scopes,
  } = options;
  const styles = `
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background: #f5f5f5; }
          .card { background: white; border-radius: 8px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .btn { padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin: 10px 5px; }
          .btn-primary { background: #667eea; color: white; }
          .btn-secondary { background: #6c757d; color: white; }
          .scopes { background: #f8f9fa; padding: 15px; border-radius: 4px; margin: 15px 0; }
  `;

  const body = `
        <div class="card">
          <h2>🔐 Authorize MCP Client</h2>
          <p><strong>${clientName}</strong> is requesting access to your OpenAI SDK Knowledge MCP server.</p>

          <div class="scopes">
            <h4>Requested Permissions:</h4>
            <ul>
              ${scopes.map((s) => `<li><code>${s}</code></li>`).join("")}
            </ul>
          </div>

          <p><strong>User:</strong> ${user.name} (${user.email})</p>
          <p><strong>Client:</strong> ${clientName}</p>

          <form method="POST" action="/mcp/oauth/authorize/consent">
            <input type="hidden" name="client_id" value="${clientId}" />
            <input type="hidden" name="redirect_uri" value="${redirectUri}" />
            <input type="hidden" name="scope" value="${scope || "mcp:read"}" />
            <input type="hidden" name="state" value="${state || ""}" />
            <input type="hidden" name="code_challenge" value="${codeChallenge || ""}" />
            <input type="hidden" name="code_challenge_method" value="${codeChallengeMethod || ""}" />

          <button type="submit" name="action" value="allow" class="btn btn-primary">✅ Allow Access</button>
          <button type="submit" name="action" value="deny" class="btn btn-secondary">❌ Deny Access</button>
        </form>
      </div>`;

  return renderPage({ title: "Authorize MCP Client", body, styles });
}

export function renderAdminInterface(user?: AuthUser, env?: Env): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="robots" content="noai, noimageai">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Dashboard - OpenAI SDK Knowledge MCP</title>
    <link rel="icon" href="/favicon.ico" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f5;
            color: #333;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            text-align: center;
        }
        .nav {
            background: white;
            padding: 15px 0;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 20px;
        }
        .nav-container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 0 20px;
            position: relative;
        }
        .menu-toggle {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 16px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 500;
            transition: background-color 0.2s ease;
        }
        .menu-toggle:hover {
            background: #5a67d8;
        }
        .hamburger-line {
            width: 18px;
            height: 2px;
            background: white;
            display: block;
            margin: 2px 0;
            transition: 0.3s;
        }
        .menu-text {
            font-size: 14px;
        }
        .menu-dropdown {
            position: absolute;
            top: 100%;
            left: 20px;
            background: white;
            border: 1px solid #e9ecef;
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 1000;
            min-width: 280px;
            padding: 12px 0;
        }
        .menu-section {
            padding: 8px 0;
            border-bottom: 1px solid #f1f3f4;
        }
        .menu-section:last-child {
            border-bottom: none;
        }
        .menu-section-title {
            display: block;
            padding: 8px 16px 4px;
            font-size: 0.85em;
            font-weight: 600;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .menu-dropdown a {
            display: block;
            padding: 8px 16px;
            color: #667eea;
            text-decoration: none;
            font-weight: 500;
            transition: background-color 0.2s ease;
        }
        .menu-dropdown a:hover {
            background: #f8f9fa;
            color: #5a67d8;
        }
        .dashboard {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
        }
        .card {
            background: white;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .card h3 {
            margin-bottom: 15px;
            color: #333;
        }
        .metric {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
            padding: 8px 0;
            border-bottom: 1px solid #eee;
        }
        .metric:last-child { border-bottom: none; }
        .status-healthy { color: #28a745; }
        .status-warning { color: #ffc107; }
        .status-error { color: #dc3545; }
        ${TOKEN_MODAL_CSS}
    </style>
    </head>
    <body>
      <div class="header">
        <h1>Admin Dashboard</h1>
        <p>System monitoring and management</p>
        ${
          user
            ? `
        <div style="position: absolute; top: 20px; right: 20px; color: rgba(255,255,255,0.9); font-size: 0.9em;">
            <span>Welcome, ${user.name} (${user.email})</span>
            <a href="/auth/logout" style="margin-left: 15px; color: rgba(255,255,255,0.7); text-decoration: none;">Logout</a>
        </div>
        `
            : ""
        }
    </div>

    <div class="nav">
        <div class="nav-container">
            <button id="menuToggle" class="menu-toggle" onclick="toggleMenu()">
                <span class="menu-text">🍔 Menu</span>
            </button>

            <div id="menuDropdown" class="menu-dropdown" style="display: none;">
                <div class="menu-section">
                    <span class="menu-section-title">Navigation</span>
                    <a href="/">← Back to App</a>
                </div>

                <div class="menu-section">
                    <span class="menu-section-title">Data Management</span>
                    ${env?.CLOUDFLARE_ADMIN_DASHBOARD_URL ? `<a href="${env.CLOUDFLARE_ADMIN_DASHBOARD_URL}" target="_blank">☁️ Cloudflare Dashboard</a>` : ""}
                    <a href="#" onclick="showCollectionRuns()">🔄 Collection Runs</a>
                </div>

                <div class="menu-section">
                    <span class="menu-section-title">System Operations</span>
                    <a href="#" onclick="showJobQueue()">⚡ Job Queue</a>
                    <a href="/api/admin/health" target="_blank">🏥 Health Check</a>
                </div>
            </div>
        </div>
    </div>

    <div id="dashboard" class="dashboard">
        <div class="card">
            <h3>Collection Jobs</h3>
            <div id="collectionJobs">Loading...</div>
            <div style="margin-top: 10px;">
                <input type="url" id="githubUrl" placeholder="https://github.com/openai/openai-node" style="width: 100%; padding: 8px; margin-bottom: 10px; border: 1px solid #ddd; border-radius: 4px;" />
                <div style="display: flex; gap: 10px;">
                    <button id="collectGithubBtn" onclick="collectFromGithub()" style="flex: 1; padding: 8px 16px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">📁 Collect GitHub Repo</button>
                    <button id="collectForumBtn" onclick="collectFromForum()" style="flex: 1; padding: 8px 16px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">💬 Collect Forums</button>
                </div>
            </div>
        </div>

        <div class="card">
            <h3>Collection Runs</h3>
            <div id="collectionRuns">Loading...</div>
            <button onclick="showCollectionRuns()" style="margin-top: 10px; padding: 8px 16px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer;">View All Runs</button>
        </div>

        <div class="card">
            <h3>Job Queue</h3>
            <div id="jobQueue">Loading...</div>
            <button onclick="showJobQueue()" style="margin-top: 10px; padding: 8px 16px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer;">View Queue</button>
        </div>
    </div>

    <!-- Token Display Modal -->
    <div id="tokenModal" class="token-modal">
        <div class="token-modal-content">
            <h3>🔑 API Token Generated Successfully</h3>
            <p>Your new API token has been created. <strong>Save this token securely - it won't be shown again.</strong></p>
            <div id="tokenDisplay" class="token-display"></div>
            <div style="margin-top: 20px;">
                <button id="copyTokenButton" class="copy-button" onclick="copyTokenToClipboard()">📋 Copy Token</button>
                <button class="close-modal-button" onclick="closeTokenModal()">Close</button>
            </div>
        </div>
    </div>

    <!-- Document List View -->
    <div id="documentListView" style="display: none; max-width: 1200px; margin: 20px auto; padding: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2>Indexed Documents</h2>
            <button onclick="showDashboard()" style="padding: 8px 16px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">← Back to Dashboard</button>
        </div>

        <div style="margin-bottom: 20px;">
            <input type="text" id="searchInput" placeholder="Search documents..." style="padding: 8px; width: 300px; border: 1px solid #ddd; border-radius: 4px;">
            <button onclick="searchDocuments()" style="margin-left: 10px; padding: 8px 16px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer;">Search</button>
            <button onclick="clearSearch()" style="margin-left: 5px; padding: 8px 16px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">Clear</button>
        </div>

        <div id="documentsList">Loading...</div>
        <div id="pagination" style="margin-top: 20px; text-align: center;"></div>
    </div>


    <!-- Collection Runs View -->
    <div id="collectionRunsView" style="display: none; max-width: 1200px; margin: 20px auto; padding: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2>Collection Runs</h2>
            <button onclick="showDashboard()" style="padding: 8px 16px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">← Back to Dashboard</button>
        </div>

        <div style="margin-bottom: 20px;">
            <select id="statusFilter" onchange="filterCollectionRuns()" style="padding: 8px; margin-right: 10px; border: 1px solid #ddd; border-radius: 4px;">
                <option value="">All Statuses</option>
                <option value="running">Running</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
            </select>
            <button onclick="refreshCollectionRuns()" style="padding: 8px 16px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer;">Refresh</button>
        </div>

        <div id="collectionRunsList">Loading...</div>
        <div id="collectionRunsPagination" style="margin-top: 20px; text-align: center;"></div>
    </div>

    <!-- Collection Run Detail View -->
    <div id="collectionRunDetailView" style="display: none; max-width: 1200px; margin: 20px auto; padding: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2>Collection Run Details</h2>
            <button onclick="showCollectionRuns()" style="padding: 8px 16px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">← Back to List</button>
        </div>
        <div id="collectionRunDetail">Loading...</div>
    </div>

    <!-- Job Queue View -->
    <div id="jobQueueView" style="display: none; max-width: 1200px; margin: 20px auto; padding: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2>Job Queue</h2>
            <button onclick="showDashboard()" style="padding: 8px 16px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">← Back to Dashboard</button>
        </div>

        <div style="margin-bottom: 20px;">
            <select id="jobStatusFilter" onchange="filterJobQueue()" style="padding: 8px; margin-right: 10px; border: 1px solid #ddd; border-radius: 4px;">
                <option value="">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="running">Running</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
            </select>
            <button onclick="refreshJobQueue()" style="padding: 8px 16px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer;">Refresh</button>
        </div>

        <div id="jobQueueStats" style="margin-bottom: 20px;"></div>
        <div id="jobQueueList">Loading...</div>
    </div>

    <script>
        async function loadMetrics() {
            try {
                const [health, collectStatus] = await Promise.all([
                    fetch('/api/admin/health').then(r => r.json()),
                    fetch('/api/admin/collect/status').then(r => r.json())
                ]);

                document.getElementById('collectionJobs').innerHTML = \`
                    <div class="metric">
                        <span>Status:</span>
                        <span class="status-\${collectStatus.isRunning ? 'warning' : 'healthy'}">\${collectStatus.isRunning ? 'Running' : 'Idle'}</span>
                    </div>
                    <div class="metric">
                        <span>Total Collected:</span>
                        <span>\${collectStatus.totalCollected}</span>
                    </div>
                    <div class="metric">
                        <span>Recent Jobs:</span>
                        <span>\${collectStatus.recentRuns.length}</span>
                    </div>
                \`;

                const githubBtn = document.getElementById('collectGithubBtn');
                const forumBtn = document.getElementById('collectForumBtn');
                if (githubBtn && forumBtn) {
                    const isRunning = collectStatus.isRunning;
                    githubBtn.disabled = isRunning;
                    forumBtn.disabled = isRunning;
                    if (isRunning) {
                        githubBtn.textContent = '⏳ Job Running...';
                        forumBtn.textContent = '⏳ Job Running...';
                    } else {
                        githubBtn.textContent = '📁 Collect GitHub Repo';
                        forumBtn.textContent = '💬 Collect Forums';
                    }
                }

                loadCollectionRuns();
                loadJobQueue();
            } catch (error) {
                console.error('Failed to load metrics:', error);
            }
        }

        let currentPage = 1;
        let currentSearch = '';

        function showDashboard() {
            document.getElementById('dashboard').style.display = 'grid';
            document.getElementById('collectionRunsView').style.display = 'none';
            document.getElementById('collectionRunDetailView').style.display = 'none';
            document.getElementById('jobQueueView').style.display = 'none';
        }


        function showCollectionRuns() {
            document.getElementById('dashboard').style.display = 'none';
            document.getElementById('collectionRunsView').style.display = 'block';
            document.getElementById('collectionRunDetailView').style.display = 'none';
            document.getElementById('jobQueueView').style.display = 'none';
            loadCollectionRunsList(1, '');
        }

        function showJobQueue() {
            document.getElementById('dashboard').style.display = 'none';
            document.getElementById('collectionRunsView').style.display = 'none';
            document.getElementById('collectionRunDetailView').style.display = 'none';
            document.getElementById('jobQueueView').style.display = 'block';
            loadJobQueueList('');
        }


        async function loadDocuments(page = 1, search = '') {
            try {
                currentPage = page;
                currentSearch = search;
                const url = \`/api/admin/documents?page=\${page}&limit=20&search=\${encodeURIComponent(search)}\`;
                const response = await fetch(url);
                const data = await response.json();

                const documentsHtml = data.documents.map(doc => \`
                    <div class="card" style="margin-bottom: 15px;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                            <div style="flex: 1;">
                                <h4 style="margin: 0 0 10px 0; color: #333;">\${doc.metadata.title || doc.id}</h4>
                                <p style="margin: 0 0 10px 0; color: #666; font-size: 0.9em;">\${doc.content_preview}</p>
                                <div style="font-size: 0.8em; color: #888;">
                                    <div>Source: <a href="\${doc.source_url}" target="_blank" style="color: #667eea;">\${doc.source_url}</a></div>
                                    <div>Created: \${new Date(doc.created_at).toLocaleString()}</div>
                                    <div>Updated: \${new Date(doc.updated_at).toLocaleString()}</div>
                                </div>
                            </div>
                            <button onclick="showDocumentDetail('\${doc.id}')" style="padding: 6px 12px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer; margin-left: 15px;">View Details</button>
                        </div>
                    </div>
                \`).join('');

                document.getElementById('documentsList').innerHTML = documentsHtml || '<p>No documents found.</p>';

                const paginationHtml = \`
                    <div>
                        \${data.pagination.hasPrev ? \`<button onclick="loadDocuments(\${data.pagination.page - 1}, '\${currentSearch}')" style="margin: 0 5px; padding: 6px 12px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer;">Previous</button>\` : ''}
                        <span style="margin: 0 15px;">Page \${data.pagination.page} of \${data.pagination.totalPages} (\${data.pagination.total} total)</span>
                        \${data.pagination.hasNext ? \`<button onclick="loadDocuments(\${data.pagination.page + 1}, '\${currentSearch}')" style="margin: 0 5px; padding: 6px 12px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer;">Next</button>\` : ''}
                    </div>
                \`;
                document.getElementById('pagination').innerHTML = paginationHtml;

            } catch (error) {
                console.error('Error loading documents:', error);
                document.getElementById('documentsList').innerHTML = '<p>Unable to load documents. Please try again.</p>';
            }
        }

        async function loadCollectionRuns() {
            try {
                const response = await fetch('/api/admin/collection-runs?limit=5');
                const data = await response.json();

                document.getElementById('collectionRuns').innerHTML = \`
                    <div class="metric">
                        <span>Total Runs:</span>
                        <span>\${data.pagination.total}</span>
                    </div>
                    <div class="metric">
                        <span>Recent:</span>
                        <span>\${data.runs.slice(0, 3).map(run => \`\${run.source} (\${run.status})\`).join(', ')}</span>
                    </div>
                \`;
            } catch (error) {
                document.getElementById('collectionRuns').innerHTML = '<div class="status-error">Unable to load data. Please refresh the page.</div>';
            }
        }

        async function loadJobQueue() {
            try {
                const response = await fetch('/api/admin/job-queue?limit=20');
                const data = await response.json();

                const statusCounts = {};
                data.stats.forEach(stat => {
                    statusCounts[stat.status] = stat.count;
                });

                document.getElementById('jobQueue').innerHTML = \`
                    <div class="metric">
                        <span>Pending:</span>
                        <span class="status-\${statusCounts.pending > 0 ? 'warning' : 'healthy'}">\${statusCounts.pending || 0}</span>
                    </div>
                    <div class="metric">
                        <span>Running:</span>
                        <span class="status-\${statusCounts.running > 0 ? 'warning' : 'healthy'}">\${statusCounts.running || 0}</span>
                    </div>
                    <div class="metric">
                        <span>Completed:</span>
                        <span>\${statusCounts.completed || 0}</span>
                    </div>
                \`;
            } catch (error) {
                document.getElementById('jobQueue').innerHTML = '<div class="status-error">Unable to load data. Please refresh the page.</div>';
            }
        }

        async function loadCollectionRunsList(page = 1, status = '') {
            try {
                const params = new URLSearchParams({ page: page.toString(), limit: '20' });
                if (status) params.append('status', status);

                const response = await fetch(\`/api/admin/collection-runs?\${params}\`);
                const data = await response.json();

                const runsHtml = data.runs.map(run => \`
                    <div style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 15px; margin-bottom: 10px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                            <h4>Run #\${run.id} - \${run.source}</h4>
                            <span class="status-\${run.status === 'completed' ? 'healthy' : run.status === 'failed' ? 'error' : 'warning'}">\${run.status}</span>
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; font-size: 0.9em;">
                            <div><strong>Phase:</strong> \${run.currentPhase || 'N/A'}</div>
                            <div><strong>Collected:</strong> \${run.documents_collected || 0}</div>
                            <div><strong>Processed:</strong> \${run.documents_processed || 0}</div>
                            <div><strong>Started:</strong> \${new Date(run.startedAt).toLocaleString()}</div>
                        </div>
                        \${run.progressMessage ? \`<div style="margin-top: 10px; font-style: italic; color: #666;">\${run.progressMessage}</div>\` : ''}
                        \${run.errorMessage ? \`<div style="margin-top: 10px; color: #dc3545; font-size: 0.9em;"><strong>Error:</strong> \${run.errorMessage}</div>\` : ''}
                        <button onclick="showCollectionRunDetail(\${run.id})" style="margin-top: 10px; padding: 6px 12px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9em;">View Details</button>
                    </div>
                \`).join('');

                document.getElementById('collectionRunsList').innerHTML = runsHtml || '<div style="text-align: center; color: #666; padding: 20px;">No collection runs found</div>';

                const pagination = data.pagination;
                let paginationHtml = '';
                if (pagination.totalPages > 1) {
                    paginationHtml = \`
                        \${pagination.hasPrev ? \`<button onclick="loadCollectionRunsList(\${pagination.page - 1}, '\${status}')" style="margin: 0 5px; padding: 8px 12px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">Previous</button>\` : ''}
                        <span style="margin: 0 10px;">Page \${pagination.page} of \${pagination.totalPages}</span>
                        \${pagination.hasNext ? \`<button onclick="loadCollectionRunsList(\${pagination.page + 1}, '\${status}')" style="margin: 0 5px; padding: 8px 12px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">Next</button>\` : ''}
                    \`;
                }
                document.getElementById('collectionRunsPagination').innerHTML = paginationHtml;
            } catch (error) {
                document.getElementById('collectionRunsList').innerHTML = '<div class="status-error">Unable to load data. Please refresh the page.</div>';
            }
        }

        async function showCollectionRunDetail(runId) {
            try {
                document.getElementById('collectionRunsView').style.display = 'none';
                document.getElementById('collectionRunDetailView').style.display = 'block';

                const response = await fetch(\`/api/admin/collection-runs/\${runId}\`);
                const data = await response.json();

                const run = data.run;
                const jobs = data.jobs;
                const workItems = data.workItems;

                const detailHtml = \`
                    <div style="background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                        <h3>Collection Run #\${run.id}</h3>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px; margin: 15px 0;">
                            <div><strong>Source:</strong> \${run.source}</div>
                            <div><strong>Status:</strong> <span class="status-\${run.status === 'completed' ? 'healthy' : run.status === 'failed' ? 'error' : 'warning'}">\${run.status}</span></div>
                            <div><strong>Phase:</strong> \${run.currentPhase || 'N/A'}</div>
                            <div><strong>Progress:</strong> \${data.progress.percentComplete}%</div>
                            <div><strong>Started:</strong> \${new Date(run.startedAt).toLocaleString()}</div>
                            <div><strong>Completed:</strong> \${run.completedAt ? new Date(run.completedAt).toLocaleString() : 'N/A'}</div>
                        </div>
                        \${run.progress_message ? \`<div style="margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 4px;"><strong>Progress:</strong> \${run.progress_message}</div>\` : ''}
                        \${run.error_message ? \`<div style="margin: 10px 0; padding: 10px; background: #f8d7da; border-radius: 4px; color: #721c24;"><strong>Error:</strong> \${run.error_message}</div>\` : ''}
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                        <div style="background: white; border-radius: 8px; padding: 20px;">
                            <h4>Jobs (\${jobs.length})</h4>
                            \${jobs.map(job => \`
                                <div style="border-bottom: 1px solid #eee; padding: 10px 0;">
                                    <div><strong>\${job.jobType}</strong> - <span class="status-\${job.status === 'completed' ? 'healthy' : job.status === 'failed' ? 'error' : 'warning'}">\${job.status}</span></div>
                                    <div style="font-size: 0.9em; color: #666;">Created: \${new Date(job.createdAt).toLocaleString()}</div>
                                    \${job.error_message ? \`<div style="font-size: 0.9em; color: #dc3545;">Error: \${job.error_message}</div>\` : ''}
                                </div>
                            \`).join('')}
                        </div>
                    </div>
                \`;

                document.getElementById('collectionRunDetail').innerHTML = detailHtml;
            } catch (error) {
                document.getElementById('collectionRunDetail').innerHTML = '<div class="status-error">Unable to load details. Please try again.</div>';
            }
        }

        async function loadJobQueueList(status = '') {
            try {
                const params = new URLSearchParams({ limit: '100' });
                if (status) params.append('status', status);

                const response = await fetch(\`/api/admin/job-queue?\${params}\`);
                const data = await response.json();

                const statusCounts = {};
                data.stats.forEach(stat => {
                    statusCounts[stat.status] = stat.count;
                });

                const statsHtml = \`
                    <div style="background: white; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                        <h4>Queue Statistics</h4>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px;">
                            <div class="metric">
                                <span>Pending:</span>
                                <span class="status-\${statusCounts.pending > 0 ? 'warning' : 'healthy'}">\${statusCounts.pending || 0}</span>
                            </div>
                            <div class="metric">
                                <span>Running:</span>
                                <span class="status-\${statusCounts.running > 0 ? 'warning' : 'healthy'}">\${statusCounts.running || 0}</span>
                            </div>
                            <div class="metric">
                                <span>Completed:</span>
                                <span>\${statusCounts.completed || 0}</span>
                            </div>
                            <div class="metric">
                                <span>Failed:</span>
                                <span class="status-\${statusCounts.failed > 0 ? 'error' : 'healthy'}">\${statusCounts.failed || 0}</span>
                            </div>
                        </div>
                    </div>
                \`;

                const jobsHtml = data.jobs.map(job => \`
                    <div style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 15px; margin-bottom: 10px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                            <h4>Job #\${job.job_queue.id} - \${job.job_queue.jobType}</h4>
                            <div>
                                <span class="status-\${job.job_queue.status === 'completed' ? 'healthy' : job.job_queue.status === 'failed' ? 'error' : 'warning'}">\${job.job_queue.status}</span>
                                <span style="margin-left: 10px; font-size: 0.9em; color: #666;">Priority: \${job.job_queue.priority}</span>
                            </div>
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; font-size: 0.9em;">
                            <div><strong>Created:</strong> \${new Date(job.job_queue.createdAt).toLocaleString()}</div>
                            <div><strong>Started:</strong> \${job.job_queue.startedAt ? new Date(job.job_queue.startedAt).toLocaleString() : 'N/A'}</div>
                            <div><strong>Completed:</strong> \${job.job_queue.completedAt ? new Date(job.job_queue.completedAt).toLocaleString() : 'N/A'}</div>
                        </div>
                        \${job.retryCount > 0 ? \`<div style="margin-top: 10px; color: #ffc107; font-size: 0.9em;"><strong>Retries:</strong> \${job.retryCount}</div>\` : ''}
                        \${job.errorMessage ? \`<div style="margin-top: 10px; color: #dc3545; font-size: 0.9em;"><strong>Error:</strong> \${job.errorMessage}</div>\` : ''}
                    </div>
                \`).join('');

                document.getElementById('jobQueueStats').innerHTML = statsHtml;
                document.getElementById('jobQueueList').innerHTML = jobsHtml || '<div style="text-align: center; color: #666; padding: 20px;">No jobs found</div>';
            } catch (error) {
                document.getElementById('jobQueueStats').innerHTML = '<div class="status-error">Unable to load data. Please refresh the page.</div>';
                document.getElementById('jobQueueList').innerHTML = '<div class="status-error">Unable to load data. Please refresh the page.</div>';
            }
        }

        function filterCollectionRuns() {
            const status = document.getElementById('statusFilter').value;
            loadCollectionRunsList(1, status);
        }

        function filterJobQueue() {
            const status = document.getElementById('jobStatusFilter').value;
            loadJobQueueList(status);
        }

        function refreshCollectionRuns() {
            const status = document.getElementById('statusFilter').value;
            loadCollectionRunsList(1, status);
        }

        function refreshJobQueue() {
            const status = document.getElementById('jobStatusFilter').value;
            loadJobQueueList(status);
        }

        async function loadApiTokens() {
            try {
                const response = await fetch('/api/tokens');
                const data = await response.json();
                const tokensHtml = data.tokens.map(token => \`
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; border: 1px solid #eee; margin: 5px 0; border-radius: 4px;">
                        <div>
                            <strong>\${token.name}</strong><br>
                            <small>Created: \${new Date(token.created_at).toLocaleDateString()}</small>
                            \${token.expires_at ? \`<br><small>Expires: \${new Date(token.expires_at).toLocaleDateString()}</small>\` : ''}
                            \${token.last_used_at ? \`<br><small>Last used: \${new Date(token.last_used_at).toLocaleDateString()}</small>\` : ''}
                        </div>
                        <button onclick="revokeToken('\${token.id}')" style="padding: 4px 8px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer;">Revoke</button>
                    </div>
                \`).join('');
                document.getElementById('apiTokens').innerHTML = tokensHtml || '<p>No tokens found</p>';
            } catch (error) {
                document.getElementById('apiTokens').innerHTML = '<p>Error loading tokens</p>';
            }
        }

        async function generateToken() {
            const name = document.getElementById('tokenName').value;
            const expiry = document.getElementById('tokenExpiry').value;
            if (!name) {
                alert('Please enter a token name');
                return;
            }

            try {
                const response = await fetch('/api/tokens', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, expiresInDays: expiry ? parseInt(expiry) : undefined })
                });
                const data = await response.json();

                showTokenModal(data.token);
                document.getElementById('tokenName').value = '';
                document.getElementById('tokenExpiry').value = '';
                loadApiTokens();
            } catch (error) {
                alert('Error generating token');
            }
        }

        function showTokenModal(token) {
            document.getElementById('tokenDisplay').textContent = token;
            document.getElementById('tokenModal').style.display = 'block';
        }

        function closeTokenModal() {
            document.getElementById('tokenModal').style.display = 'none';
        }

        async function copyTokenToClipboard() {
            const tokenText = document.getElementById('tokenDisplay').textContent;
            try {
                await navigator.clipboard.writeText(tokenText);
                const button = document.getElementById('copyTokenButton');
                const originalText = button.textContent;
                button.textContent = '✅ Copied!';
                button.style.background = '#28a745';
                setTimeout(() => {
                    button.textContent = originalText;
                    button.style.background = '#28a745';
                }, 2000);
            } catch (err) {
                const textArea = document.createElement('textarea');
                textArea.value = tokenText;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                alert('Token copied to clipboard!');
            }
        }

        async function revokeToken(tokenId) {
            if (!confirm('Are you sure you want to revoke this token?')) return;

            try {
                await fetch(\`/api/tokens/\${tokenId}\`, { method: 'DELETE' });
                loadApiTokens();
            } catch (error) {
                alert('Error revoking token');
            }
        }

        async function collectFromGithub() {
            const urlInput = document.getElementById('githubUrl');
            const url = urlInput.value.trim();

            if (!url) {
                alert('Please enter a GitHub repository URL');
                return;
            }

            if (!url.includes('github.com')) {
                alert('Please enter a valid GitHub repository URL');
                return;
            }

            if (!confirm('This will start data collection from ' + url + '. Continue?')) {
                return;
            }

            try {
                const button = document.getElementById('collectGithubBtn');
                button.disabled = true;
                button.textContent = '🔄 Collecting...';

                const response = await fetch('/api/admin/collect', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        source: 'github',
                        url: url,
                        maxPages: 5
                    })
                });

                const result = await response.json();

                if (response.ok) {
                    alert('GitHub collection started successfully!\\n\\nCollection Run ID: ' + result.collectionRunId + '\\nEstimated Time: ' + result.estimatedTime + '\\n\\nYou can monitor progress in the Collection Runs section.');
                    urlInput.value = '';
                    loadMetrics();
                } else {
                    alert('Error: ' + result.error + '\\n' + (result.message || ''));
                }
            } catch (error) {
                console.error('Error starting GitHub collection:', error);
                alert('Failed to start GitHub collection. Please check the console for details.');
            } finally {
                const button = document.getElementById('collectGithubBtn');
                button.disabled = false;
                button.textContent = '📁 Collect GitHub Repo';
            }
        }

        async function collectFromForum() {
            if (!confirm('This will start data collection from OpenAI community forums. This may take several minutes. Continue?')) {
                return;
            }

            try {
                const button = document.getElementById('collectForumBtn');
                button.disabled = true;
                button.textContent = '🔄 Collecting...';

                const response = await fetch('/api/admin/collect', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        source: 'forum',
                        url: 'https://community.openai.com',
                        maxPages: 20
                    })
                });

                const result = await response.json();

                if (response.ok) {
                    alert('Forum collection started successfully!\\n\\nCollection Run ID: ' + result.collectionRunId + '\\nEstimated Time: ' + result.estimatedTime + '\\n\\nYou can monitor progress in the Collection Runs section.');
                    loadMetrics();
                } else {
                    alert('Error: ' + result.error + '\\n' + (result.message || ''));
                }
            } catch (error) {
                console.error('Error starting forum collection:', error);
                alert('Failed to start forum collection. Please check the console for details.');
            } finally {
                const button = document.getElementById('collectForumBtn');
                button.disabled = false;
                button.textContent = '💬 Collect Forums';
            }
        }

        loadMetrics();
        loadApiTokens();
        setInterval(loadMetrics, 30000);

        function toggleMenu() {
            const dropdown = document.getElementById('menuDropdown');
            const isVisible = dropdown.style.display !== 'none';
            dropdown.style.display = isVisible ? 'none' : 'block';

            if (!isVisible) {
                document.addEventListener('click', closeMenuOnOutsideClick);
            } else {
                document.removeEventListener('click', closeMenuOnOutsideClick);
            }
        }

        function closeMenuOnOutsideClick(event) {
            const dropdown = document.getElementById('menuDropdown');
            const toggle = document.getElementById('menuToggle');

            if (!dropdown.contains(event.target) && !toggle.contains(event.target)) {
                dropdown.style.display = 'none';
                document.removeEventListener('click', closeMenuOnOutsideClick);
            }
        }
    </script>
</body>
</html>`;
}
export function renderWebInterface(user?: AuthUser): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="robots" content="noai, noimageai">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OpenAI SDK Knowledge MCP</title>
    <link rel="icon" href="/favicon.ico" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
            padding: 20px;
            position: relative;
        }

        .container {
            display: flex;
            margin: 0 auto;
            gap: 50px;
            padding: 30px;
        }

        .main-content {
            flex: 1;
            padding: 50px 0;
        }

        .sidebar {
            width: 450px;
            padding: 40px 0;
            flex-shrink: 0;
        }

        h1 {
            font-size: 3rem;
            font-weight: 700;
            color: white;
            margin-bottom: 10px;
            text-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .auth-links {
            position: absolute;
            top: 30px;
            right: 50px;
        }

        .auth-links a {
            color: rgba(255, 255, 255, 0.9);
            text-decoration: none;
            margin-left: 15px;
            padding: 8px 16px;
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 20px;
            transition: all 0.3s ease;
            font-weight: 500;
        }

        .auth-links a:hover {
            background: rgba(255, 255, 255, 0.1);
            border-color: rgba(255, 255, 255, 0.5);
        }

        .auth-links span {
            color: rgba(255, 255, 255, 0.9);
            margin-right: 15px;
            font-weight: 500;
        }

        .subtitle {
            font-size: 1.2rem;
            color: rgba(255, 255, 255, 0.9);
            margin-bottom: 40px;
            font-weight: 400;
        }

        .query-form {
            background: rgba(255, 255, 255, 0.95);
            border-radius: 12px;
            padding: 30px;
            margin-bottom: 30px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
            backdrop-filter: blur(10px);
        }

        .input-group {
            display: flex;
            gap: 15px;
            align-items: stretch;
        }

        #queryInput {
            flex: 1;
            padding: 15px 20px;
            border: 2px solid #e2e8f0;
            border-radius: 8px;
            font-size: 16px;
            transition: all 0.3s ease;
            background: white;
        }

        #queryInput:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }

        .btn {
            padding: 15px 30px;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }

        .btn-primary {
            background: #667eea;
            color: white;
        }

        .btn-primary:hover:not(:disabled) {
            background: #5a67d8;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
        }

        .btn-secondary {
            background: #f7fafc;
            color: #4a5568;
            border: 1px solid #e2e8f0;
        }

        .btn-secondary:hover {
            background: #edf2f7;
        }

        .get-started-btn {
            font-size: 1.1rem;
            padding: 18px 35px;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }

        .config-section {
            margin-top: 25px;
        }

        .config-section p {
            color: rgba(255, 255, 255, 0.9);
            margin-bottom: 15px;
            font-weight: 500;
        }

        .config-note {
            color: rgba(255, 255, 255, 0.8);
            font-size: 0.9rem;
            margin-top: 15px;
            font-style: italic;
        }

        .loading {
            display: none;
            text-align: center;
            padding: 20px;
            color: #667eea;
        }

        .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            animation: spin 1s linear infinite;
            margin: 0 auto 10px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .result {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
        }

        .result-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }

        .result-query {
            font-weight: 600;
            color: #2d3748;
            margin-bottom: 10px;
        }

        .result-response {
            line-height: 1.6;
            margin-bottom: 15px;
        }


        .sidebar-section {
            margin-bottom: 25px;
        }

        .sidebar-title {
            font-weight: 600;
            margin-bottom: 15px;
            color: #2d3748;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .history-item, .favorite-item {
            background: #f8f9fa;
            border-radius: 6px;
            padding: 10px;
            margin-bottom: 8px;
            cursor: pointer;
            transition: background 0.3s;
            font-size: 14px;
            border: 1px solid #e2e8f0;
        }

        .history-item:hover, .favorite-item:hover {
            background: #e2e8f0;
        }

        .item-query {
            font-weight: 500;
            margin-bottom: 5px;
            color: #2d3748;
        }

        .item-time {
            color: #718096;
            font-size: 12px;
        }

        .favorite-btn {
            background: none;
            border: none;
            color: #ffd700;
            font-size: 18px;
            cursor: pointer;
            padding: 5px;
        }

        .favorite-btn.active {
            color: #ffa500;
        }

        .clear-btn {
            background: none;
            border: none;
            color: #e53e3e;
            cursor: pointer;
            font-size: 12px;
        }

        .stat-card {
            background: rgba(255, 255, 255, 0.95);
            border-radius: 12px;
            padding: 25px;
            margin-bottom: 25px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
            backdrop-filter: blur(10px);
        }

        .stat-card h3 {
            color: #2d3748;
            margin-bottom: 15px;
            font-size: 1.1rem;
        }

        .stat-item {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
            font-size: 0.9em;
        }

        .error {
            background: #fed7d7;
            color: #c53030;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            border-left: 4px solid #e53e3e;
        }

        ${TOKEN_MODAL_CSS}

        .mcp-connection-guide {
            background: rgba(255, 255, 255, 0.95);
            border-radius: 12px;
            padding: 30px;
            margin-bottom: 30px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
            backdrop-filter: blur(10px);
        }

        .mcp-connection-guide h3 {
            color: #2d3748;
            margin-bottom: 15px;
            font-size: 1.3rem;
        }

        .mcp-connection-guide p {
            color: #4a5568;
            margin-bottom: 15px;
            line-height: 1.6;
        }

        .mcp-config-code {
            background: #2d3748;
            color: #e2e8f0;
            padding: 20px;
            border-radius: 8px;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 14px;
            margin: 15px 0;
            overflow-x: auto;
            white-space: pre;
            margin-bottom: 15px;
            white-space: pre;
        }

        .mcp-tools-list {
            list-style: none;
            padding: 0;
            margin: 15px 0;
        }

        .mcp-tools-list li {
            display: flex;
            align-items: flex-start;
            margin-bottom: 12px;
            padding: 8px 0;
        }

        .mcp-tool-emoji {
            font-size: 1.2em;
            margin-right: 12px;
            flex-shrink: 0;
        }

        .mcp-tool-name {
            font-weight: 600;
            color: #667eea;
            margin-right: 8px;
        }

        .mcp-tool-desc {
            color: #4a5568;
        }

        @media (max-width: 1024px) {
            .container {
                flex-direction: column;
                gap: 20px;
            }

            .sidebar {
                width: 100%;
                padding: 0;
            }

            .input-group {
                flex-direction: column;
                gap: 15px;
            }

            h1 {
                font-size: 2rem;
            }
        }
    </style>
</head>
<body>
    <div class="auth-links">
        ${user ? `<span>Welcome, ${user.name} (${user.email})</span><a href="/auth/logout">Logout</a>` : `<a href="/mypage">Getting Started</a> <a href="/auth/login">Login</a>`}
    </div>
    <div class="container">
        <div class="main-content">
            <h1>OpenAI SDK Knowledge MCP</h1>
            <p class="subtitle">Ask questions about OpenAI API, SDKs, and best practices</p>

            <div class="mcp-connection-guide">
                <p><strong>Step 1: Sign in with Google to generate your API token</strong></p>
                <a href="/mypage" class="btn btn-primary get-started-btn">🔑 Create API Token & Get Started</a>
                <div class="config-section">
                    <p><strong>Step 2: Use your ${user ? "" : "generated "}token in the MCP client configuration</strong></p>
                <p>Compatible with any MCP-compatible client. This service is also available for ChatGPT Deep Research’s custom MCP connector. You can use the same URL to configure the connector.</p>
                    <div class="mcp-config-code">{
  "mcpServers": {
    "openai-sdk-knowledge.org": {
      "type": "streamable-http",
      "url": "https://openai-sdk-knowledge.org/mcp",
      "headers": {
        "Authorization": "Bearer {your api key here}"
      }
    }
  }
}
</div>
                </div>

            <p><strong>Wanna try it out now?</strong></p>
            <p>💡 Before connecting to the MCP server, you can quickly explore its capabilities by asking the questions below:</p>
            <div class="input-group">
                    <input type="text" id="queryInput" placeholder="Ask about OpenAI API usage, embeddings, chat completions..." maxlength="1000">
                    <button id="askButton" class="btn btn-primary">Ask</button>
                </div>
                <div id="loading" class="loading">
                  <div class="spinner"></div>
                  Processing your question...
                </div>
                <div id="results"></div>
            </div>
            <footer style="text-align:center;margin:40px 0 20px;font-size:0.9rem;color:#dce9f5;">
              Made with <span style="color:#dce9f5">❤️</span> by <a href="https://github.com/seratch" target="_blank" style="color:#dce9f5;">@seratch</a> —
              <a href="https://github.com/seratch/openai-sdk-knowledge-org/" target="_blank" style="color:#dce9f5;">GitHub repo</a>
            </footer>
        </div>

      ${
        user
          ? `
        <div class="sidebar"><div class="stat-card">
          <h3> API Tokens </h3>
          <div id = "apiTokens" > Loading...</div>
          <div style = "margin-top: 10px;" >
            <input type="text" id = "tokenName" placeholder = "Token name" style = "width: 100%; padding: 8px; margin-bottom: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;" />
            <input type="number" id = "tokenExpiry" placeholder = "Days until expiry (optional)" style = "width: 100%; padding: 8px; margin-bottom: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;" />
            <button onclick="generateToken()" style = "width: 100%; padding: 8px 12px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500; font-size: 14px;" >🔑 Generate API Token </button>
          </div>
        </div>
        <div class="stat-card" >
          <h3>Query History </h3>
            <div id = "queryHistory" > <p style="color: #999; font-size: 0.9em;" > No queries yet < /p></div>
          </div>
        </div>
      </div>
    </div>`
          : ``
      }

    <!-- Token Display Modal -->
    <div id="tokenModal" class="token-modal">
        <div class="token-modal-content">
            <h3>🔑 API Token Generated Successfully</h3>
            <p>Your new API token has been created. <strong>Save this token securely - it won't be shown again.</strong></p>
            <div id="tokenDisplay" class="token-display"></div>
            <div style="margin-top: 20px;">
                <button id="copyTokenButton" class="copy-button" onclick="copyTokenToClipboard()">📋 Copy Token</button>
                <button class="close-modal-button" onclick="closeTokenModal()">Close</button>
            </div>
        </div>
    </div>

    <script>
        let queryHistory = JSON.parse(localStorage.getItem('queryHistory') || '[]');

        const exampleQueries = [
            "How can I install OpenAI Agents SDK for TypeScript?",
            "How do I install the OpenAI Python client and set the OPENAI_API_KEY environment variable?",
            "What's the key difference between agents as tools vs handoffs?",
            "How do I attach a custom function tool to an agent in Agents SDK for Python?",
            "What’s the simplest way to stream partial responses from GPT-4o using Agents SDK's run_streamed()?",
            "How can I pass user-specific files to an agent with file search tool?",
            "How do I pass local text files to Responses API so it can answer questions about their contents?",
            "What parameters are available for Responses API when using Python SDK?",
        ];

        function setRandomExampleQuery() {
            const randomIndex = Math.floor(Math.random() * exampleQueries.length);
            document.getElementById('queryInput').value = exampleQueries[randomIndex];
        }

        document.addEventListener('DOMContentLoaded', function() {
            loadApiTokens();
            updateHistoryDisplay();
            setRandomExampleQuery();

            document.getElementById('queryInput').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    askQuestion();
                }
            });

            document.getElementById('askButton').addEventListener('click', askQuestion);
        });

        async function askQuestion() {
            const queryInput = document.getElementById('queryInput');
            const query = queryInput.value.trim();

            if (!query) return;

            const askButton = document.getElementById('askButton');
            const loading = document.getElementById('loading');
            const results = document.getElementById('results');

            askButton.disabled = true;
            loading.style.display = 'block';
            results.innerHTML = '';

            try {
                const response = await fetch('/api/query', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        query
                    }),
                });

                const data = await response.json();

                if (data.error) {
                    displayError(data.error?.message || data.error || 'An error occurred');
                } else if (response.ok && data.response) {
                    displayResponse(data);
                    addToHistory(query, data);
                } else {
                    displayError(data.error?.message || data.error || 'An error occurred');
                }
            } catch (error) {
                displayError('Unable to process your request. Please try again.');
            } finally {
                askButton.disabled = false;
                loading.style.display = 'none';
            }
        }

        function formatResponseContent(content) {
            if (!content) return '<em style="color: #718096;">No response content available</em>';

            let formatted = content
                .replace(/\`\`\`([^\`]+)\`\`\`/g, '<pre style="background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; margin: 10px 0; overflow-x: auto; font-family: monospace; font-size: 0.9em;"><code>$1</code></pre>')
                .replace(/\`([^\`]+)\`/g, '<code style="background: #f7fafc; padding: 2px 4px; border-radius: 4px; font-family: monospace; color: #2d3748;">$1</code>');

            while (formatted.includes('**')) {
                const firstIndex = formatted.indexOf('**');
                const secondIndex = formatted.indexOf('**', firstIndex + 2);
                if (secondIndex !== -1) {
                    const beforeText = formatted.substring(0, firstIndex);
                    const boldText = formatted.substring(firstIndex + 2, secondIndex);
                    const afterText = formatted.substring(secondIndex + 2);
                    formatted = beforeText + '<strong style="font-weight: 600; color: #2d3748;">' + boldText + '</strong>' + afterText;
                } else {
                    break;
                }
            }

            while (formatted.includes('*') && !formatted.includes('**')) {
                const firstIndex = formatted.indexOf('*');
                const secondIndex = formatted.indexOf('*', firstIndex + 1);
                if (secondIndex !== -1) {
                    const beforeText = formatted.substring(0, firstIndex);
                    const italicText = formatted.substring(firstIndex + 1, secondIndex);
                    const afterText = formatted.substring(secondIndex + 1);
                    formatted = beforeText + '<em style="font-style: italic; color: #4a5568;">' + italicText + '</em>' + afterText;
                } else {
                    break;
                }
            }

            return formatted
                .replace(/\\n\\n/g, '</p><p style="margin: 12px 0;">')
                .replace(/\\n/g, '<br>')
                .replace(/^/, '<p style="margin: 0;">')
                .replace(/$/, '</p>');
        }

        function displayResponse(data) {
            const results = document.getElementById('results');

            if (!results) {
                throw new Error('Results element not found');
            }

            const formattedContent = formatResponseContent(data.response);
            let html = \`
                <div class="result">
                    <div class="result-header">
                        <h3 style="margin: 0; color: #2d3748; font-size: 1.2rem;">MCP Server's Text Content Response Example</h3>
                    </div>
                    <div class="result-response">
                        \${formattedContent}
                    </div>
            \`;


            html += \`
                    <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #e2e8f0;">
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; font-size: 0.9em;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="color: #718096; font-weight: 500;">Query ID:</span>
                                <code style="background: #f7fafc; padding: 2px 6px; border-radius: 4px; font-family: monospace; color: #2d3748;">\${data.queryId}</code>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="color: #718096; font-weight: 500;">Processing Time:</span>
                                <span style="color: #2d3748; font-weight: 600;">\${data.metadata?.processingTime || 0}ms</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="color: #718096; font-weight: 500;">Timestamp:</span>
                                <span style="color: #2d3748;">\${new Date(data.timestamp).toLocaleString()}</span>
                            </div>
                        </div>
                    </div>
                </div>
            \`;

            results.innerHTML = html;
        }

        function displayError(error) {
            const results = document.getElementById('results');
            results.innerHTML = \`
                <div style="background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 8px; padding: 15px; color: #721c24;">
                    <strong>Error:</strong> \${error}
                </div>
            \`;
        }


        function rerunQuery(query) {
            document.getElementById('queryInput').value = query;
            askQuestion();
        }

        function showResult(data) {
            const results = document.getElementById('results');
            const isFavorite = favorites.some(f => f.query === data.query);

            const resultHtml = \`
                <div class="result">
                    <div class="result-header">
                        <div class="result-query">\${data.query}</div>
                    </div>
                    <div class="result-response">\${data.response}</div>
                </div>
            \`;

            results.innerHTML = resultHtml + results.innerHTML;
        }

        function showError(message) {
            const results = document.getElementById('results');
            results.innerHTML = \`<div class="error">\${message}</div>\` + results.innerHTML;
        }

        function addToHistory(query, data) {
            const historyItem = {
                query,
                response: data.response,
                timestamp: new Date().toISOString()
            };

            queryHistory.unshift(historyItem);
            queryHistory = queryHistory.slice(0, 20);

            localStorage.setItem('queryHistory', JSON.stringify(queryHistory));
            updateHistoryDisplay();
        }

        function updateHistoryDisplay() {
            const historyDiv = document.getElementById('queryHistory');
            if (!historyDiv) {
                return;
            }
            if (queryHistory.length === 0) {
                historyDiv.innerHTML = '<p style="color: #718096; font-size: 14px;">No queries yet</p>';
                return;
            }

            historyDiv.innerHTML = queryHistory.map(item => \`
                <div class="history-item" onclick="rerunQuery('\${item.query}')">
                    <div class="item-query">\${item.query.substring(0, 50)}\${item.query.length > 50 ? '...' : ''}</div>
                    <div class="item-time">\${new Date(item.timestamp).toLocaleString()}</div>
                </div>
            \`).join('');
        }

        function rerunQuery(query) {
            document.getElementById('queryInput').value = query;
            askQuestion();
        }

        async function loadApiTokens() {
            const apiTokensDom = document.getElementById('apiTokens');
            if (!apiTokensDom) {
                return;
            }
            try {
                const response = await fetch('/api/tokens');
                const data = await response.json();
                const tokensHtml = data.tokens.map(token => \`
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; border: 1px solid #eee; margin: 5px 0; border-radius: 4px; font-size: 14px;">
                        <div>
                            <strong>\${token.name}</strong><br>
                            <small>Created: \${new Date(token.created_at).toLocaleDateString()}</small>
                            \${token.expires_at ? \`<br><small>Expires: \${new Date(token.expires_at).toLocaleDateString()}</small>\` : ''}
                            \${token.last_used_at ? \`<br><small>Last used: \${new Date(token.last_used_at).toLocaleDateString()}</small>\` : ''}
                        </div>
                        <button onclick="revokeToken('\${token.id}')" style="padding: 4px 8px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">Revoke</button>
                    </div>
                \`).join('');
                apiTokensDom.innerHTML = tokensHtml || '<p style="color: #999; font-size: 14px;">No tokens found</p>';
            } catch (error) {
                apiTokensDom.innerHTML = '<p style="color: #dc3545; font-size: 14px;">Error loading tokens</p>';
            }
        }

        async function generateToken() {
            const name = document.getElementById('tokenName').value;
            const expiry = document.getElementById('tokenExpiry').value;
            if (!name) {
                alert('Please enter a token name');
                return;
            }

            try {
                const response = await fetch('/api/tokens', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, expiresInDays: expiry ? parseInt(expiry) : undefined })
                });
                const data = await response.json();

                if (response.ok) {
                    showTokenModal(data.token);
                    document.getElementById('tokenName').value = '';
                    document.getElementById('tokenExpiry').value = '';
                    loadApiTokens();
                } else {
                    alert(\`Error: \${data.error || 'Failed to generate token'}\`);
                }
            } catch (error) {
                alert('Error generating token');
            }
        }

        function showTokenModal(token) {
            document.getElementById('tokenDisplay').textContent = token;
            document.getElementById('tokenModal').style.display = 'block';
        }

        function closeTokenModal() {
            document.getElementById('tokenModal').style.display = 'none';
        }

        async function copyTokenToClipboard() {
            const tokenText = document.getElementById('tokenDisplay').textContent;
            try {
                await navigator.clipboard.writeText(tokenText);
                const button = document.getElementById('copyTokenButton');
                const originalText = button.textContent;
                button.textContent = '✅ Copied!';
                button.style.background = '#28a745';
                setTimeout(() => {
                    button.textContent = originalText;
                    button.style.background = '#28a745';
                }, 2000);
            } catch (err) {
                const textArea = document.createElement('textarea');
                textArea.value = tokenText;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                alert('Token copied to clipboard!');
            }
        }

        async function revokeToken(tokenId) {
            if (!confirm('Are you sure you want to revoke this token?')) return;

            try {
                await fetch(\`/api/tokens/\${tokenId}\`, { method: 'DELETE' });
                loadApiTokens();
            } catch (error) {
                alert('Error revoking token');
            }
        }
    </script>
</body>
</html>`;
}
