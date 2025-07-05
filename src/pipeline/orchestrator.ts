import { eq } from "drizzle-orm";

import { ForumCollectorImpl, ForumPost } from "@/pipeline/collectors/forum";
import { GitHubCollectorImpl } from "@/pipeline/collectors/github";
import { TextProcessorImpl } from "@/pipeline/processors/text-processor";
import { EmbeddingGeneratorImpl } from "@/pipeline/processors/embeddings";
import { getVectorStore, VectorStore } from "@/storage/vector-store";
import { IssueSummarizerImpl } from "@/pipeline/processors/issue-summarizer";
import { ForumPostSummarizerAgent } from "@/agents/forum-summarizer-agent";
import { CodeSnippetGeneratorAgent } from "@/agents/code-snippet-generator-agent";
import { Logger } from "@/logger";
import { RateLimiter } from "@/rate-limiter";
import { IdUtils } from "@/pipeline/processors/id-utils";
import type {
  Document,
  ContentMetadata,
} from "@/pipeline/processors/text-processor";
import { Env } from "@/env";
import { getDrizzleDB, type DrizzleDB } from "@/storage/d1-database";
import {
  collectionRuns,
  collectionTimestamps,
} from "@/storage/d1-database/schema";

export interface DataCollectionOptions {
  sources: ("github" | "forum")[];
  githubRepos?: Array<{ owner: string; repo: string }>;
  forumCategories?: string[];
  batchSize?: number;
  maxPages?: number;
}

export class DataPipelineOrchestrator {
  private env: Env;
  private drizzleDb: DrizzleDB;
  private forumCollector: ForumCollectorImpl;
  private githubCollector: GitHubCollectorImpl;
  private textProcessor: TextProcessorImpl;
  private embeddingGenerator: EmbeddingGeneratorImpl;
  private vectorStore: VectorStore | null = null;
  private issueSummarizer: IssueSummarizerImpl;
  private forumPostSummarizer: ForumPostSummarizerAgent;
  private codeSnippetGenerator: CodeSnippetGeneratorAgent;
  private openaiRateLimiter: RateLimiter;
  private isCancelled: () => boolean;

  async startCollectionRun(source: string): Promise<number> {
    const result = await this.drizzleDb
      .insert(collectionRuns)
      .values({
        source,
        status: "running",
        currentPhase: "initializing",
        progressMessage: "Starting data collection...",
        startedAt: new Date().toISOString(),
      })
      .run();
    return result.meta?.last_row_id as number;
  }

  constructor(env: Env, isCancelled?: () => boolean) {
    this.env = env;
    this.drizzleDb = getDrizzleDB(env.DB);
    this.isCancelled = isCancelled || (() => false);
    this.forumCollector = new ForumCollectorImpl();
    this.githubCollector = new GitHubCollectorImpl(env.GITHUB_TOKEN);
    this.textProcessor = new TextProcessorImpl();
    this.embeddingGenerator = new EmbeddingGeneratorImpl(env.OPENAI_API_KEY);
    this.openaiRateLimiter = new RateLimiter({
      requestsPerMinute: 200,
      retryAttempts: 3,
      baseDelayMs: 1000,
    });

    this.issueSummarizer = new IssueSummarizerImpl(env, this.openaiRateLimiter);
    this.forumPostSummarizer = new ForumPostSummarizerAgent(
      env,
      this.openaiRateLimiter,
    );
    this.codeSnippetGenerator = new CodeSnippetGeneratorAgent(
      env,
      this.openaiRateLimiter,
    );
  }

