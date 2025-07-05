import {
  Agent,
  run,
  InputGuardrailTripwireTriggered,
  withTrace,
} from "@openai/agents";

import type { Env } from "@/env";
import { POLICY_MESSAGE } from "@/agents/guardrails/input-guardrails";
import { createRAGAgent } from "@/agents/rag-agent";
import { createWebSearchAgent } from "@/agents/web-sesarch-agent";
import { TranslatorAgent } from "@/agents/translator-agent";
import { createRAGResultEvaluatorAgent } from "@/agents/rag-result-evaluator-agent";

export interface MainAgentResponse {
  questionLanguage: string;
  content: string;
  sources: string[];
  confidence: number;
  timestamp: string;
}

export interface MainAgent {
  processQuery(query: string): Promise<MainAgentResponse>;
  generateResponse(prompt: string): Promise<string>;
}

export function createMainAgent(env: Env): MainAgent {
  return new MainAgentImpl(env);
}

export class MainAgentImpl implements MainAgent {
  private env: Env;
  private ragAgent: Agent | null = null;
  private webSearchAgent: Agent | null = null;

  constructor(env: Env) {
    this.env = env;
  }

  private async getRAGAgent(): Promise<Agent> {
    if (!this.ragAgent) {
      this.ragAgent = await createRAGAgent(this.env);
    }
    return this.ragAgent!;
  }

  private async getWebSearchAgent(): Promise<Agent> {
    if (!this.webSearchAgent) {
      this.webSearchAgent = await createWebSearchAgent(this.env);
    }
    return this.webSearchAgent!;
  }

  private async isRAGResultInsufficient(response: string): Promise<boolean> {
    try {
      if (!this.env.OPENAI_API_KEY) {
        throw new Error("OpenAI API key not configured");
      }
      const resultEvaluator = await createRAGResultEvaluatorAgent(this.env);
      const evaluation = await run(
        resultEvaluator,
        `Evaluate this response for technical sufficiency: "${response}"`,
      );
      const result = evaluation.finalOutput?.trim().toUpperCase();
      return result === "INSUFFICIENT";
    } catch (error) {
      console.warn(
        "Agent evaluation failed, falling back to string matching:",
        error,
      );
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

  async processQuery(query: string): Promise<MainAgentResponse> {
    return await withTrace("OpenAI SDK Knowledge MCP Agent", async () => {
      try {
        const translator = new TranslatorAgent(this.env);
        const translationResult = await translator.processQuery(query);
        const englishQuery = translationResult.translatedText;

        let agentResponse;
        let usedWebSearch = false;

        try {
          const ragAgent = await this.getRAGAgent();
          agentResponse = await run(ragAgent, englishQuery);

          if (
            this.env.ENABLE_WEB_SEARCH_FALLBACK !== "false" &&
            (await this.isRAGResultInsufficient(
              agentResponse.finalOutput || "",
            ))
          ) {
            console.log("RAG results insufficient, falling back to web search");
            const webSearchAgent = await this.getWebSearchAgent();
            agentResponse = await run(
              webSearchAgent,
              `The RAG system couldn't find sufficient information for this query. Please search the web for: ${englishQuery}`,
            );
            usedWebSearch = true;
          }
        } catch (error) {
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

          console.log("RAG agent failed, falling back to web search:", error);
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

  async generateResponse(prompt: string): Promise<string> {
    const response = await this.processQuery(prompt);
    return response.content;
  }
}
