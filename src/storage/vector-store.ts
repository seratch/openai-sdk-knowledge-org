import type { VectorizeIndex, D1Database } from "@cloudflare/workers-types";

import type { EmbeddedDocument } from "@/pipeline/processors/embeddings";
import { EmbeddingGeneratorImpl } from "@/pipeline/processors/embeddings";
import { Logger } from "@/logger";
import { RateLimiter } from "@/rate-limiter";
import { Env } from "@/env";

export interface DocumentSearchOptions {
  limit?: number;
  threshold?: number;
  filter?: Record<string, any>;
}

export interface DocumentSearchResult {
  id: string;
  content: string;
  score: number;
  metadata: any;
}

let vectorStore: VectorStore | null = null;

export async function getVectorStore(env: Env): Promise<VectorStore> {
  if (!vectorStore) {
    vectorStore = new VectorStoreImpl(env);
  }
  return vectorStore;
}

export interface VectorStore {
  store(documents: EmbeddedDocument[]): Promise<void>;
  searchWithOptions(
    query: string,
    options: DocumentSearchOptions,
  ): Promise<DocumentSearchResult[]>;
  search(query: string, limit: number): Promise<DocumentSearchResult[]>;
}

export class VectorStoreImpl implements VectorStore {
  private vectorizeRateLimiter: RateLimiter;
  private vectorize: VectorizeIndex;
  private db: D1Database;
  private openaiApiKey: string;

  constructor(env: Env) {
    this.openaiApiKey = env.OPENAI_API_KEY;
    this.vectorize =
      env.ENVIRONMENT === "production"
        ? env.VECTORIZE_PROD!
        : env.VECTORIZE_DEV!;
    this.db = env.DB;
    this.vectorizeRateLimiter = new RateLimiter({
      requestsPerMinute: 100,
      retryAttempts: 5,
      baseDelayMs: 2000,
    });
  }

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

  private async getAllEmbeddings(): Promise<
    Array<{ id: string; embedding: string; content: string; metadata: string }>
  > {
    const stmt = this.db.prepare(`
      SELECT e.id, e.embedding, d.content, d.metadata
      FROM embeddings e
      JOIN documents d ON e.id = d.id
    `);

    const result = await stmt.all();
    return result.results as Array<{
      id: string;
      embedding: string;
      content: string;
      metadata: string;
    }>;
  }

  private async optimizedVectorSearch(
    queryEmbedding: number[],
    limit: number = 10,
    threshold: number = 0.3,
  ): Promise<DocumentSearchResult[]> {
    const BATCH_SIZE = 50;
    const MAX_CANDIDATES = 200;

    let totalEmbeddings = 0;

    try {
      const countStmt = this.db.prepare(
        `SELECT COUNT(*) as count FROM embeddings`,
      );
      const countResult = await countStmt.first();
      totalEmbeddings = (countResult as any)?.count || 0;

      if (totalEmbeddings === 0) {
        Logger.lazyDebug(() => "No embeddings found in database");
        return [];
      }

      Logger.lazyDebug(
        () =>
          `Processing ${Math.min(totalEmbeddings, MAX_CANDIDATES)} embeddings in batches of ${BATCH_SIZE}`,
      );

      const allResults: DocumentSearchResult[] = [];
      const embeddingGen = new EmbeddingGeneratorImpl(this.openaiApiKey!);

      const shouldSample = totalEmbeddings > MAX_CANDIDATES;
      const sampleRate = shouldSample ? MAX_CANDIDATES / totalEmbeddings : 1;

      let offset = 0;
      let processedCount = 0;

      while (offset < totalEmbeddings && processedCount < MAX_CANDIDATES) {
        const batchStmt = this.db.prepare(`
          SELECT e.id, e.embedding, d.content, d.metadata, e.created_at
          FROM embeddings e
          JOIN documents d ON e.id = d.id
          ORDER BY e.created_at DESC
          LIMIT ? OFFSET ?
        `);

        const batchResult = await batchStmt.bind(BATCH_SIZE, offset).all();
        const batch = batchResult.results as Array<{
          id: string;
          embedding: string;
          content: string;
          metadata: string;
          created_at: string;
        }>;

        if (batch.length === 0) break;

        const batchToProcess = shouldSample
          ? batch.filter(() => Math.random() < sampleRate)
          : batch;

        if (batchToProcess.length > 0) {
          const embeddings = batchToProcess.map((row) =>
            JSON.parse(row.embedding),
          );
          const similarities = embeddingGen.calculateSimilarity(
            queryEmbedding,
            embeddings,
          );

          const batchResults = batchToProcess
            .map((row, index) => ({
              id: row.id,
              content: row.content || "",
              score: similarities[index],
              metadata: row.metadata ? JSON.parse(row.metadata) : {},
            }))
            .filter((result) => result.score >= threshold);

          allResults.push(...batchResults);
          processedCount += batchToProcess.length;
        }

        offset += BATCH_SIZE;

        if (allResults.length >= limit * 3) {
          Logger.lazyDebug(
            () => `Early termination: found ${allResults.length} candidates`,
          );
          break;
        }
      }

      const finalResults = allResults
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      Logger.lazyDebug(
        () =>
          `Optimized search processed ${processedCount}/${totalEmbeddings} embeddings, found ${finalResults.length} results`,
      );
      return finalResults;
    } catch (error) {
      Logger.error("Error in optimized vector search:", error);
      if (totalEmbeddings < 1000) {
        Logger.lazyDebug(
          () => "Falling back to original search method for small dataset",
        );
        return this.fallbackVectorSearch(queryEmbedding, limit, threshold);
      }
      throw error;
    }
  }

