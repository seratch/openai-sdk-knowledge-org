import OpenAI from "openai";

import { Logger } from "@/logger";
import { TextProcessorImpl } from "@/pipeline/processors/text-processor";
import { TokenCounter } from "@/pipeline/token-counter";
import { IdUtils } from "@/pipeline/processors/id-utils";
import { buildOpenAIClientForDataPipeline } from "@/oepnai-client";

export interface EmbeddedDocument {
  id: string;
  content: string;
  embedding: number[];
  metadata: any;
}

export interface EmbeddingGenerator {
  generateEmbeddings(texts: string[]): Promise<number[][]>;
  batchProcess(documents: any[]): Promise<EmbeddedDocument[]>;
  calculateSimilarity(query: number[], candidates: number[][]): number[];
  estimateTokenCount(text: string): number;
  splitOversizedDocument(document: any, maxTokens: number): any[];
}

export class EmbeddingGeneratorImpl implements EmbeddingGenerator {
  private openai: OpenAI;
  private textProcessor: TextProcessorImpl;

  constructor(openaiApiKey: string) {
    this.openai = buildOpenAIClientForDataPipeline({
      OPENAI_API_KEY: openaiApiKey,
    });
    this.textProcessor = new TextProcessorImpl();
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      Logger.lazyDebug(() => "No texts provided for embedding generation");
      return [];
    }

    const validatedTexts = this.validateAndSplitTexts(texts);
    const estimatedTokens = TokenCounter.estimateTokensForArray(validatedTexts);