  async runDataCollection(options: DataCollectionOptions): Promise<number> {
    Logger.info(
      `🚀 Starting data collection run for sources: ${options.sources.join(", ")}`,
    );
    Logger.lazyDebug(
      () =>
        `📊 Collection options: ${JSON.stringify({
          sources: options.sources,
          githubRepos: options.githubRepos?.length || 0,
          forumCategories: options.forumCategories?.length || 0,
          batchSize: options.batchSize || 20,
          maxPages: options.maxPages || 5,
        })}`,
    );

    const runId = await this.startCollectionRun(options.sources.join(","));
    Logger.info(`📝 Created collection run with ID: ${runId}`);

    try {
      this.checkCancellation();
      const documents: Document[] = [];

      if (options.sources.includes("forum")) {
        this.checkCancellation();
        await this.updateProgress(
          runId,
          "in-progress",
          "Starting forum data collection...",
        );
        Logger.info(`📰 Starting forum data collection...`);
        const forumDocs = await this.collectForumData(
          options.forumCategories,
          runId,
        );
        documents.push(...forumDocs);
        await this.updateProgress(
          runId,
          "in-progress",
          `Forum collection complete: ${forumDocs.length} documents collected`,
          forumDocs.length,
        );
        Logger.info(
          `✅ Forum collection complete: ${forumDocs.length} documents collected`,
        );
      }

      if (options.sources.includes("github")) {
        this.checkCancellation();
        await this.updateProgress(
          runId,
          "in-progress",
          "Starting GitHub data collection...",
        );
        Logger.info(`🐙 Starting GitHub data collection...`);
        const githubDocs = await this.collectGitHubData(
          options.githubRepos,
          runId,
          options.maxPages || 5,
        );
        documents.push(...githubDocs);
        await this.updateProgress(
          runId,
          "in-progress",
          `GitHub collection complete: ${githubDocs.length} documents collected`,
          documents.length,
        );
        Logger.info(
          `✅ GitHub collection complete: ${githubDocs.length} documents collected`,
        );
      }

      this.checkCancellation();
      Logger.info(`📚 Total documents collected: ${documents.length}`);
      await this.updateProgress(
        runId,
        "in-progress",
        `Starting document processing and storage for ${documents.length} documents...`,
        documents.length,
      );
      Logger.info(`🔄 Starting document processing and storage...`);
      await this.processAndStoreDocuments(
        documents,
        options.batchSize || 20,
        runId,
      );

      await this.completeCollectionRun(runId, documents.length);
      await this.updateLastCollectionTime(options.sources);
      Logger.info(
        `🎉 Data collection run ${runId} completed successfully with ${documents.length} documents`,
      );
      return runId;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        Logger.info(`🛑 Data collection run ${runId} was cancelled`);
        await this.cancelCollectionRun(runId);
        throw error;
      }
      Logger.error(`❌ Data collection run ${runId} failed:`, error);
      await this.failCollectionRun(
        runId,
        error instanceof Error ? error.message : "Unknown error",
      );
      throw error;
    }
  }

  private async collectForumData(
    categories?: string[],
    runId?: number,
  ): Promise<Document[]> {
    const documents: Document[] = [];
    const allPosts: ForumPost[] = [];

    try {
      Logger.info(`🔍 Collecting forum posts from multiple endpoints...`);

      Logger.info(`📰 Fetching latest posts...`);
      const latestPosts = await this.forumCollector.fetchMultiplePages(
        (page) => this.forumCollector.fetchLatestPosts(page),
        10,
        300,
      );
      allPosts.push(...latestPosts);
      Logger.info(`📰 Found ${latestPosts.length} latest posts`);

      Logger.info(`⭐ Fetching top posts...`);
      const topPosts = await this.forumCollector.fetchMultiplePages(
        (page) => this.forumCollector.fetchTopPosts(page, "monthly"),
        5,
        150,
      );
      allPosts.push(...topPosts);
      Logger.info(`⭐ Found ${topPosts.length} top posts`);

      Logger.info(`🔍 Searching for API-related posts...`);
      const apiSearchTerms = [
        "api",
        "openai api",
        "sdk",
        "python api",
        "node api",
        "assistants api",
      ];
      for (const term of apiSearchTerms) {
        const searchPosts = await this.forumCollector.searchPosts(term, 1);
        allPosts.push(...searchPosts.slice(0, 50));
      }
      Logger.info(
        `🔍 Found ${allPosts.length - latestPosts.length - topPosts.length} search results`,
      );

      Logger.info(`📂 Fetching category-specific posts...`);
      const allCategories = await this.forumCollector.fetchCategories();
      const targetCategories = categories
        ? allCategories.filter((cat) => categories.includes(cat.slug))
        : allCategories.slice(0, 10);

      for (const category of targetCategories) {
        this.checkCancellation();
        if (runId) {
          await this.updateProgress(
            runId,
            "in-progress",
            `Processing forum category: ${category.name}`,
          );
        }

        const categoryPosts = await this.forumCollector.fetchMultiplePages(
          (page) =>
            this.forumCollector.fetchCategoryPostsWithId(
              category.slug,
              category.id,
              page,
            ),
          5,
          150,
        );
        allPosts.push(...categoryPosts);
        Logger.info(
          `📂 Found ${categoryPosts.length} posts in category ${category.slug}`,
        );
      }

      const uniquePosts = Array.from(
        new Map(allPosts.map((post) => [post.id, post])).values(),
      );
      Logger.info(
        `🔄 Deduplicated: ${allPosts.length} -> ${uniquePosts.length} unique posts`,
      );

      const highQualityPosts =
        this.forumCollector.filterHighQualityPosts(uniquePosts);
      Logger.info(
        `⭐ Filtered to ${highQualityPosts.length} high-quality posts`,
      );

      for (const post of highQualityPosts.slice(0, 500)) {
        this.checkCancellation();
        Logger.lazyDebug(
          () =>
            `🔍 Fetching details for post ${post.id}: "${post.title?.substring(0, 50)}..."`,
        );

        const topicDetails = await this.forumCollector.fetchTopicDetails(
          post.id,
        );

        const summary =
          await this.forumPostSummarizer.summarizeForumPost(topicDetails);

        if (!summary) {
          Logger.lazyDebug(
            () =>
              `Skipping forum post ${post.id}: filtered out by quality assessment`,
          );
          continue;
        }

        const metadata: ContentMetadata = {
          title: topicDetails.title,
          author: post.author,
          createdAt: post.created_at,
          updatedAt: topicDetails.last_posted_at || post.created_at,
          sourceUrl: `https://community.openai.com/t/${post.id}`,
          category: "forum",
          tags: topicDetails.tags,
        };

        documents.push({
          id: IdUtils.ensureSafeId(`forum_${post.id}`),
          content: `${summary.title}\n\n${summary.summary}`,
          metadata,
          source: "forum",
        });

        Logger.lazyDebug(
          () =>
            `✅ Added forum document: ${post.id} (${topicDetails.posts.length} posts, ${summary.originalLength} -> ${summary.summaryLength} chars)`,
        );
      }
    } catch (error) {
      Logger.error("❌ Error collecting forum data:", error);
    }

    Logger.info(
      `📰 Forum collection summary: ${documents.length} total documents`,
    );
    return documents;
  }

  private async collectGitHubData(
    repos?: Array<{ owner: string; repo: string }>,
    runId?: number,
    maxPages: number = 2,
  ): Promise<Document[]> {
    const documents: Document[] = [];
    const defaultRepos = [
      { owner: "openai", repo: "openai-python" },
      { owner: "openai", repo: "openai-node" },
    ];

    const targetRepos = repos || defaultRepos;
    Logger.info(
      `🎯 Processing ${targetRepos.length} GitHub repositories:`,
      targetRepos.map((r) => `${r.owner}/${r.repo}`),
    );

    try {
      const collectionInfo = await this.getLastCollectionTime("github");

      for (const { owner, repo } of targetRepos) {
        this.checkCancellation();
        if (runId) {
          await this.updateProgress(
            runId,
            "in-progress",
            `Processing GitHub repository: ${owner}/${repo}`,
          );
        }
        Logger.info(`📦 Processing repository: ${owner}/${repo}`);

        Logger.info(`🐛 Fetching issues for ${owner}/${repo}...`);
        let issues: any[] = [];
        let issuesEtag: string | undefined;
        let issuesLastModified: string | undefined;
        try {
          const issuesResponse =
            await this.githubCollector.fetchIssuesConditional(
              owner,
              repo,
              "all",
              collectionInfo.lastCollection,
              maxPages,
              {
                etag: collectionInfo.etag,
                lastModified: collectionInfo.lastModified,
              },
            );

          if (issuesResponse.notModified) {
            Logger.info(
              `✅ Issues for ${owner}/${repo} not modified, skipping processing`,
            );
            issues = [];
          } else {
            issues = issuesResponse.data || [];
            issuesEtag = issuesResponse.etag;
            issuesLastModified = issuesResponse.lastModified;
          }
        } catch (error) {
          Logger.error(`Failed to fetch issues for ${owner}/${repo}:`, error);
        }
        Logger.info(
          `📋 Found ${(issues || []).length} issues in ${owner}/${repo}`,
        );

        let issueCount = 0;
        const issuePromises = (issues || []).map(async (issue) => {
          this.checkCancellation();
          if (issue.body && issue.body.length > 100) {
            Logger.lazyDebug(
              () =>
                `🔍 Processing issue #${issue.number}: "${issue.title.substring(0, 50)}..." (${issue.body.length} chars)`,
            );

            try {
              const comments = await this.githubCollector.fetchIssueComments(
                owner,
                repo,
                issue.number,
              );
              issue.comments = comments;
              Logger.lazyDebug(
                () =>
                  `📝 Fetched ${comments.length} comments for issue #${issue.number}`,
              );
            } catch (error) {
              Logger.warn(
                `Failed to fetch comments for issue #${issue.number}:`,
                error,
              );
              issue.comments = [];
            }

            const summary = await this.issueSummarizer.summarizeIssue(issue);

            if (!summary) {
              Logger.lazyDebug(
                () =>
                  `⏭️  Skipping issue #${issue.number}: filtered out by quality assessment`,
              );
              return null;
            }

            const metadata: ContentMetadata = {
              title: issue.title,
              author: issue.author,
              createdAt: issue.created_at,
              updatedAt: issue.updated_at,
              sourceUrl: `https://github.com/${owner}/${repo}/issues/${issue.number}`,
              tags: issue.labels,
            };

            return {
              id: IdUtils.ensureSafeId(
                `github_${owner}_${repo}_issue_${issue.number}`,
              ),
              content: `${summary.title}\n\n${summary.summary}`,
              metadata,
              source: "github",
            };
          } else {
            Logger.lazyDebug(
              () =>
                `⏭️  Skipping issue #${issue.number}: insufficient content (${issue.body?.length || 0} chars)`,
            );
            return null;
          }
        });

        Logger.lazyDebug(
          () =>
            `Processing ${issuePromises.length} issues sequentially to avoid rate limits`,
        );
        for (let i = 0; i < issuePromises.length; i++) {
          try {
            const result = await issuePromises[i];
            if (result) {
              documents.push(result);
              issueCount++;
            }
          } catch (error) {
            Logger.error("Failed to process issue:", error);
          }

          if (i < issuePromises.length - 1) {
            const delay = Math.random() * 1000 + 500;
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
        Logger.info(`✅ Added ${issueCount} issues from ${owner}/${repo}`);

        this.checkCancellation();
        Logger.info(`📁 Fetching repository content for ${owner}/${repo}...`);
        let content: any[] = [];
        let contentEtag: string | undefined;
        let contentLastModified: string | undefined;
        try {
          const contentResponse =
            await this.githubCollector.fetchRepositoryContentConditional(
              owner,
              repo,
              "",
              5,
              {
                etag: collectionInfo.etag,
                lastModified: collectionInfo.lastModified,
              },
            );

          if (contentResponse.notModified) {
            Logger.info(
              `✅ Repository content for ${owner}/${repo} not modified, skipping processing`,
            );
            content = [];
          } else {
            content = contentResponse.data || [];
            contentEtag = contentResponse.etag;
            contentLastModified = contentResponse.lastModified;
          }
        } catch (error) {
          Logger.error(
            `Failed to fetch repository content for ${owner}/${repo}:`,
            error,
          );
        }
        Logger.info(
          `📄 Found ${(content || []).length} files in ${owner}/${repo}`,
        );

        let fileCount = 0;
        const filePromises = (content || []).map(async (file) => {
          this.checkCancellation();
          if (
            file.type === "file" &&
            file.content &&
            file.content.length > 200
          ) {
            Logger.lazyDebug(
              () =>
                `📝 Processing file: ${file.path} (${file.content.length} chars)`,
            );

            const codeSnippet =
              await this.codeSnippetGenerator.generateReusableSnippet(
                file.content,
                file.path,
              );

            const metadata: ContentMetadata = {
              title: file.name,
              sourceUrl: `https://github.com/${owner}/${repo}/blob/main/${file.path}`,
              language: codeSnippet.language,
              category: codeSnippet.isUnitTest ? "unit-test" : "source-code",
            };

            return {
              id: IdUtils.ensureSafeId(
                `github_${owner}_${repo}_file_${file.path.replace(/[^a-zA-Z0-9]/g, "_")}`,
              ),
              content: codeSnippet.generatedSnippet,
              metadata,
              source: "github",
            };
          } else {
            Logger.lazyDebug(
              () =>
                `⏭️  Skipping file: ${file.path} (type: ${file.type}, content: ${file.content?.length || 0} chars)`,
            );
            return null;
          }
        });

        Logger.lazyDebug(
          () =>
            `Processing ${filePromises.length} files sequentially to avoid rate limits`,
        );
        for (let i = 0; i < filePromises.length; i++) {
          try {
            const result = await filePromises[i];
            if (result) {
              documents.push(result);
              fileCount++;
            }
          } catch (error) {
            Logger.error("Failed to process file:", error);
          }

          if (i < filePromises.length - 1) {
            const delay = Math.random() * 1000 + 500;
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
        Logger.info(`✅ Added ${fileCount} files from ${owner}/${repo}`);
        Logger.info(
          `📦 Completed repository ${owner}/${repo}: ${issueCount + fileCount} total documents`,
        );

        if (
          issuesEtag ||
          issuesLastModified ||
          contentEtag ||
          contentLastModified
        ) {
          await this.updateCollectionHeaders(
            "github",
            issuesEtag || contentEtag,
            issuesLastModified || contentLastModified,
          );
        }
      }
    } catch (error) {
      Logger.error("❌ Error collecting GitHub data:", error);
    }

    Logger.info(
      `🐙 GitHub collection summary: ${documents.length} total documents`,
    );
    return documents;
  }

  private async processAndStoreDocuments(
    documents: Document[],
    batchSize: number,
    runId?: number,
  ): Promise<void> {
    this.checkCancellation();
    if (runId) {
      await this.updateProgress(
        runId,
        "in-progress",
        "Filtering documents for changes...",
      );
    }
    Logger.info(`🔍 Filtering documents for changes...`);
    this.checkCancellation();
    if (runId) {
      await this.updateProgress(
        runId,
        "in-progress",
        `Processing ${documents.length} new/updated documents`,
        undefined,
        undefined,
        documents.length,
      );
    }
    Logger.info(`📊 Processing summary: ${documents.length} new/updated`);

    Logger.info(`✂️  Chunking ${documents.length} documents...`);
    const chunks = this.textProcessor.chunkDocuments(documents);
    if (runId) {
      await this.updateProgress(
        runId,
        "in-progress",
        `Created ${chunks.length} text chunks from ${documents.length} documents`,
      );
    }
    Logger.info(
      `📝 Created ${chunks.length} text chunks from ${documents.length} documents`,
    );

    this.checkCancellation();
    if (runId) {
      await this.updateProgress(
        runId,
        "in-progress",
        `Generating embeddings for ${chunks.length} chunks...`,
      );
    }
    Logger.info(`🧠 Generating embeddings for ${chunks.length} chunks...`);
    const embeddedDocuments =
      await this.embeddingGenerator.batchProcess(chunks);
    Logger.info(
      `✅ Generated embeddings for ${embeddedDocuments.length} chunks`,
    );

    this.checkCancellation();
    if (runId) {
      await this.updateProgress(
        runId,
        "in-progress",
        `Storing ${embeddedDocuments.length} documents in batches of ${batchSize}...`,
      );
    }
    Logger.info(`💾 Storing documents in batches of ${batchSize}...`);
    let storedCount = 0;
    for (let i = 0; i < embeddedDocuments.length; i += batchSize) {
      this.checkCancellation();
      const batch = embeddedDocuments.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(embeddedDocuments.length / batchSize);
      if (runId) {
        await this.updateProgress(
          runId,
          "in-progress",
          `Storing batch ${batchNum}/${totalBatches} (${batch.length} documents)`,
          undefined,
          storedCount,
        );
      }
      Logger.info(
        `📦 Storing batch ${batchNum}/${totalBatches} (${batch.length} documents)`,
      );
      if (!this.vectorStore) {
        this.vectorStore = await getVectorStore(this.env);
      }
      await this.vectorStore.store(batch);
      storedCount += batch.length;
      Logger.info(
        `✅ Stored batch ${batchNum}, total stored: ${storedCount}/${embeddedDocuments.length}`,
      );
    }

    Logger.info(
      `🎉 Processing complete: ${documents.length} documents processed, ${chunks.length} chunks created, ${embeddedDocuments.length} embeddings stored`,
    );
  }

  private async completeCollectionRun(
    runId: number,
    documentsCollected: number,
  ): Promise<void> {
    await this.drizzleDb
      .update(collectionRuns)
      .set({
        status: "completed",
        currentPhase: "completed",
        documentsCollected,
        completedAt: new Date().toISOString(),
      })
      .where(eq(collectionRuns.id, runId))
      .run();
  }

  async failCollectionRun(runId: number, errorMessage: string): Promise<void> {
    await this.drizzleDb
      .update(collectionRuns)
      .set({
        status: "failed",
        currentPhase: "failed",
        errorMessage,
        completedAt: new Date().toISOString(),
      })
      .where(eq(collectionRuns.id, runId))
      .run();
  }

  private async cancelCollectionRun(runId: number): Promise<void> {
    await this.drizzleDb
      .update(collectionRuns)
      .set({
        status: "cancelled",
        currentPhase: "cancelled",
        completedAt: new Date().toISOString(),
      })
      .where(eq(collectionRuns.id, runId))
      .run();
  }

  private async updateProgress(
    runId: number,
    phase: string,
    message: string,
    documentsCollected?: number,
    documentsProcessed?: number,
    totalEstimated?: number,
  ): Promise<void> {
    try {
      const updateData: any = {
        currentPhase: phase,
        progressMessage: message,
      };

      if (documentsCollected !== undefined) {
        updateData.documentsCollected = documentsCollected;
      }
      if (documentsProcessed !== undefined) {
        updateData.documentsProcessed = documentsProcessed;
      }
      if (totalEstimated !== undefined) {
        updateData.totalEstimated = totalEstimated;
      }

      await this.drizzleDb
        .update(collectionRuns)
        .set(updateData)
        .where(eq(collectionRuns.id, runId))
        .run();
    } catch (error) {
      Logger.error("Failed to update progress:", error);
    }
  }

  private async getLastCollectionTime(source: string): Promise<{
    lastCollection?: string;
    etag?: string;
    lastModified?: string;
  }> {
    try {
      const result = await this.drizzleDb
        .select({
          lastSuccessfulCollection:
            collectionTimestamps.lastSuccessfulCollection,
          etag: collectionTimestamps.etag,
          lastModified: collectionTimestamps.lastModified,
        })
        .from(collectionTimestamps)
        .where(eq(collectionTimestamps.source, source))
        .get();

      return {
        lastCollection: result?.lastSuccessfulCollection,
        etag: result?.etag || undefined,
        lastModified: result?.lastModified || undefined,
      };
    } catch (error) {
      Logger.error(`Error getting last collection time for ${source}:`, error);
      return {};
    }
  }

  private async updateLastCollectionTime(sources: string[]): Promise<void> {
    try {
      const currentTime = new Date().toISOString();

      for (const source of sources) {
        await this.drizzleDb
          .insert(collectionTimestamps)
          .values({
            source,
            lastSuccessfulCollection: currentTime,
            updatedAt: currentTime,
          })
          .onConflictDoUpdate({
            target: collectionTimestamps.source,
            set: {
              lastSuccessfulCollection: currentTime,
              updatedAt: currentTime,
            },
          })
          .run();
      }

      Logger.info(
        `Updated last collection time for sources: ${sources.join(", ")}`,
      );
    } catch (error) {
      Logger.error("Error updating last collection time:", error);
    }
  }
  private async updateCollectionHeaders(
    source: string,
    etag?: string,
    lastModified?: string,
  ): Promise<void> {
    try {
      await this.drizzleDb
        .update(collectionTimestamps)
        .set({
          etag: etag || null,
          lastModified: lastModified || null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(collectionTimestamps.source, source))
        .run();

      Logger.lazyDebug(
        () =>
          `Updated collection headers for ${source}: ETag=${etag}, Last-Modified=${lastModified}`,
      );
    } catch (error) {
      Logger.error("Error updating collection headers:", error);
    }
  }

  private checkCancellation(): void {
    if (this.isCancelled()) {
      const error = new Error("Data collection was cancelled");
      error.name = "AbortError";
      throw error;
    }
  }
}