  private async fallbackVectorSearch(
    queryEmbedding: number[],
    limit: number,
    threshold: number,
  ): Promise<DocumentSearchResult[]> {
    const allEmbeddings = await this.getAllEmbeddings();

    if (allEmbeddings.length === 0) {
      return [];
    }

    const embeddingGen = new EmbeddingGeneratorImpl(this.openaiApiKey!);
    const embeddings = allEmbeddings.map((row) => JSON.parse(row.embedding));
    const similarities = embeddingGen.calculateSimilarity(
      queryEmbedding,
      embeddings,
    );

    return allEmbeddings
      .map((row, index) => ({
        id: row.id,
        content: row.content || "",
        score: similarities[index],
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
      }))
      .filter((result) => result.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private countOccurrences(text: string, term: string): number {
    const regex = new RegExp(
      `\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "gi",
    );
    const matches = text.match(regex);
    return matches ? matches.length : 0;
  }

  private async calculateDocumentFrequencies(
    keywords: string[],
    documents: any[],
  ): Promise<Map<string, number>> {
    const frequencies = new Map<string, number>();

    for (const keyword of keywords) {
      const keywordLower = keyword.toLowerCase();
      let documentCount = 0;

      for (const doc of documents) {
        const content = (doc.content || "").toLowerCase();
        if (this.countOccurrences(content, keywordLower) > 0) {
          documentCount++;
        }
      }

      frequencies.set(keywordLower, Math.max(1, documentCount));
    }

    return frequencies;
  }

  private mergeMultipleKeywordResults(
    parallelResults: Array<{
      results: DocumentSearchResult[];
      method: string;
      confidence: number;
    }>,
  ): DocumentSearchResult[] {
    const resultMap = new Map<string, DocumentSearchResult>();

    const methodWeights = {
      llm: 0.4,
      regex: 0.3,
      ngram: 0.3,
      fallback: 0.2,
    };

    for (const { results, method, confidence } of parallelResults) {
      const weight =
        (methodWeights[method as keyof typeof methodWeights] || 0.2) *
        confidence;

      for (const result of results) {
        const existing = resultMap.get(result.id);
        const weightedScore = result.score * weight;

        if (existing) {
          existing.score =
            Math.max(existing.score, weightedScore) + weightedScore * 0.1;
        } else {
          resultMap.set(result.id, {
            ...result,
            score: weightedScore,
          });
        }
      }
    }

    return Array.from(resultMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }

  private mergeResults(
    vectorResults: DocumentSearchResult[],
    keywordResults: DocumentSearchResult[],
  ): DocumentSearchResult[] {
    const resultMap = new Map<string, DocumentSearchResult>();

    vectorResults.forEach((result) => {
      resultMap.set(result.id, {
        ...result,
        score: result.score * 0.7,
      });
    });

    keywordResults.forEach((result) => {
      const existing = resultMap.get(result.id);
      if (existing) {
        existing.score =
          Math.max(existing.score, result.score * 0.3) + result.score * 0.1;
      } else {
        resultMap.set(result.id, {
          ...result,
          score: result.score * 0.3,
        });
      }
    });

    return Array.from(resultMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }
}
