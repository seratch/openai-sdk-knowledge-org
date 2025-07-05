 # AGENTS.md - Guide for AI Coding Agents

 This file guides AI coding agents (e.g., Codex) working on this repository. It explains the project purpose, code structure, development workflows, and verification steps to ensure generated patches are correct and complete.

 ## Project Overview
 - **Name:** OpenAI SDK Knowledge MCP
 - **Description:** Serverless MCP (Model Context Protocol) server offering expert-level answers about OpenAI API usage, built with TypeScript, Cloudflare Workers, and OpenAI agents.
 - **Entry Point:** `src/index.ts` (Cloudflare Worker)
 - **Documentation:** See [README.md](README.md) for full project overview, architecture, and external guides.

 ## Repository Structure
 ```
 src/
  ├─ agents/          # AI agent implementations (RAG, translation, summarization, etc.)
  ├─ pipeline/        # Data collectors and processors (GitHub, forums, embeddings)
  ├─ server/         # HTTP endpoints (MCP, web API) and middleware
  ├─ storage/         # Vector store and database initialization
  ├─ utils/           # Shared utilities (logger, rate limiter)
  └─ index.ts         # Worker bootstrap

 docs/                # Guides: local dev, deployment, troubleshooting
 src/__tests__/       # Unit and integration tests
 package.json         # Scripts: build, dev, test, lint, deploy
 wrangler.toml        # Cloudflare Workers configuration
 ```

 ## Environment Setup
 1. Install dependencies:
    ```bash
    npm install
    ```
 2. Copy env template and set keys:
    ```bash
    cp .dev.vars.example .dev.vars
    # Edit .dev.vars: add OPENAI_API_KEY, GITHUB_TOKEN (optional), etc.
    ```

 ## Development Workflow
 1. **Start development environment**:
    ```bash
   npm run dev
   ```
    - Runs the Cloudflare Worker locally for development.
 2. **Target endpoints**:
    - Web UI: `http://localhost:8787`
    - MCP server: `POST http://localhost:8787/mcp`
    - Web API: `POST http://localhost:8787/api/query`

 ## Building & Linting
 - `npm run build`       : Compile TypeScript
 - `npm run type-check`  : TypeScript type-check
 - `npm run lint`        : ESLint checks
 - `npm run format`      : Prettier formatting

 ## Testing & Verification
 1. **Run tests**:
    ```bash
    npm test         # Type-check + Jest
    npm run test:watch
    npm run test:coverage
    ```
 2. **Verify code generation patches**:
    - Ensure no compilation or lint errors.
    - Confirm all tests pass (CI-like check).
    - Manually exercise critical endpoints (e.g., health check, sample query).
    - Review logs for unexpected warnings/errors.

 ## Patch Best Practices
 - **Scope:** Keep patches minimal and focused on the user’s request.
 - **Root Cause Fixes:** Address underlying issues, not just symptoms.
 - **Tests:** Add or update tests when behavior changes.
 - **Documentation:** Update README.md or docs/* if interfaces or workflows change.
 - **Style:** Follow existing code conventions; use ESLint/Prettier.
 - **Verification:** Always run build, lint, and test suite before finalizing.

 ## Committing Changes
 - Use `apply_patch` for modifications.
 - Do not manually commit; commit messages are auto-generated.
 - Remove any debug code or commented-out blocks.

 ---
 For detailed guides on local development, deployment, and troubleshooting, refer to the project [README.md](README.md) and `docs/` directory.
