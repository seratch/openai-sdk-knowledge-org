import OpenAI from "openai";

import { Logger } from "@/logger";
import { RateLimiter } from "@/rate-limiter";
import { buildOpenAIClientForOnlineAccess } from "@/oepnai-client";
import { Env } from "@/env";

export interface KeywordExtractionResult {
  keywords: string[];
  extractionMethod: "llm" | "regex" | "ngram" | "fallback";
  confidence?: number;
}

export class KeywordExtractorAgent {
  private openai: OpenAI;
  private rateLimiter: RateLimiter;
  private cache = new Map<
    string,
    { result: KeywordExtractionResult[]; timestamp: number }
  >();
  private readonly CACHE_TTL = 30 * 60 * 1000;

  constructor(env: Env) {
    this.openai = buildOpenAIClientForOnlineAccess(env);
    this.rateLimiter = new RateLimiter({
      requestsPerMinute: 100,
      retryAttempts: 2,
      baseDelayMs: 500,
    });
  }

  async extractKeywords(query: string): Promise<KeywordExtractionResult[]> {
    const cacheKey = `keywords:${query.toLowerCase()}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      Logger.lazyDebug(
        () => `Cache hit for keyword extraction: ${query.substring(0, 50)}`,
      );
      return cached.result;
    }

    try {
      const [llmResult, regexResult, ngramResult] = await Promise.all([
        this.extractLLMKeywords(query),
        this.extractRegexKeywords(query),
        this.extractNgramKeywords(query),
      ]);

      const results = [llmResult, regexResult, ngramResult];
      this.cache.set(cacheKey, { result: results, timestamp: Date.now() });
      this.cleanupCache();

      Logger.lazyDebug(
        () =>
          `Parallel keyword extraction for "${query.substring(0, 50)}": LLM(${llmResult.keywords.length}), Regex(${regexResult.keywords.length}), N-gram(${ngramResult.keywords.length})`,
      );
      return results;
    } catch (error) {
      Logger.warn(
        `Parallel keyword extraction failed for "${query.substring(0, 50)}", falling back to basic extraction:`,
        error,
      );
      return [this.fallbackExtraction(query)];
    }
  }

  private async extractLLMKeywords(
    query: string,
  ): Promise<KeywordExtractionResult> {
    try {
      const result = await this.rateLimiter.executeWithRateLimit(async () => {
        const response = await this.openai.responses.create({
          model: "gpt-4.1-nano",
          instructions: `You are a technical keyword extractor specialized in OpenAI API and technology terms. Extract the 5 most important and relevant keywords from the user's query that would be useful for searching OpenAI documentation and code examples.

# Focus on:
- Technology nouns (API, SDK, embeddings, response, etc.)
- OpenAI-specific terms (GPT, ChatGPT, function calling, fine-tuning, etc.)
- Programming concepts (Python, JavaScript, authentication, streaming, etc.)
- Technical actions (generate, create, search, process, etc.)

# Assumed User Context
- If the user says “agents,” assume they are using OpenAI Agents SDK—TypeScript or Python.
- If the user does not name a language, default to Python.
- Use Responses API examples over Chat Completions ones
- Assistants API is now deprecated, use Responses API instead

# Ignore:
- Common words (how, to, use, with, etc.)
- Articles and prepositions (a, an, the, in, on, etc.)
- Generic question words (what, where, when, etc.)

Return exactly 5 keywords separated by commas, in order of relevance. Use lowercase. If the query has fewer than 5 relevant technical terms, repeat the most important ones.

Examples:
"How to use multiple built-in tools with custom function tools in a single agent in Python" → "function tools, built-in tools, python, agent, custom tools"
"What are the rate limits for OpenAI API?" → "rate limits, openai api, limits, api limits, rate limiting"
"Generate embeddings for text search" → "embeddings, text search, generate, vector search, semantic search"`,
          input: query,
          max_output_tokens: 100,
          temperature: 0,
        });

        const extractedText = response.output_text?.trim() || "";
        const keywords = extractedText
          .split(",")
          .map((k) => k.trim().toLowerCase())
          .filter((k) => k.length > 0)
          .slice(0, 5);

        if (keywords.length === 0) {
          throw new Error("No keywords extracted from LLM response");
        }

        return {
          keywords,
          extractionMethod: "llm" as const,
          confidence: 0.9,
        };
      });

      return result;
    } catch (error) {
      Logger.warn(`LLM keyword extraction failed: ${error}`);
      return {
        keywords: [],
        extractionMethod: "llm" as const,
        confidence: 0.0,
      };
    }
  }

  private extractRegexKeywords(query: string): KeywordExtractionResult {
    const openaiTerms = [
      "chat\\.completions?",
      "completions?",
      "embeddings?",
      "fine-?tuning?",
      "assistants?",
      "threads?",
      "messages?",
      "runs?",
      "tools?",
      "function[_\\s]?calling?",
      "images?",
      "audio",
      "speech",
      "transcriptions?",
      "translations?",
      "moderations?",
      "files?",
      "batches?",
      "uploads?",
      "gpt-?4(\\.1)?(-mini|-nano)?",
      "gpt-?3\\.5(-turbo)?",
      "o1(-mini|-preview)?",
      "text-embedding-3-(small|large)",
      "text-embedding-ada-002",
      "whisper-1",
      "dall-?e-[23]",
      "tts-1(-hd)?",
      "temperature",
      "max[_\\s]?tokens?",
      "top[_\\s]?p",
      "frequency[_\\s]?penalty",
      "presence[_\\s]?penalty",
      "stop[_\\s]?sequences?",
      "seed",
      "stream(ing)?",
      "response[_\\s]?format",
      "json[_\\s]?mode",
      "tool[_\\s]?choice",
      "parallel[_\\s]?tool[_\\s]?calls?",
      "system[_\\s]?message",
      "python",
      "javascript",
      "typescript",
      "node\\.?js",
      "curl",
      "bash",
      "openai[_\\s]?sdk",
      "api[_\\s]?key",
      "authentication",
      "authorization",
      "generate?",
      "create",
      "search",
      "process",
      "analyze",
      "summarize",
      "translate",
      "transcribe",
      "moderate",
      "embed",
      "retrieve",
    ];

    const regexPattern = new RegExp(`\\b(${openaiTerms.join("|")})\\b`, "gi");
    const matches = query.match(regexPattern) || [];

    const keywords = [...new Set(matches.map((m) => m.toLowerCase()))].slice(
      0,
      5,
    );

    return {
      keywords,
      extractionMethod: "regex" as const,
      confidence: keywords.length > 0 ? 0.8 : 0.0,
    };
  }

  private extractNgramKeywords(query: string): KeywordExtractionResult {
    const words = query
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2);

    const ngrams = new Set<string>();

    for (let i = 0; i < words.length - 1; i++) {
      const bigram = `${words[i]} ${words[i + 1]}`;
      if (bigram.length > 5) ngrams.add(bigram);
    }

    for (let i = 0; i < words.length - 2; i++) {
      const trigram = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      if (trigram.length > 8) ngrams.add(trigram);
    }

    const significantWords = words.filter(
      (word) =>
        word.length > 4 &&
        ![
          "with",
          "from",
          "that",
          "this",
          "have",
          "will",
          "been",
          "were",
          "they",
          "what",
          "when",
          "where",
          "how",
        ].includes(word),
    );

    const allKeywords = [...ngrams, ...significantWords];
    const keywords = allKeywords.slice(0, 5);

    return {
      keywords,
      extractionMethod: "ngram" as const,
      confidence: keywords.length > 0 ? 0.7 : 0.0,
    };
  }

  private fallbackExtraction(query: string): KeywordExtractionResult {
    const allKeywords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 2);

    const keywords = allKeywords.slice(0, 5);

    return {
      keywords,
      extractionMethod: "fallback" as const,
      confidence: 0.5,
    };
  }

  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.CACHE_TTL) {
        this.cache.delete(key);
      }
    }
  }
}
