// Main agent implementation using OpenAI Agents SDK
// Orchestrates RAG search, web search fallback, and translation
// OpenAI Agents SDK: https://github.com/openai/openai-agents-js

import {
  Agent,
  run,
  InputGuardrailTripwireTriggered,
  withTrace,
} from "@openai/agents";

import type { Env } from "@/env";
import { POLICY_MESSAGE } from "@/agents/guardrails/input-guardrails";
import { createRAGAgent } from "@/agents/rag-agent";
import { createWebSearchAgent } from "@/agents/web-search-agent";
import { TranslatorAgent } from "@/agents/translator-agent";
import { createRAGResultEvaluatorAgent } from "@/agents/rag-result-evaluator-agent";
import { Logger } from "@/logger";

// Response interface for main agent queries
export interface MainAgentResponse {
  questionLanguage: string;
  content: string;
  sources: string[];
  confidence: number;
  timestamp: string;
}

// Main agent interface for processing queries
export interface MainAgent {
  processQuery(query: string): Promise<MainAgentResponse>;
  generateResponse(prompt: string): Promise<string>;
}

// Factory function to create main agent instance
export function createMainAgent(env: Env): MainAgent {
  return new MainAgentImpl(env);
}

// Main agent implementation orchestrating multiple specialized agents
export class MainAgentImpl implements MainAgent {
  private env: Env;
  private ragAgent: Agent | null = null;
  private webSearchAgent: Agent | null = null;

  constructor(env: Env) {
    this.env = env;
  }

  // Lazy initialization of RAG agent
  private async getRAGAgent(): Promise<Agent> {
    if (!this.ragAgent) {
      this.ragAgent = await createRAGAgent(this.env);
    }
    return this.ragAgent!;
  }

  // Lazy initialization of web search agent
  private async getWebSearchAgent(): Promise<Agent> {
    if (!this.webSearchAgent) {
      this.webSearchAgent = await createWebSearchAgent(this.env);
    }
    return this.webSearchAgent!;
  }

  // Evaluate if RAG search result is insufficient and requires web search fallback
  private async isRAGResultInsufficient(response: string): Promise<boolean> {
    try {
      if (!this.env.OPENAI_API_KEY) {
        throw new Error("OpenAI API key not configured");
      }

      // Use dedicated evaluator agent to assess response quality
      const resultEvaluator = await createRAGResultEvaluatorAgent(this.env);
      const evaluation = await run(
        resultEvaluator,
        `Evaluate this response for technical sufficiency: "${response}"`,
      );
      const result = evaluation.finalOutput?.trim().toUpperCase();
      return result === "INSUFFICIENT";
    } catch (error) {
      Logger.warn(
        "Agent evaluation failed, falling back to string matching:",
        error,
      );

      // Fallback to string matching for insufficient response indicators
      const insufficientIndicators = [
        "No relevant information found",
        "low-quality or fragmented",
        "RAG search failed",
        "knowledge base may be empty",
        "didn't match any indexed content",
      ];

      return insufficientIndicators.some((indicator) =>
        response.toLowerCase().includes(indicator.toLowerCase()),
      );
    }
  }

  // Main query processing method with tracing, translation, and fallback logic
  async processQuery(query: string): Promise<MainAgentResponse> {
    // Use OpenAI Agents SDK tracing for observability
    // withTrace creates a trace span for monitoring and debugging
    return await withTrace("OpenAI SDK Knowledge MCP Agent", async () => {
      try {
        // Step 1: Translate query to English if needed
        const translator = new TranslatorAgent(this.env);
        const translationResult = await translator.processQuery(query);
        const englishQuery = translationResult.translatedText;

        let agentResponse;
        let usedWebSearch = false;

        try {
          // Step 2: Try RAG search first
          const ragAgent = await this.getRAGAgent();
          agentResponse = await run(ragAgent, englishQuery);

          // Step 3: Check if RAG result is insufficient, fallback to web search
          if (
            this.env.ENABLE_WEB_SEARCH_FALLBACK !== "false" &&
            (await this.isRAGResultInsufficient(
              agentResponse.finalOutput || "",
            ))
          ) {
            Logger.info("RAG results insufficient, falling back to web search");
            const webSearchAgent = await this.getWebSearchAgent();
            agentResponse = await run(
              webSearchAgent,
              `The RAG system couldn't find sufficient information for this query. Please search the web for: ${englishQuery}`,
            );
            usedWebSearch = true;
          }
        } catch (error) {
          // Handle input guardrail violations
          if (error instanceof InputGuardrailTripwireTriggered) {
            const translatedResponse = await translator.processResponse(
              POLICY_MESSAGE,
              translationResult.originalLanguage,
            );
            return {
              questionLanguage: translationResult.originalLanguage,
              content: translatedResponse,
              sources: [],
              confidence: 0.0,
              timestamp: new Date().toISOString(),
            };
          }

          // Step 4: If RAG fails, fallback to web search
          Logger.warn("RAG agent failed, falling back to web search:", error);
          const enableWebSearchFallback =
            this.env.ENABLE_WEB_SEARCH_FALLBACK !== "false";
          if (enableWebSearchFallback) {
            const webSearchAgent = await this.getWebSearchAgent();
            agentResponse = await run(
              webSearchAgent,
              `Please search the web for: ${englishQuery}`,
            );
            usedWebSearch = true;
          } else {
            throw error;
          }
        }

        // Step 5: Translate response back to original language if needed
        let translatedResponse = agentResponse.finalOutput || "";
        if (translationResult.originalLanguage !== "en") {
          const translator = new TranslatorAgent(this.env);
          translatedResponse = await translator.processResponse(
            translatedResponse,
            translationResult.originalLanguage,
          );
        }

        return {
          questionLanguage: translationResult.originalLanguage,
          content: translatedResponse,
          sources: [usedWebSearch ? "web_search" : "rag_search"],
          confidence: usedWebSearch ? 0.8 : 0.9,
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        return {
          questionLanguage: "en",
          content: `Error processing query: ${error instanceof Error ? error.message : "Unknown error"}`,
          sources: [],
          confidence: 0.0,
          timestamp: new Date().toISOString(),
        };
      }
    });
  }

  // Simplified interface for generating text responses
  async generateResponse(prompt: string): Promise<string> {
    const response = await this.processQuery(prompt);
    return response.content;
  }
}
