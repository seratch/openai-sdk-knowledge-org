# Local Development Guide

This document provides a concise summary of how to set up a local development environment for the OpenAI SDK Knowledge MCP.

## Table of Contents
- Prerequisites
- Installation
- Environment Variable Setup
- Database Initialization
- Server Startup & Build
- Testing & Debugging
- Troubleshooting
- Support

## Prerequisites
- **Node.js**: v22 or higher
- **npm** (or yarn/pnpm)
- **OpenAI API Key** (required for embedding generation)
- **GitHub Token** (recommended to avoid rate limits during data collection)

## Installation
```bash
# Clone the repository
git clone https://github.com/seratch/openai-sdk-knowledge-org.git
cd openai-sdk-knowledge-org

# Install dependencies
npm install
```

## Environment Variable Setup
1. Copy the template:
```bash
cp .dev.vars.example .dev.vars
```
2. Edit `.dev.vars` and set the required values:
```env
OPENAI_API_KEY=sk-xxxxxx
GITHUB_TOKEN=ghp-xxxxxx # optional
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com # only if using admin features
GOOGLE_CLIENT_SECRET=xxxx # only if using admin features
GOOGLE_REDIRECT_URI=http://localhost:8787/auth/callback
ADMIN_EMAILS=your-email@example.com
JWT_SECRET=xxxx
DISABLE_ADMIN_AUTH_FOR_LOCAL_DEV=true # recommended for local development
LOG_LEVEL=debug # optional
```

*Note: For Google OAuth, enabling only the People API is sufficient.*

## Database Initialization
```bash
# Apply local DB migrations
npm run db:migrate:dev

# Reset DB (if needed)
npm run db:reset:dev
```

### Deleting Local DB Files
```bash
rm -rf .wrangler/
```

### Initialize Vectorize index for dev

```bash
# If you already have "openai-sdk-embeddings-dev" index, delete and then recreate it
npx wrangler vectorize delete openai-sdk-embeddings-dev
npx wrangler vectorize create openai-sdk-embeddings-dev --dimensions=1536 --metric=cosine
```

## Server Startup & Build
```bash
# Start development server
npm run dev

# Production build
npm run build
```

## Troubleshooting

- **API key not found**: Check `OPENAI_API_KEY` in `.dev.vars`
- **GitHub 403/rate limit**: Set `GITHUB_TOKEN`
- **DB connection error**: Run migrations, or delete `.wrangler/` and reinitialize
- **TypeScript errors**: Run `npm run build` for type checking, reinstall dependencies if needed

## Support
- [GitHub Issues](https://github.com/seratch/openai-sdk-mcp-server/issues)
- [GitHub Discussions](https://github.com/seratch/openai-sdk-mcp-server/discussions)

---

For more detailed procedures or operations, please refer to the various documents and the repository README.