    Logger.lazyDebug(
      () =>
        `Generating embeddings for ${validatedTexts.length} texts (after validation, estimated ${estimatedTokens} tokens)`,
    );
    try {
      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-small",
        input: validatedTexts,
      });

      Logger.lazyDebug(
        () => `Successfully generated ${response.data.length} embeddings`,
      );
      return response.data.map((item: any) => item.embedding);
    } catch (error) {
      Logger.error("Error generating embeddings:", error);
      throw new Error(
        `Failed to generate embeddings: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  async batchProcess(documents: any[]): Promise<EmbeddedDocument[]> {
    const results: EmbeddedDocument[] = [];
    let currentIndex = 0;

    const processedDocuments = this.preprocessDocuments(documents);

    Logger.info(
      `Starting token-aware batch processing of ${processedDocuments.length} documents (${documents.length} original)`,
    );

    while (currentIndex < processedDocuments.length) {
      const remainingDocs = processedDocuments.slice(currentIndex);
      const texts = remainingDocs.map((doc: any) => doc.content);

      const batchSize = TokenCounter.findMaxBatchSize(texts, 100);
      const batch = remainingDocs.slice(0, batchSize);
      const batchTexts = batch.map((doc: any) => doc.content);

      const batchNumber = Math.floor(currentIndex / batchSize) + 1;
      const estimatedTokens = TokenCounter.estimateTokensForArray(batchTexts);

      Logger.lazyDebug(
        () =>
          `Processing batch ${batchNumber} with ${batch.length} documents (estimated ${estimatedTokens} tokens)`,
      );

      let retryCount = 0;
      const maxRetries = 3;

      while (retryCount < maxRetries) {
        try {
          if (!TokenCounter.isWithinLimit(batchTexts)) {
            throw new Error(
              `Batch exceeds token limit: ${estimatedTokens} tokens`,
            );
          }

          const embeddings = await this.generateEmbeddings(batchTexts);

          batch.forEach((doc: any, index: number) => {
            results.push({
              id: doc.id,
              content: doc.content,
              embedding: embeddings[index],
              metadata: doc.metadata,
            });
          });

          const delayMs = Math.min(100 + batch.length * 2, 300);
          Logger.lazyDebug(
            () =>
              `Completed batch ${batchNumber}, processed: ${results.length}/${documents.length}`,
          );
          await this.delay(delayMs);
          break;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          if (
            errorMessage.includes("maximum context length") ||
            errorMessage.includes("token")
          ) {
            Logger.error(
              `Token limit error in batch ${batchNumber}, skipping batch:`,
              error,
            );
            break; // Skip this batch and continue with next
          }

          retryCount++;

          if (error instanceof Error && error.message.includes("token")) {
            const smallerBatchSize = Math.max(1, Math.floor(batchSize / 2));
            Logger.warn(
              `Token limit exceeded, retrying with smaller batch size: ${smallerBatchSize}`,
            );

            if (smallerBatchSize < batchSize) {
              const smallerBatch = batch.slice(0, smallerBatchSize);
              const smallerTexts = smallerBatch.map((doc: any) => doc.content);

              try {
                const embeddings = await this.generateEmbeddings(smallerTexts);
                smallerBatch.forEach((doc: any, index: number) => {
                  results.push({
                    id: doc.id,
                    content: doc.content,
                    embedding: embeddings[index],
                    metadata: doc.metadata,
                  });
                });

                currentIndex += smallerBatchSize;
                break;
              } catch (smallerError) {
                Logger.error(`Failed even with smaller batch:`, smallerError);
              }
            }
          }

          if (retryCount >= maxRetries) {
            Logger.error(
              `Failed to process batch ${batchNumber} after ${maxRetries} attempts:`,
              error,
            );
            break; // Continue with next batch instead of throwing
          }

          const backoffDelay =
            1000 * Math.pow(2, retryCount) + Math.random() * 1000;
          Logger.warn(
            `Batch ${batchNumber} failed, retrying in ${backoffDelay}ms:`,
            error,
          );
          await this.delay(backoffDelay);
        }
      }

      currentIndex += batchSize;
    }

    Logger.info(
      `Completed token-aware batch processing: ${results.length} documents embedded`,
    );
    return results;
  }

  calculateSimilarity(query: number[], candidates: number[][]): number[] {
    return candidates.map((candidate) =>
      this.cosineSimilarity(query, candidate),
    );
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vectors must have the same length");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);

    if (magnitude === 0) {
      return 0;
    }

    return dotProduct / magnitude;
  }

  estimateTokenCount(text: string): number {
    return TokenCounter.estimateTokens(text);
  }

  splitOversizedDocument(
    document: any,
    maxTokens: number = TokenCounter.SAFE_TOKEN_LIMIT,
  ): any[] {
    const tokenCount = this.estimateTokenCount(document.content);

    if (tokenCount <= maxTokens) {
      return [document];
    }

    Logger.lazyDebug(
      () =>
        `Document ${document.id} has ~${tokenCount} tokens, splitting into chunks`,
    );

    const chunks = this.textProcessor.chunkDocuments([
      {
        id: document.id,
        content: document.content,
        metadata: document.metadata || {},
        source: document.source || "unknown",
      },
    ]);

    return chunks.map((chunk, index) => ({
      id: IdUtils.ensureSafeId(`${document.id}_chunk_${index}`),
      content: chunk.content,
      metadata: {
        ...document.metadata,
        originalDocumentId: document.id,
        chunkIndex: index,
        isChunk: true,
      },
      source: document.source,
    }));
  }

  private preprocessDocuments(documents: any[]): any[] {
    const processedDocs: any[] = [];

    for (const doc of documents) {
      const tokenCount = this.estimateTokenCount(doc.content);

      if (tokenCount > TokenCounter.SAFE_TOKEN_LIMIT) {
        Logger.lazyDebug(
          () =>
            `Document ${doc.id} exceeds token limit (~${tokenCount} tokens), splitting`,
        );
        const chunks = this.splitOversizedDocument(doc);
        processedDocs.push(...chunks);
      } else {
        processedDocs.push(doc);
      }
    }

    return processedDocs;
  }

  private validateAndSplitTexts(texts: string[]): string[] {
    const validatedTexts: string[] = [];

    for (const text of texts) {
      const tokenCount = this.estimateTokenCount(text);

      if (tokenCount > TokenCounter.SAFE_TOKEN_LIMIT) {
        Logger.info(
          `Text exceeds token limit (~${tokenCount} tokens), truncating`,
        );
        const safeCharCount = Math.floor(TokenCounter.SAFE_TOKEN_LIMIT * 3.5);
        validatedTexts.push(text.substring(0, safeCharCount));
      } else {
        validatedTexts.push(text);
      }
    }

    return validatedTexts;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
