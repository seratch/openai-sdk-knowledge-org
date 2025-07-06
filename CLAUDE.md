# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

### Development
- `npm run dev` - Start development server

### Build and Type Checking
- `npm run build` - Compile TypeScript to JavaScript
- `npm run type-check` - Run TypeScript compiler without emitting files
- `npm run lint` - Run ESLint on TypeScript files
- `npm run format` - Format code with Prettier

### Testing
- `npm run test` - Run type check and Jest tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report

### Database Operations
- `npm run db:reset:dev` - Reset local development database
- `npm run db:migrate:dev` - Apply database migrations locally

### DON'TS

- DO NOT RUN `npm run db:migrate:prod`, which makes changes to production database tables.
- DO NOT RUN `npm run deploy:prod`, which deploys to production environment.

## Architecture Overview

This is a **Cloudflare Workers** application that provides an **OpenAI SDK Knowledge MCP Server** with RAG (Retrieval-Augmented Generation) capabilities. The application combines multiple technologies:

### Core Technologies
- **Runtime**: Cloudflare Workers with Node.js compatibility
- **Language**: TypeScript with ES modules
- **Web Framework**: Hono (lightweight, fast)
- **LLM Integration**: OpenAI Agents SDK (`@openai/agents`)
- **MCP Server**: Model Context Protocol TypeScript SDK
- **Database**: Cloudflare D1 (SQLite)
- **Vector Storage**: Cloudflare Vectorize with D1 fallback

### Key System Components

#### 1. Main Application (`src/index.ts`)
- **Entry Point**: Hono web application with middleware
- **Authentication**: Google OAuth with JWT tokens
- **MCP Server**: HTTP-based JSON-RPC endpoint at `/mcp`
- **Web App**: UI routes and API endpoints
- **Job Queue**: Asynchronous data collection processed via Cloudflare Queues

#### 2. Agent System (`src/agents/`)
- **Main Agent** (`main-agent.ts`): Orchestrates RAG and web search agents
- **RAG Agent** (`rag-agent.ts`): Handles knowledge base queries
- **Web Search Agent** (`web-sesarch-agent.ts`): Fallback web search capability
- **Translation Agent** (`translator-agent.ts`): Multi-language support
- **Specialized Agents**: Forum summarizer and code snippet generator

-#### 3. MCP Server Implementation (`src/server/mcp/`)
- **MCP Server** (`http-transport.ts`): MCP protocol and HTTP transport
  implementation combined
- **Tools**: Unified search tool for OpenAI SDK knowledge and code examples

#### 4. Data Pipeline (`src/pipeline/`)
- **Orchestrator** (`orchestrator.ts`): Manages data collection workflow
- **Collectors**: GitHub API and Discourse forum data collection
- **Processors**: Text processing, embeddings generation, issue summarization
- **Job Queue**: Async job processing with retry logic

#### 5. Vector Storage (`src/storage/vector-store.ts`)
- **Hybrid Search**: Combines semantic (vector) and keyword search
- **Embedding Generation**: Uses OpenAI's text-embedding-3-small model
- **Dual Storage**: Cloudflare Vectorize primary, D1 fallback

### Important Implementation Details

#### MCP Tool Configuration
The server provides a unified tool `search_openai_sdk_knowledge_and_code` that handles:
- Documentation search with `query` parameter
- Code examples with `topic` and `language` parameters
- Error troubleshooting with `error` and `context` parameters
- Concept explanations with `concept` parameter

#### ChatGPT Deep Research Connector Support
The MCP server includes specialized support for ChatGPT Deep Research with additional tools:
- **`search`**: Returns structured search results with IDs for document retrieval
- **`fetch`**: Retrieves full document content by ID from search results
- **Tool Selection**: The `buildTools()` function conditionally includes these tools based on client detection
- **Response Format**: ChatGPT Deep Research tools return structured data optimized for research workflows

#### Data Collection Pipeline
- **GitHub**: Collects issues, repository content, and code examples
- **Forum**: Processes community posts from OpenAI forum
- **Processing**: Summarizes content, generates embeddings, detects changes
- **Storage**: Stores in vector database with metadata

#### Authentication & Security
- **Admin Auth**: Google OAuth for admin features
- **MCP Auth**: OAuth flow for MCP client authorization
- **Rate Limiting**: Implemented for OpenAI API calls
- **Input Guardrails**: Content filtering and safety checks

### Development Workflow

#### Environment Setup
1. Copy `.dev.vars.example` to `.dev.vars`
2. Add `OPENAI_API_KEY` and optional `GITHUB_TOKEN`
3. Run `npm run dev` to start development server
4. Access application at `http://localhost:8787`

#### Database Schema
- Located in `migrations/0001_initial_schema.sql`
- Includes tables for documents, embeddings, collection runs, and OAuth clients
- Use `npm run db:migrate:dev` to apply migrations

#### Testing Strategy
- **Unit Tests**: Located in `src/__tests__/`
- **Mocking**: OpenAI Agents SDK is mocked for testing
- **Test Setup**: Uses Jest with TypeScript support
- **Coverage**: Run `npm run test:coverage` for coverage reports

### Common Development Patterns

#### Error Handling
- Use structured logging with `Logger` utility
- Implement retries with exponential backoff
- Handle OpenAI API rate limits gracefully

#### Adding New Agents
1. Create agent class in `src/agents/`
2. Implement required interfaces
3. Add to main agent orchestration
4. Write comprehensive tests

#### MCP Tool Development
- Define tools in `src/server/mcp/http-transport.ts`
- Use proper JSON schema for input validation
- Return structured responses with content arrays
- Support ChatGPT Deep Research format with `search` and `fetch` tools for research workflows

#### Data Collection Extensions
- Add new collectors in `src/pipeline/collectors/`
- Implement rate limiting and change detection
- Update orchestrator to include new sources

### Performance Considerations

#### Vector Search Optimization
- Use hybrid search combining semantic and keyword matching
- Implement result ranking and filtering
- Cache embeddings to avoid regeneration

#### Rate Limiting
- OpenAI API: 200 requests/minute with exponential backoff
- GitHub API: 300 requests/minute with conditional requests
- Forum API: 100 requests/minute with caching

#### Memory Management
- Process documents in batches (default: 20)
- Stream large datasets to avoid memory issues
- Implement proper cleanup after job processing

### Deployment Notes

#### Cloudflare Workers Configuration
- Uses `wrangler.toml` for environment-specific settings
- Requires D1 database and Vectorize index setup
- Environment variables managed via Wrangler secrets

#### Production Considerations
- Set `ENVIRONMENT=production` in production
- Configure proper OAuth redirect URIs
- Monitor performance and error rates
- Use AI Gateway for cost optimization (optional)

This architecture provides a robust, scalable foundation for an AI-powered knowledge system with comprehensive search capabilities and MCP integration.
