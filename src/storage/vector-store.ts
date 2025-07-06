// Vector store implementation using Cloudflare Vectorize
// Provides semantic (vector) search
// Cloudflare Vectorize: https://developers.cloudflare.com/vectorize/

import type { VectorizeIndex } from "@cloudflare/workers-types";

import type { EmbeddedDocument } from "@/pipeline/processors/embeddings";
import { EmbeddingGeneratorImpl } from "@/pipeline/processors/embeddings";
import { Logger } from "@/logger";
import { RateLimiter } from "@/rate-limiter";
import { Env } from "@/env";

// Search options for vector store queries
export interface DocumentSearchOptions {
  limit?: number;
  threshold?: number;
  filter?: Record<string, any>;
}

// Search result from vector store
export interface DocumentSearchResult {
  id: string;
  content: string;
  score: number;
  metadata: any;
}

// Singleton instance for vector store
let vectorStore: VectorStore | null = null;

// Factory function to get vector store instance
export async function getVectorStore(env: Env): Promise<VectorStore> {
  if (!vectorStore) {
    vectorStore = new VectorStoreImpl(env);
  }
  return vectorStore;
}

// Vector store interface for document storage and retrieval
export interface VectorStore {
  store(documents: EmbeddedDocument[]): Promise<void>;
  searchWithOptions(
    query: string,
    options: DocumentSearchOptions,
  ): Promise<DocumentSearchResult[]>;
  search(query: string, limit: number): Promise<DocumentSearchResult[]>;
}

// Vector store implementation using Cloudflare Vectorize and D1 Database
// Provides high-performance vector search with hybrid search capabilities
export class VectorStoreImpl implements VectorStore {
  private vectorizeRateLimiter: RateLimiter;
  private vectorize: VectorizeIndex;
  private openaiApiKey: string;

  constructor(env: Env) {
    this.openaiApiKey = env.OPENAI_API_KEY;

    // Use environment-specific Vectorize index
    // Production vs development environments have separate indexes
    this.vectorize =
      env.ENVIRONMENT === "production"
        ? env.VECTORIZE_PROD!
        : env.VECTORIZE_DEV!;

    // Rate limiter for Vectorize API calls
    // Cloudflare Vectorize has rate limits that need to be respected
    this.vectorizeRateLimiter = new RateLimiter({
      requestsPerMinute: 100,
      retryAttempts: 5,
      baseDelayMs: 2000,
    });
  }

  // Store embedded documents in Cloudflare Vectorize
  // Documents are stored as vectors for semantic search
  async store(documents: EmbeddedDocument[]): Promise<void> {
    if (documents.length === 0) {
      Logger.lazyDebug(() => "No documents to store, skipping");
      return;
    }

    try {
      Logger.lazyDebug(
        () => `Storing ${documents.length} documents in vector store`,
      );

      if (!this.vectorize) {
        throw new Error(
          "Vectorize index not available - cannot store documents",
        );
      }

      Logger.lazyDebug(() => "Storing documents in Vectorize");
      await this.storeInVectorize(documents);

      Logger.info(`Successfully stored ${documents.length} documents`);
    } catch (error) {
      Logger.error("Error storing documents in vector store:", {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        documentsCount: documents.length,
      });
      throw new Error(
        `Failed to store documents: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  async searchWithOptions(
    query: string,
    options: DocumentSearchOptions = {},
  ): Promise<DocumentSearchResult[]> {
    if (!this.vectorize) {
      throw new Error("Vectorize index not available - cannot perform search");
    }

    try {
      Logger.lazyDebug(
        () =>
          `Performing vector search for query: "${query.substring(0, 100)}"`,
      );
      const embeddingGen = new EmbeddingGeneratorImpl(this.openaiApiKey);
      const queryEmbedding = await embeddingGen.generateEmbeddings([query]);

      Logger.lazyDebug(
        () => `Querying Vectorize with topK: ${options.limit || 10}`,
      );
      const vectorResults = await this.vectorize.query(queryEmbedding[0], {
        topK: options.limit || 10,
        returnMetadata: "all",
      });

      const results = vectorResults.matches.map((match: any) => ({
        id: match.id,
        content: String(match.metadata?.content || ""),
        score: match.score || 0,
        metadata: match.metadata || {},
      }));

      Logger.lazyDebug(
        () => `Vectorize search returned ${results.length} results`,
      );
      return results;
    } catch (error) {
      Logger.error("Error searching vectors:", error);
      throw new Error(
        `Failed to search: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  async search(query: string, limit: number): Promise<DocumentSearchResult[]> {
    try {
      return await this.searchWithOptions(query, {
        limit,
        threshold: 0.3,
      });
    } catch (error) {
      Logger.error("Error in hybrid search:", error);
      return [];
    }
  }

  private async storeInVectorize(documents: EmbeddedDocument[]): Promise<void> {
    const BATCH_SIZE = 100;

    try {
      for (let i = 0; i < documents.length; i += BATCH_SIZE) {
        const batch = documents.slice(i, i + BATCH_SIZE);
        const vectors = batch.map((doc) => ({
          id: doc.id,
          values: doc.embedding,
          metadata: {
            content: doc.content.substring(0, 2000),
            ...doc.metadata,
          },
        }));

        Logger.lazyDebug(
          () =>
            `Processing Vectorize batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(documents.length / BATCH_SIZE)} with ${vectors.length} vectors`,
        );

        await this.vectorizeRateLimiter.executeWithRateLimit(async () => {
          await this.vectorize!.upsert(vectors);
        });

        if (i < documents.length - BATCH_SIZE) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    } catch (error) {
      Logger.error("Error storing in Vectorize:", error);
      throw error;
    }
  }
}
