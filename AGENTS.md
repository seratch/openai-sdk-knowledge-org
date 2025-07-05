# AGENTS.md - Guide for AI Coding Agents

This file is a quick reference for AI coding agents such as **Codex** and **Codex CLI**. It summarises the project purpose, directory layout, development workflow, and verification steps required before submitting any patch.

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

src/__tests__/       # Unit and integration tests
package.json         # Scripts: build, dev, test, lint, deploy
wrangler.toml        # Cloudflare Workers configuration
```

## Environment Setup

1. Ensure **Node.js >=22** is installed.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy env template and set keys:
   ```bash
   cp .dev.vars.example .dev.vars
   # Edit .dev.vars: add OPENAI_API_KEY, GITHUB_TOKEN (optional), etc.
   ```

## Development Workflow

1. **Start development environment**:
    - Run `npm run dev`
2. **Target endpoints**:
    - Web UI: `http://localhost:8787`
    - MCP server: `POST http://localhost:8787/mcp`
    - Web API: `POST http://localhost:8787/api/query`

**Note:** Avoid running production scripts such as `npm run deploy:prod` or `npm run db:migrate:prod` from this environment.

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

  - Ensure `npm run build` succeeds without errors.
  - Run `npm run lint` and confirm there are no ESLint issues.
  - Confirm all tests pass (CI-like check).
  - Manually exercise critical endpoints (e.g., health check, sample query).
  - Review logs for unexpected warnings/errors.

## Patch Best Practices

- **Scope:** Keep patches minimal and focused on the user’s request.
- **Root Cause Fixes:** Address underlying issues, not just symptoms.
- **Tests:** Add or update tests when behavior changes.
- **Documentation:** Update README.md or other relevant files if interfaces or workflows change.
- **Style:** Follow existing code conventions; use ESLint/Prettier.
- **Verification:** Always run build, lint, and test suite before finalizing.

## Committing Changes

- Use `apply_patch` for modifications.
- Do not manually commit; commit messages are auto-generated.
- Remove any debug code or commented-out blocks.
 - Run `git status` to ensure the working tree is clean before committing.

---
For detailed guides on local development, deployment, and troubleshooting, refer to [README.md](README.md) and [CLAUDE.md](CLAUDE.md).
