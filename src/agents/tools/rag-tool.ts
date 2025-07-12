import { z } from "zod";
import { tool, Tool } from "@openai/agents";

import type { VectorStore } from "@/storage/vector-store";
import type { TranslatorAgent } from "@/agents/translator-agent";
import { Logger } from "@/logger";

export function createRAGSearchTool(
  vectorStore: VectorStore,
  programmingLanguage: string | undefined,
  translator: TranslatorAgent,
): Tool {
  return tool({
    name: "rag_search",
    description:
      "Search the OpenAI documentation and knowledge base using RAG (Retrieval Augmented Generation). Use this tool first to find relevant context before considering web search.",
    parameters: z.object({
      query: z
        .string()
        .describe(
          "The search query to find relevant documentation and context",
        ),
      language: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Language code for translation (e.g., 'ja', 'es', 'fr'). Defaults to 'en'.",
        ),
      maxResults: z
        .number()
        .nullable()
        .optional()
        .describe(
          "Maximum number of search results to return. Defaults to 10.",
        ),
    }),
    execute: async (params) => {
      try {
        const { query, language = "en", maxResults } = params;

        Logger.info(`RAG search initiated for query: ${query}`);

        const effectiveLanguage = language || "en";
        const translatedQuery =
          effectiveLanguage !== "en"
            ? await translator.translateToEnglish(query, effectiveLanguage)
            : query;

        const searchResults = await vectorStore.search(
          translatedQuery,
          programmingLanguage,
          maxResults ?? 10,
        );

        if (!searchResults || searchResults.length === 0) {
          Logger.info("No RAG results found for query");
          return "No relevant information found in the knowledge base. The knowledge base may be empty or the query didn't match any indexed content. You should use web search to find current information.";
        }
        if (searchResults.length === 0) {
          Logger.info("No high-quality RAG results found for query");
          return "Found some matches in the knowledge base, but they appear to be low-quality or fragmented. You should use web search to find better information.";
        }

        const context = searchResults
          .map((result) => {
            const title =
              result.metadata?.title + " " + (result.metadata?.url ?? "");
            return `## ${title} \n\n${result.content.trim()}`;
          })
          .join("\n\n---\n\n");

        Logger.info(
          `RAG search completed with ${searchResults.length} high-quality results`,
        );

        return `Found ${searchResults.length} relevant documents in the knowledge base:\n\n${context}\n\n---\n\nThis information is from the OpenAI documentation knowledge base. If you need more current or specific information, consider using web search.`;
      } catch (error) {
        Logger.error("RAG search failed:", error);
        return `RAG search failed: ${error instanceof Error ? error.message : "Unknown error"}`;
      }
    },
  });
}
