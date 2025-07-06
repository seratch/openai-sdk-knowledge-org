// MCP (Model Context Protocol) server implementation for OpenAI SDK knowledge
// This provides a standard interface for AI models to access structured knowledge
// MCP Protocol: https://modelcontextprotocol.io/
// MCP Specification: https://spec.modelcontextprotocol.io/
// ChatGPT Deep Research: https://platform.openai.com/docs/mcp

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { InputGuardrailTripwireTriggered } from "@openai/agents";

import type { Env } from "@/env";
import { getVectorStore } from "@/storage/vector-store";
import { POLICY_MESSAGE } from "@/agents/guardrails/input-guardrails";
import { createMainAgent } from "@/agents/main-agent";
import { Logger } from "@/logger";

export const SERVER_NAME = "openai-sdk-mcp";

// MCP Server class implementing the Model Context Protocol
// Provides tools for searching OpenAI SDK knowledge and documentation
export class MCPServer {
  private server: Server;
  private env: Env;

  constructor(env: Env) {
    this.env = env;

    // Initialize MCP server with capabilities and metadata
    this.server = new Server(
      { name: SERVER_NAME, version: "1.0.0" },
      {
        capabilities: {
          tools: {}, // Enable tool calling capability
          resources: {}, // Enable resource access capability
        },
        instructions:
          "This MCP server helps developers to learn how to use OpenAI platform features and its SDKs. You can ask questions on how to call APIs, code examples using OpenAI Angents SDK for Python/TypeScript, and other questions on the platform features.",
      },
    );

    // Initialize callback (currently no-op)
    this.server.oninitialized = () => {};

    // Handle tool listing requests
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: buildTools(false) };
    });

    // Handle tool execution requests
    // Route to appropriate tool implementation based on tool name
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      if (!args) {
        throw new Error("Tool arguments are required");
      }
      switch (name) {
        case TOOL_ANSWER_OPENAI_QUESTIONS:
          return await this.callAnswerQuestion(args);
        case TOOL_SEARCH_OPENAI_RESOURCES:
          return await this.callSearchResources(args);
        case TOOL_CHATGPT_DR_SEARCH:
          return await this.callChatGPTDRSearch(args);
        case TOOL_CHATGPT_DR_FETCH:
          return await this.callChatGPTDRFetch(args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  // Standard MCP search tool implementation
  // Uses RAG agent with web search fallback for comprehensive answers
  async callAnswerQuestion({ query }: Record<string, any>): Promise<{
    content: Array<{ type: string; text: string }>;
  }> {
    try {
      if (!this.env.OPENAI_API_KEY) {
        return {
          content: [
            { type: "text", text: "Error: OpenAI API key not configured" },
          ],
        };
      }
      try {
        // Use main agent which orchestrates RAG and web search
        const agent = createMainAgent(this.env);
        const result = await agent.generateResponse(query);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (error) {
        // Handle input guardrail violations
        if (error instanceof InputGuardrailTripwireTriggered) {
          return {
            content: [{ type: "text" as const, text: POLICY_MESSAGE }],
          };
        }
        throw error;
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error searching documentation: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  }

  async callSearchResources(args: Record<string, any>): Promise<{
    content: Array<{
      type: string;
      uri: string;
      name: string;
      description: string;
      mimeType: string;
    }>;
  }> {
    const { query, limit = 10 } = args;
    try {
      if (!this.env.OPENAI_API_KEY) {
        return { content: [] };
      }

      // Use vector store for semantic search
      const vectorStore = await getVectorStore(this.env);
      const searchResults = await vectorStore.search(query, limit * 2);
      const content = searchResults.slice(0, limit).map((result) => {
        return {
          type: "resource_link",
          uri:
            result.metadata?.url ||
            result.metadata?.sourceUrl ||
            "https://platform.openai.com/docs",
          name:
            result.metadata?.title ||
            result.metadata?.sourceTitle ||
            "OpenAI Documentation",
          description:
            result.content.substring(0, 500) +
            (result.content.length > 500 ? "..." : ""),
          mimeType: "text/plain",
        };
      });
      const response = { content };
      Logger.lazyDebug(() => `search result: ${JSON.stringify(response)}`);
      return response;
    } catch (error) {
      return { content: [] };
    }
  }

  // ChatGPT Deep Research search tool implementation
  // Returns structured search results for research workflows
  // ChatGPT Deep Research: https://platform.openai.com/docs/mcp
  async callChatGPTDRSearch(
    args: Record<string, any>,
  ): Promise<{ results: ChatGPTDRSearchResult[] }> {
    const { query, limit = 10 } = args;
    try {
      if (!this.env.OPENAI_API_KEY) {
        return { results: [] };
      }

      // Use vector store for semantic search
      const vectorStore = await getVectorStore(this.env);
      const searchResults = await vectorStore.search(query, limit);

      // Format results for ChatGPT Deep Research connector
      // Each result includes id, title, text snippet, and url
      const results = searchResults.slice(0, limit).map((result) => {
        const url =
          result.metadata?.url ||
          result.metadata?.sourceUrl ||
          "https://platform.openai.com/docs";
        return {
          id: url,
          title:
            result.metadata?.title ||
            result.metadata?.sourceTitle ||
            "OpenAI Documentation",
          text:
            result.content.substring(0, 500) +
            (result.content.length > 500 ? "..." : ""),
          url,
        };
      });
      const response = { results };
      Logger.lazyDebug(() => `search result: ${JSON.stringify(response)}`);
      return response;
    } catch (error) {
      return { results: [] };
    }
  }

  // ChatGPT Deep Research fetch tool implementation
  // Retrieves full document content by ID for detailed analysis
  // ChatGPT Deep Research: https://platform.openai.com/docs/mcp
  async callChatGPTDRFetch(
    args: Record<string, any>,
  ): Promise<ChatGPTDRFetchResult> {
    const { id, limit = 1 } = args;
    try {
      if (!this.env.OPENAI_API_KEY) {
        return {};
      }

      // Search for document by URL/ID
      const vectorStore = await getVectorStore(this.env);
      const results = await vectorStore.search(`url:${id}`, limit);

      // Find matching document by URL
      let matchingResult = results.find(
        (result) =>
          result.metadata?.url === id || result.metadata?.sourceUrl === id,
      );
      if (!matchingResult && results.length > 0) {
        matchingResult = results[0];
      }
      if (!matchingResult) {
        return {};
      }

      // Return full document content with metadata
      const result = {
        id: id,
        title:
          matchingResult.metadata?.title ||
          matchingResult.metadata?.sourceTitle ||
          "OpenAI Documentation",
        text: matchingResult.content,
        url:
          matchingResult.metadata?.url ||
          matchingResult.metadata?.sourceUrl ||
          id,
        metadata: {
          source: "openai-docs",
          timestamp: new Date().toISOString(),
          originalMetadata: matchingResult.metadata,
        },
      };
      Logger.lazyDebug(() => `fetch result: ${JSON.stringify(result)}`);
      return result;
    } catch (error: any) {
      return { error: error.message };
    }
  }
}

// JSON-RPC handler for MCP protocol over HTTP
// Handles the JSON-RPC 2.0 protocol used by MCP clients
// JSON-RPC Specification: https://www.jsonrpc.org/specification
export class JsonRpcHandler {
  private env: Env;
  private mcpServer: MCPServer;

  constructor(env: Env) {
    this.env = env;
    this.mcpServer = new MCPServer(env);
  }

  // Main JSON-RPC request handler
  // Processes MCP protocol requests over HTTP transport
  async handleJsonRpcRequest(
    request: JsonRpcRequest,
    requestHeaders: Record<string, string>,
  ): Promise<JsonRpcResponse> {
    Logger.info(`MCP request: ${JSON.stringify(request, null, 2)}`);

    // Detect ChatGPT Deep Research client by user-agent
    // "user-agent": "openai-mcp/1.0.0"
    const isChatGPTDeepResearch =
      requestHeaders["user-agent"]?.includes("openai-mcp");
    const requestId = request.id ?? null;

    try {
      // Validate JSON-RPC 2.0 format
      if (request.jsonrpc !== "2.0") {
        return this.createErrorResponse(
          JSON_RPC_ERRORS.INVALID_REQUEST,
          requestId,
        );
      }

      // Route to appropriate handler based on method
      switch (request.method) {
        case "initialize":
          return await this.handleInitialize(request);
        case "notifications/initialized":
          if (request.id === undefined || request.id === null) {
            return { jsonrpc: "2.0", result: null, id: null };
          }
          return await this.handleInitialize(request);
        case "list_tools":
        case "tools/list":
          return await this.handleListTools(request, { isChatGPTDeepResearch });
        case "call_tool":
        case "tools/call":
          return await this.handleCallTool(request, { isChatGPTDeepResearch });
        case "list_resources":
        case "resources/list":
          return await this.handleListResources(request);
        case "read_resource":
        case "resources/read":
          return await this.handleReadResource(request);
        default:
          return this.createErrorResponse(
            JSON_RPC_ERRORS.METHOD_NOT_FOUND,
            requestId,
          );
      }
    } catch (error) {
      Logger.error("Error handling JSON-RPC request:", error);
      return this.createErrorResponse(
        {
          code: JSON_RPC_ERRORS.INTERNAL_ERROR.code,
          message: JSON_RPC_ERRORS.INTERNAL_ERROR.message,
          data: error instanceof Error ? error.message : "Unknown error",
        },
        requestId,
      );
    }
  }

  private async handleInitialize(
    request: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    try {
      const params = request.params || {};
      if (!params.protocolVersion) {
        return this.createErrorResponse(
          {
            code: JSON_RPC_ERRORS.INVALID_PARAMS.code,
            message: "protocolVersion is required",
          },
          request.id ?? null,
        );
      }
      return {
        jsonrpc: "2.0",
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: "openai-sdk-mcp", version: "1.0.0" },
          instructions:
            "OpenAI SDK Knowledge MCP server providing expert-level answers about OpenAI API usage",
        },
        id: request.id ?? null,
      };
    } catch (error) {
      Logger.error("Error during initialization:", error);
      return this.createErrorResponse(
        {
          code: JSON_RPC_ERRORS.INTERNAL_ERROR.code,
          message: "Failed to initialize",
          data: error instanceof Error ? error.message : "Unknown error",
        },
        request.id ?? null,
      );
    }
  }

  private async handleListTools(
    request: JsonRpcRequest,
    { isChatGPTDeepResearch }: { isChatGPTDeepResearch: boolean },
  ): Promise<JsonRpcResponse> {
    const requestId = request.id ?? null;
    try {
      return {
        jsonrpc: "2.0",
        result: { tools: buildTools(isChatGPTDeepResearch) },
        id: requestId,
      };
    } catch (error) {
      Logger.error("Error listing tools:", error);
      return this.createErrorResponse(
        {
          code: JSON_RPC_ERRORS.INTERNAL_ERROR.code,
          message: "Failed to list tools",
          data: error instanceof Error ? error.message : "Unknown error",
        },
        requestId,
      );
    }
  }

  private async handleCallTool(
    request: JsonRpcRequest,
    { isChatGPTDeepResearch }: { isChatGPTDeepResearch: boolean },
  ): Promise<JsonRpcResponse> {
    const requestId = request.id ?? null;
    try {
      if (!request.params || !request.params.name) {
        return this.createErrorResponse(
          {
            code: JSON_RPC_ERRORS.INVALID_PARAMS.code,
            message: "Tool name is required",
          },
          requestId,
        );
      }
      const toolName = request.params.name;
      const toolArgs = request.params.arguments || {};
      let result;
      switch (toolName) {
        case TOOL_ANSWER_OPENAI_QUESTIONS:
          result = await this.mcpServer.callAnswerQuestion(toolArgs);
          break;
        case TOOL_SEARCH_OPENAI_RESOURCES:
          result = await this.mcpServer.callSearchResources(toolArgs);
          break;
        case TOOL_CHATGPT_DR_SEARCH:
          if (isChatGPTDeepResearch) {
            result = await this.mcpServer.callChatGPTDRSearch(toolArgs);
          } else {
            result = { results: [] };
          }
          break;
        case TOOL_CHATGPT_DR_FETCH:
          if (isChatGPTDeepResearch) {
            result = await this.mcpServer.callChatGPTDRFetch(toolArgs);
          } else {
            result = {};
          }
          break;
        default:
          return this.createErrorResponse(
            {
              code: JSON_RPC_ERRORS.METHOD_NOT_FOUND.code,
              message: `Unknown tool: ${toolName}`,
            },
            requestId,
          );
      }
      return { jsonrpc: "2.0", result, id: requestId };
    } catch (error) {
      Logger.error("Error calling tool:", error);
      return this.createErrorResponse(
        {
          code: JSON_RPC_ERRORS.INTERNAL_ERROR.code,
          message: "Failed to call tool",
          data: error instanceof Error ? error.message : "Unknown error",
        },
        requestId,
      );
    }
  }

  private async handleListResources(
    request: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    const requestId = request.id ?? null;
    return {
      jsonrpc: "2.0",
      result: { resources: [] },
      id: requestId,
    };
  }

  private async handleReadResource(
    request: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    const requestId = request.id ?? null;
    const { uri } = request.params;
    const vectorStore = await getVectorStore(this.env);
    const results = await vectorStore.search(`url:${uri}`, 1);
    if (results.length === 0) {
      return this.createErrorResponse(
        {
          code: JSON_RPC_ERRORS.METHOD_NOT_FOUND.code,
          message: "Resource not found",
        },
        requestId,
      );
    }
    const result = results[0];
    return {
      jsonrpc: "2.0",
      id: 2,
      result: {
        contents: [
          {
            uri: uri,
            mimeType: "text/plain",
            text: result.content,
          },
        ],
      },
    };
  }

  private createErrorResponse(
    error: JsonRpcError,
    id: string | number | null,
  ): JsonRpcResponse {
    return { jsonrpc: "2.0", error, id };
  }
}

// Types

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: any;
  id?: string | number | null;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  result?: any;
  error?: JsonRpcError;
  id: string | number | null;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: any;
}

export const JSON_RPC_ERRORS = {
  PARSE_ERROR: { code: -32700, message: "Parse error" },
  INVALID_REQUEST: { code: -32600, message: "Invalid Request" },
  METHOD_NOT_FOUND: { code: -32601, message: "Method not found" },
  INVALID_PARAMS: { code: -32602, message: "Invalid params" },
  INTERNAL_ERROR: { code: -32603, message: "Internal error" },
} as const;

export interface ChatGPTDRSearchResult {
  id: string;
  title: string;
  text: string;
  url: string;
}

export type ChatGPTDRFetchResult =
  | {
      id: string;
      title: string;
      text: string;
      url: string;
      metadata?: Record<string, any>;
    }
  | {};

// Tools

export const TOOL_ANSWER_OPENAI_QUESTIONS = "answer_openai_questions";
export const TOOL_SEARCH_OPENAI_RESOURCES = "search_openai_resources";
export const TOOL_CHATGPT_DR_SEARCH = "search";
export const TOOL_CHATGPT_DR_FETCH = "fetch";
export const DEFAULT_TOOLS = [
  {
    name: TOOL_ANSWER_OPENAI_QUESTIONS,
    description:
      "This tool provides a complete answer to a developer's question. It fetches documents and code snippets, and carefully considers the best answer, so it may take a few seconds to respond. You can use this when you need help with how to call OpenAI's APIs (e.g., Responses API, FT, tools, and so on) and the OpenAI Agents SDK. Include details such as programming language, features, and requirements in your query to get better results.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search query about OpenAI SDK code and documents. Be specific about details and include programming language, OpenAI features, module names, and keywords in the query to get better results.",
        },
        limit: {
          type: "number",
          description:
            "Maximum number of search results to return. Higher values provide more comprehensive coverage but may include less relevant results. Recommended: 5-10 for focused searches, 15-20 for broader exploration.",
          default: 10,
        },
      },
      required: ["query"],
    },
  },
  {
    name: TOOL_SEARCH_OPENAI_RESOURCES,
    description:
      "This tool provides a list of documents and code snippets that are relevant to a developer's question. It is a good tool to use when you need to find information about OpenAI's APIs (e.g., Responses API, FT, tools, and so on) and the OpenAI Agents SDK. Also, this tool is much faster than the answer_openai_questions tool, so you can use this tool to get a quick overview of the information you need. When you use this, include details such as programming language, features, and requirements in your query to get better results.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search query about OpenAI SDK code and documents. Be specific about details and include programming language, OpenAI features, module names, and keywords in the query to get better results.",
        },
        limit: {
          type: "number",
          description:
            "Maximum number of search results to return. Higher values provide more comprehensive coverage but may include less relevant results. Recommended: 5-10 for focused searches, 15-20 for broader exploration.",
          default: 10,
        },
      },
      required: ["query"],
    },
  },
];

const CHATGPT_DEEP_RESEARCH_TOOLS = [
  {
    name: TOOL_CHATGPT_DR_SEARCH,
    description:
      "Search tool to act as a ChatGPT Deep Research connector. Use this when you need to search for information from the OpenAI knowledge base.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search query to find relevant documents and information. Be specific about details and include programming language, OpenAI features, module names, and keywords in the query to get better results.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: TOOL_CHATGPT_DR_FETCH,
    description:
      "Fetch tool to act as a ChatGPT Deep Research connector. Use this when you need to fetch the full content of a specific document by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description:
            "Unique identifier of the document to fetch, obtained from search results.",
        },
      },
      required: ["id"],
    },
  },
];

export function buildTools(isChatGPTDeepResearch: boolean) {
  if (isChatGPTDeepResearch) {
    return [...DEFAULT_TOOLS, ...CHATGPT_DEEP_RESEARCH_TOOLS];
  }
  return DEFAULT_TOOLS;
}
