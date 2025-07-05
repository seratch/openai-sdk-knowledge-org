import { and, asc, count, eq } from "drizzle-orm";

import { JobQueue, type Job, type WorkItem } from "@/pipeline/job-queue";
import { GitHubCollectorImpl } from "@/pipeline/collectors/github";
import { ForumCollectorImpl } from "@/pipeline/collectors/forum";
import { IssueSummarizerImpl } from "@/pipeline/processors/issue-summarizer";
import { ForumPostSummarizerAgent } from "@/agents/forum-summarizer-agent";
import { CodeSnippetGeneratorAgent } from "@/agents/code-snippet-generator-agent";
import { EmbeddingGeneratorImpl } from "@/pipeline/processors/embeddings";
import { getVectorStore, VectorStore } from "@/storage/vector-store";
import { RateLimiter } from "@/rate-limiter";
import { Logger } from "@/logger";
import { IdUtils } from "@/pipeline/processors/id-utils";
import { TokenCounter } from "@/pipeline/token-counter";
import { Env } from "@/env";
import { getDrizzleDB, type DrizzleDB } from "@/storage/d1-database";
import * as Schema from "@/storage/d1-database/schema";

export class JobProcessor {
  private env: Env;
  private drizzleDb: DrizzleDB;
  private jobQueue: JobQueue;
  private githubCollector: GitHubCollectorImpl;
  private forumCollector: ForumCollectorImpl;
  private issueSummarizer: IssueSummarizerImpl;
  private forumPostSummarizer: ForumPostSummarizerAgent;
  private codeSnippetGenerator: CodeSnippetGeneratorAgent;
  private embeddingGenerator: EmbeddingGeneratorImpl;
  private vectorStore: VectorStore | null = null;
  private openaiRateLimiter: RateLimiter;

  constructor(env: Env) {
    this.env = env;
    const openaiApiKey = env.OPENAI_API_KEY;
    this.drizzleDb = getDrizzleDB(env.DB);
    this.jobQueue = new JobQueue(env.DB, env.JOB_QUEUE);
    this.githubCollector = new GitHubCollectorImpl(env.GITHUB_TOKEN);
    this.forumCollector = new ForumCollectorImpl();
    this.embeddingGenerator = new EmbeddingGeneratorImpl(openaiApiKey);
    this.openaiRateLimiter = new RateLimiter({
      requestsPerMinute: 500,
      retryAttempts: 2,
      baseDelayMs: 500,
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

  async processNextJobs(maxJobs: number = 5): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
    errors: string[];
  }> {
    if (!this.vectorStore) {
      this.vectorStore = await getVectorStore(this.env);
    }
    const jobs = await this.jobQueue.getNextJobs(maxJobs);

    if (jobs.length === 0) {
      Logger.lazyDebug(() => "No pending jobs to process");
      return { processed: 0, succeeded: 0, failed: 0, errors: [] };
    }

    Logger.info(
      `Processing ${jobs.length} jobs in parallel with controlled concurrency`,
    );

    let succeeded = 0;
    let failed = 0;
    const errors: string[] = [];

    const results = await Promise.allSettled(
      jobs.map(async (job, index) => {
        try {
          await this.jobQueue.markJobRunning(job.id);

          if (job.jobType === "github_collect" && index > 0) {
            const delay = Math.random() * 1000 + 500;
            Logger.lazyDebug(
              () => `Staggering GitHub collection job ${job.id} by ${delay}ms`,
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
          }

          await this.executeJobLogic(job);
          await this.jobQueue.markJobCompleted(job.id);
          return { success: true, jobId: job.id };
        } catch (error) {
          Logger.error("Error executing job logic", {
            jobId: job.id,
            jobType: job.jobType,
            error: error,
          });
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";

          if (
            errorMessage.includes("too many SQL variables") ||
            errorMessage.includes("SQLITE_ERROR")
          ) {
            Logger.error(`❌ SQLite Variable Limit Error: ${errorMessage}`, {
              jobId: job.id,
              jobType: job.jobType,
              errorType: "SQL_VARIABLE_LIMIT_EXCEEDED",
              suggestion:
                "This error occurs when SQL queries have more than 999 parameters. Check batch sizes in filterExistingFiles, createWorkItems, and storeEmbeddingsInD1 methods.",
            });
          } else if (
            errorMessage.includes("SQLITE_TOOBIG") ||
            errorMessage.includes("string or blob too big")
          ) {
            Logger.error(`❌ SQLite Content Size Error: ${errorMessage}`, {
              jobId: job.id,
              jobType: job.jobType,
              errorType: "CONTENT_SIZE_EXCEEDED",
              suggestion:
                "This error occurs when content exceeds D1 database limits. Content should be validated and truncated using TokenCounter.validateAndTruncateContent() before storage.",
              maxContentSize: TokenCounter.D1_SAFE_CONTENT_SIZE,
              maxJsonSize: TokenCounter.D1_SAFE_JSON_SIZE,
            });
          }

          await this.jobQueue.markJobFailed(job.id, errorMessage);

          if (job.retryCount < job.maxRetries) {
            Logger.warn(`Job ${job.id} failed, will retry: ${errorMessage}`);
          } else {
            Logger.error(
              `Job ${job.id} failed permanently after ${job.maxRetries} retries: ${errorMessage}`,
            );
          }

          return { success: false, jobId: job.id, error: errorMessage };
        }
      }),
    );

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        if (result.value.success) {
          succeeded++;
          Logger.lazyDebug(
            () => `Job ${result.value.jobId} completed successfully`,
          );
        } else {
          failed++;
          const errorMsg = `Job ${result.value.jobId} failed: ${result.value.error}`;
          Logger.error(errorMsg);
          errors.push(errorMsg);
        }
      } else {
        failed++;
        const errorMsg = `Job ${jobs[index].id} failed with exception: ${result.reason}`;
        Logger.error(errorMsg);
        errors.push(errorMsg);
      }
    });

    Logger.info(
      `Job processing summary: ${succeeded} succeeded, ${failed} failed out of ${jobs.length} total`,
    );

    return {
      processed: jobs.length,
      succeeded,
      failed,
      errors,
    };
  }

  async processJob(jobId: number): Promise<void> {
    const job = await this.jobQueue.getJob(jobId);
    if (!job) {
      Logger.error(`Job ${jobId} not found`);
      return;
    }
    await this.jobQueue.markJobRunning(job.id);
    try {
      await this.executeJobLogic(job);
      await this.jobQueue.markJobCompleted(job.id);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      await this.jobQueue.markJobFailed(job.id, msg);
      Logger.error(`Job ${job.id} failed`, error);
    }
  }

  private async executeJobLogic(job: Job): Promise<void> {
    if (!this.vectorStore) {
      this.vectorStore = await getVectorStore(this.env);
    }
    Logger.info(`Executing job logic for job`, job);

    switch (job.jobType) {
      case "github_collect":
        await this.processGitHubCollection(job);
        break;
      case "forum_collect":
        await this.processForumCollection(job);
        break;
      case "process_item":
        await this.processWorkItem(job);
        break;
      case "process_github_batch":
        await this.processGitHubBatch(job);
        break;
      case "process_forum_batch":
        await this.processForumBatch(job);
        break;
      case "process_batch_item":
        await this.processBatchItem(job);
        break;
      case "process_pending_work_items":
        await this.processPendingWorkItems(job);
        break;
      default:
        throw new Error(`Unknown job type: ${job.jobType}`);
    }
  }

  private async processGitHubCollection(job: Job): Promise<void> {
    Logger.info("Processing GitHub collection job", {
      jobId: job.id,
      payload: job.payload,
    });
    const payload = JSON.parse(job.payload);
    const { owner, repo, collectionRunId, maxPages = 2 } = payload;

    Logger.info("Extracted GitHub collection parameters", {
      owner,
      repo,
      collectionRunId,
      maxPages,
    });

    if (!owner || !repo) {
      throw new Error(
        `Invalid GitHub collection parameters: owner=${owner}, repo=${repo}`,
      );
    }

    Logger.info(
      `Collecting GitHub data for ${owner}/${repo} with maxPages=${maxPages}`,
    );

    let issues: any[] = [];
    let content: any[] = [];

    try {
      issues = await this.githubCollector.fetchIssues(
        owner,
        repo,
        "all",
        undefined,
        maxPages,
      );
    } catch (error) {
      Logger.error(`Failed to fetch issues for ${owner}/${repo}:`, error);
    }
    Logger.info(`Collecting GitHub issues for ${owner}/${repo} completed`);

    try {
      content = await this.githubCollector.fetchRepositoryContent(owner, repo);
    } catch (error) {
      Logger.error(
        `Failed to fetch repository content for ${owner}/${repo}:`,
        error,
      );
    }
    Logger.info(`Collecting GitHub content for ${owner}/${repo} completed`);

    const eligibleFiles = (content || []).filter(
      (file) =>
        file.type === "file" && file.content && file.content.length > 200,
    );
    const newFiles = await this.filterExistingFiles(eligibleFiles);

    const collectionData = {
      issues: issues || [],
      files: newFiles || [],
      metadata: {
        owner,
        repo,
        collectionRunId,
        collectedAt: new Date().toISOString(),
        totalIssues: (issues || []).length,
        totalFiles: newFiles.length,
        skippedFiles: eligibleFiles.length - newFiles.length,
      },
    };

    const BATCH_SIZE = 5;
    const allItems = [
      ...collectionData.issues.map((issue: any) => ({
        type: "github_issue",
        data: issue,
      })),
      ...collectionData.files.map((file: any) => ({
        type: "github_file",
        data: file,
      })),
    ];

    Logger.info(
      `${allItems.length} batch job items for ${owner}/${repo} created`,
    );

    if (allItems.length === 0) {
      Logger.info(`No items to process for ${owner}/${repo}`);
      return;
    }

    for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
      const batchItems = allItems.slice(i, i + BATCH_SIZE);
      const batchData = {
        issues: batchItems
          .filter((item) => item.type === "github_issue")
          .map((item) => item.data),
        files: batchItems
          .filter((item) => item.type === "github_file")
          .map((item) => item.data),
        metadata: {
          ...collectionData.metadata,
          batchNumber: Math.floor(i / BATCH_SIZE) + 1,
          totalBatches: Math.ceil(allItems.length / BATCH_SIZE),
          batchSize: batchItems.length,
        },
      };

      await this.jobQueue.createJob(
        "process_github_batch",
        {
          collectionRunId,
          batchData,
          chunkSize: 10,
        },
        collectionRunId,
        5,
      );
      Logger.info(
        `"process_github_batch" batch job for ${owner}/${repo} created`,
      );
    }

    Logger.info(
      `Created ${Math.ceil(allItems.length / BATCH_SIZE)} batch processing jobs for ${owner}/${repo} (${(issues || []).length} issues, ${newFiles.length} new files, ${eligibleFiles.length - newFiles.length} files skipped as already existing)`,
    );
  }

  private async processForumCollection(job: Job): Promise<void> {
    const payload = JSON.parse(job.payload);
    const { categories, collectionRunId } = payload;

    Logger.info(
      `Collecting forum data for categories: ${categories?.join(", ") || "default"}`,
    );

    const allCategories = await this.forumCollector.fetchCategories();
    const targetCategories = categories
      ? allCategories.filter((cat) => categories.includes(cat.slug))
      : allCategories.slice(0, 50);

    const collectionData: {
      posts: Array<{ type: string; id: string; data: any }>;
      metadata: {
        categories: string;
        collectionRunId: number;
        collectedAt: string;
        totalPosts: number;
      };
    } = {
      posts: [],
      metadata: {
        categories: categories?.join(", ") || "default",
        collectionRunId,
        collectedAt: new Date().toISOString(),
        totalPosts: 0,
      },
    };

    for (const category of targetCategories) {
      const posts = await this.forumCollector.fetchMultiplePages(
        (page) =>
          this.forumCollector.fetchCategoryPostsWithId(
            category.slug,
            category.id,
            page,
          ),
        3,
        100,
      );
      Logger.lazyDebug(
        () =>
          `Fetched ${posts.length} posts from category ${category.slug} (ID: ${category.id})`,
      );
      const highQualityPosts =
        this.forumCollector.filterHighQualityPosts(posts);
      Logger.info(
        `Filtered to ${highQualityPosts.length} high-quality posts from ${posts.length} total posts in category ${category.slug}`,
      );

      const categoryPosts = highQualityPosts.slice(0, 150).map((post) => ({
        type: "forum_post",
        id: post.id.toString(),
        data: { post, category },
      }));

      collectionData.posts.push(...categoryPosts);
    }

    collectionData.metadata.totalPosts = collectionData.posts.length;

    const BATCH_SIZE = 5;

    if (collectionData.posts.length === 0) {
      Logger.info(
        `No posts to process for categories: ${categories?.join(", ") || "default"}`,
      );
      return;
    }

    for (let i = 0; i < collectionData.posts.length; i += BATCH_SIZE) {
      const batchPosts = collectionData.posts.slice(i, i + BATCH_SIZE);
      const batchData = {
        posts: batchPosts,
        metadata: {
          ...collectionData.metadata,
          batchNumber: Math.floor(i / BATCH_SIZE) + 1,
          totalBatches: Math.ceil(collectionData.posts.length / BATCH_SIZE),
          batchSize: batchPosts.length,
        },
      };

      await this.jobQueue.createJob(
        "process_forum_batch",
        {
          collectionRunId,
          batchData,
          chunkSize: 10,
        },
        collectionRunId,
        5,
      );
    }

    Logger.info(
      `Created ${Math.ceil(collectionData.posts.length / BATCH_SIZE)} forum batch processing jobs with ${collectionData.posts.length} total posts`,
    );
  }

  private async processWorkItem(job: Job): Promise<void> {
    if (!this.vectorStore) {
      this.vectorStore = await getVectorStore(this.env);
    }
    const payload = JSON.parse(job.payload);

    if (!payload.workItemId) {
      throw new Error("workItemId is required in job payload");
    }

    const workItems = await this.drizzleDb
      .select()
      .from(Schema.workItems)
      .where(eq(Schema.workItems.id, payload.workItemId))
      .limit(1);
    const workItem = workItems[0];

    if (!workItem) {
      Logger.lazyDebug(
        () =>
          `Work item with ID ${payload.workItemId} not found or already processed`,
      );
      return;
    }

    Logger.info(`Processing work item ${workItem.id} (${workItem.itemType})`);
    await this.jobQueue.markWorkItemProcessing(workItem.id);

    try {
      const startTime = Date.now();
      let document;
      const sourceData = JSON.parse(workItem.sourceData);

      switch (workItem.itemType) {
        case "github_issue":
          Logger.lazyDebug(
            () => `Processing GitHub issue: ${sourceData.title}`,
          );
          document = await this.processGitHubIssue(sourceData, workItem);
          break;
        case "github_file":
          Logger.lazyDebug(() => `Processing GitHub file: ${sourceData.path}`);
          document = await this.processGitHubFile(sourceData, workItem);
          break;
        case "forum_post":
          Logger.lazyDebug(
            () => `Processing forum post: ${sourceData.post.id}`,
          );
          document = await this.processForumPost(sourceData, workItem);
          break;
        default:
          throw new Error(`Unknown work item type: ${workItem.itemType}`);
      }

      if (document === null) {
        await this.jobQueue.markWorkItemSkipped(
          workItem.id,
          "Item filtered out during processing - no useful content found",
        );
        const duration = Date.now() - startTime;
        Logger.info(
          `Skipped work item ${workItem.id} (${workItem.itemType}) - filtered out in ${duration}ms`,
        );
        return;
      }

      Logger.lazyDebug(
        () => `Generating embeddings for work item ${workItem.id}`,
      );
      const embedded = await this.embeddingGenerator.batchProcess([document]);

      Logger.lazyDebug(() => `Storing embeddings for work item ${workItem.id}`);
      await this.vectorStore.store(embedded);

      await this.jobQueue.markWorkItemCompleted(workItem.id, document);

      const duration = Date.now() - startTime;
      Logger.info(
        `Completed work item ${workItem.id} (${workItem.itemType}) in ${duration}ms`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      Logger.error(`Work item ${workItem.id} processing failed:`, {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        workItemType: workItem.itemType,
        workItemId: workItem.id,
      });
      await this.jobQueue.markWorkItemFailed(workItem.id, errorMessage);
      throw error;
    }
  }

  private async processGitHubIssue(issue: any, workItem: WorkItem) {
    const summary = await this.issueSummarizer.summarizeIssue(issue);

    if (!summary) {
      Logger.info(
        `Issue #${issue.number} filtered out: no useful solution or conclusion`,
      );
      return null;
    }

    const issueContent = `${summary.title}\n\n${summary.summary}`;

    const validatedContent =
      TokenCounter.validateAndTruncateContent(issueContent);
    const contentBytes = new TextEncoder().encode(issueContent).length;
    const validatedBytes = new TextEncoder().encode(validatedContent).length;

    if (validatedContent !== issueContent) {
      Logger.warn(
        `GitHub issue #${issue.number} content truncated from ${contentBytes} to ${validatedBytes} bytes (${issueContent.length} to ${validatedContent.length} chars)`,
      );
    } else {
      Logger.lazyDebug(
        () =>
          `GitHub issue #${issue.number} content size: ${contentBytes} bytes (${issueContent.length} chars) - within limits`,
      );
    }

    return {
      id: IdUtils.ensureSafeId(`github_issue_${workItem.itemId}`),
      content: validatedContent,
      metadata: {
        title: issue.title,
        author: issue.author,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        sourceUrl: issue.html_url,
        tags: issue.labels,
      },
      source: "github",
    };
  }

  private async processGitHubFile(file: any, workItem: WorkItem) {
    const codeSnippet = await this.codeSnippetGenerator.generateReusableSnippet(
      file.content,
      file.path,
    );

    const validatedContent = TokenCounter.validateAndTruncateContent(
      codeSnippet.generatedSnippet,
    );
    const contentBytes = new TextEncoder().encode(
      codeSnippet.generatedSnippet,
    ).length;
    const validatedBytes = new TextEncoder().encode(validatedContent).length;

    if (validatedContent !== codeSnippet.generatedSnippet) {
      Logger.warn(
        `GitHub file ${file.path} content truncated from ${contentBytes} to ${validatedBytes} bytes (${codeSnippet.generatedSnippet.length} to ${validatedContent.length} chars)`,
      );
    } else {
      Logger.lazyDebug(
        () =>
          `GitHub file ${file.path} content size: ${contentBytes} bytes (${codeSnippet.generatedSnippet.length} chars) - within limits`,
      );
    }

    return {
      id: IdUtils.ensureSafeId(
        `github_file_${workItem.itemId.replace(/[^a-zA-Z0-9]/g, "_")}`,
      ),
      content: validatedContent,
      metadata: {
        title: file.name,
        sourceUrl: file.download_url,
        language: codeSnippet.language,
        category: codeSnippet.isUnitTest ? "unit-test" : "source-code",
      },
      source: "github",
    };
  }

  private async processForumPost(data: any, workItem: WorkItem) {
    const { post, category } = data;
    const topicDetails = await this.forumCollector.fetchTopicDetails(post.id);

    const summary =
      await this.forumPostSummarizer.summarizeForumPost(topicDetails);

    if (!summary) {
      Logger.info(
        `Forum post #${post.id} filtered out: no useful content or solution`,
      );
      return null;
    }

    const forumContent = `${summary.title}\n\n${summary.summary}`;

    const validatedContent =
      TokenCounter.validateAndTruncateContent(forumContent);
    const contentBytes = new TextEncoder().encode(forumContent).length;
    const validatedBytes = new TextEncoder().encode(validatedContent).length;

    if (validatedContent !== forumContent) {
      Logger.warn(
        `Forum post #${post.id} content truncated from ${contentBytes} to ${validatedBytes} bytes (${forumContent.length} to ${validatedContent.length} chars)`,
      );
    } else {
      Logger.lazyDebug(
        () =>
          `Forum post #${post.id} content size: ${contentBytes} bytes (${forumContent.length} chars) - within limits`,
      );
    }

    return {
      id: IdUtils.ensureSafeId(`forum_${workItem.itemId}`),
      content: validatedContent,
      metadata: {
        title: topicDetails.title,
        author: post.author,
        createdAt: post.created_at,
        updatedAt: topicDetails.last_posted_at || post.created_at,
        sourceUrl: `https://community.openai.com/t/${post.id}`,
        category: category.name,
        tags: topicDetails.tags,
      },
      source: "forum",
    };
  }

  private async processPendingWorkItems(job: Job): Promise<void> {
    const payload = JSON.parse(job.payload);
    const { collectionRunId, batchSize = 5 } = payload;

    Logger.info(
      `Processing pending work items for collection run ${collectionRunId} with batch size ${batchSize}`,
    );

    const pendingWorkItems = await this.drizzleDb
      .select()
      .from(Schema.workItems)
      .where(
        and(
          eq(Schema.workItems.collectionRunId, collectionRunId),
          eq(Schema.workItems.status, "pending"),
        ),
      )
      .orderBy(asc(Schema.workItems.createdAt))
      .limit(batchSize);
    const workItems = pendingWorkItems;

    if (workItems.length === 0) {
      Logger.lazyDebug(
        () =>
          `No pending work items found for collection run ${collectionRunId}`,
      );
      return;
    }

    Logger.info(
      `Processing ${workItems.length} pending work items in parallel`,
    );

    const results = await Promise.allSettled(
      workItems.map(async (workItem) => {
        try {
          Logger.info(
            `Processing work item ${workItem.id} (${workItem.itemType})`,
          );
          await this.jobQueue.markWorkItemProcessing(workItem.id);

          const startTime = Date.now();
          let document;
          const sourceData = JSON.parse(workItem.sourceData);

          switch (workItem.itemType) {
            case "github_issue":
              Logger.lazyDebug(
                () => `Processing GitHub issue: ${sourceData.title}`,
              );
              document = await this.processGitHubIssue(sourceData, workItem);
              break;
            case "github_file":
              Logger.lazyDebug(
                () => `Processing GitHub file: ${sourceData.path}`,
              );
              document = await this.processGitHubFile(sourceData, workItem);
              break;
            case "forum_post":
              Logger.lazyDebug(
                () => `Processing forum post: ${sourceData.post.id}`,
              );
              document = await this.processForumPost(sourceData, workItem);
              break;
            default:
              throw new Error(`Unknown work item type: ${workItem.itemType}`);
          }

          if (document === null) {
            await this.jobQueue.markWorkItemSkipped(
              workItem.id,
              "Item filtered out during processing - no useful content found",
            );
            const duration = Date.now() - startTime;
            Logger.info(
              `Skipped work item ${workItem.id} (${workItem.itemType}) - filtered out in ${duration}ms`,
            );
            return { success: true, workItemId: workItem.id, skipped: true };
          }

          Logger.lazyDebug(
            () => `Generating embeddings for work item ${workItem.id}`,
          );
          const embedded = await this.embeddingGenerator.batchProcess([
            document,
          ]);

          Logger.lazyDebug(
            () => `Storing embeddings for work item ${workItem.id}`,
          );
          const documentContentSize = new TextEncoder().encode(
            document.content,
          ).length;
          Logger.lazyDebug(
            () =>
              `Document content size before storage: ${documentContentSize} bytes (${document.content.length} chars)`,
          );
          if (!this.vectorStore) {
            this.vectorStore = await getVectorStore(this.env);
          }
          await this.vectorStore.store(embedded);

          await this.jobQueue.markWorkItemCompleted(workItem.id, document);

          const duration = Date.now() - startTime;
          Logger.info(
            `Completed work item ${workItem.id} (${workItem.itemType}) in ${duration}ms`,
          );

          return { success: true, workItemId: workItem.id, skipped: false };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          Logger.error(`Work item ${workItem.id} processing failed:`, {
            error: errorMessage,
            stack: error instanceof Error ? error.stack : undefined,
            workItemType: workItem.itemType,
            workItemId: workItem.id,
          });
          await this.jobQueue.markWorkItemFailed(workItem.id, errorMessage);
          return {
            success: false,
            workItemId: workItem.id,
            error: errorMessage,
          };
        }
      }),
    );

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    results.forEach((result) => {
      if (result.status === "fulfilled") {
        if (result.value.success) {
          if (result.value.skipped) {
            skipped++;
          } else {
            succeeded++;
          }
        } else {
          failed++;
        }
      } else {
        failed++;
      }
    });

    Logger.info(
      `Batch processing summary for collection run ${collectionRunId}: ${succeeded} succeeded, ${skipped} skipped, ${failed} failed out of ${workItems.length} total`,
    );

    const remainingWorkItems = await this.drizzleDb
      .select({ count: count() })
      .from(Schema.workItems)
      .where(
        and(
          eq(Schema.workItems.collectionRunId, collectionRunId),
          eq(Schema.workItems.status, "pending"),
        ),
      );

    const remainingCount = remainingWorkItems[0]?.count || 0;
    if (remainingCount > 0) {
      Logger.info(
        `${remainingCount} work items still pending for collection run ${collectionRunId}, creating another batch job`,
      );
      await this.jobQueue.createJob(
        "process_pending_work_items",
        { collectionRunId, batchSize },
        collectionRunId,
        1,
      );
    }
  }

  private async processGitHubBatch(job: Job): Promise<void> {
    const payload = JSON.parse(job.payload);
    const { collectionRunId, batchData, chunkSize = 10 } = payload;

    Logger.info(
      `Processing GitHub batch for collection run ${collectionRunId} with chunk size ${chunkSize}`,
    );

    if (!batchData) {
      Logger.error(
        `GitHub batch processing failed: batchData is undefined for collection run ${collectionRunId}`,
      );
      return;
    }

    const { issues, files } = batchData;
    const allItems = [
      ...issues.map((issue: any) => ({
        type: "github_issue",
        id: issue.number.toString(),
        data: issue,
      })),
      ...files.map((file: any) => ({
        type: "github_file",
        id: file.path,
        data: file,
      })),
    ];

    for (let i = 0; i < allItems.length; i += chunkSize) {
      const chunk = allItems.slice(i, i + chunkSize);

      for (const item of chunk) {
        await this.jobQueue.createJob(
          "process_batch_item",
          {
            collectionRunId,
            itemType: item.type,
            itemId: item.id,
            itemData: item.data,
          },
          collectionRunId,
          3,
        );
      }

      Logger.lazyDebug(
        () =>
          `Created ${chunk.length} processing jobs for chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(allItems.length / chunkSize)}`,
      );
    }

    Logger.info(
      `Created ${allItems.length} individual processing jobs from batch (${issues.length} issues, ${files.length} files)`,
    );
  }

  private async processForumBatch(job: Job): Promise<void> {
    const payload = JSON.parse(job.payload);
    const { collectionRunId, batchData, chunkSize = 10 } = payload;

    Logger.info(
      `Processing forum batch for collection run ${collectionRunId} with chunk size ${chunkSize}`,
    );

    if (!batchData) {
      Logger.info(
        `Forum batch processing failed: batchData is undefined for collection run ${collectionRunId}`,
      );
      return;
    }

    const { posts } = batchData;

    for (let i = 0; i < posts.length; i += chunkSize) {
      const chunk = posts.slice(i, i + chunkSize);

      for (const item of chunk) {
        await this.jobQueue.createJob(
          "process_batch_item",
          {
            collectionRunId,
            itemType: item.type,
            itemId: item.id,
            itemData: item.data,
          },
          collectionRunId,
          3,
        );
      }

      Logger.lazyDebug(
        () =>
          `Created ${chunk.length} processing jobs for chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(posts.length / chunkSize)}`,
      );
    }

    Logger.info(
      `Created ${posts.length} individual processing jobs from forum batch`,
    );
  }

  private async processBatchItem(job: Job): Promise<void> {
    const payload = JSON.parse(job.payload);
    const { collectionRunId, itemType, itemId, itemData } = payload;

    Logger.info(`Processing batch item ${itemId} (${itemType})`);

    try {
      const startTime = Date.now();
      let document;

      const tempWorkItem = {
        id: 0,
        collectionRunId: collectionRunId,
        itemType: itemType,
        itemId: itemId,
        status: "processing",
        sourceData: JSON.stringify(itemData),
        retryCount: 0,
        createdAt: new Date().toISOString(),
      } as WorkItem;

      switch (itemType) {
        case "github_issue":
          Logger.lazyDebug(() => `Processing GitHub issue: ${itemData.title}`);
          document = await this.processGitHubIssue(itemData, tempWorkItem);
          break;
        case "github_file":
          Logger.lazyDebug(() => `Processing GitHub file: ${itemData.path}`);
          document = await this.processGitHubFile(itemData, tempWorkItem);
          break;
        case "forum_post":
          Logger.lazyDebug(() => `Processing forum post: ${itemData.post.id}`);
          document = await this.processForumPost(itemData, tempWorkItem);
          break;
        default:
          throw new Error(`Unknown batch item type: ${itemType}`);
      }

      if (document === null) {
        const duration = Date.now() - startTime;
        Logger.info(
          `Skipped batch item ${itemId} (${itemType}) - filtered out in ${duration}ms`,
        );
        return;
      }

      Logger.lazyDebug(() => `Generating embeddings for batch item ${itemId}`);
      const embedded = await this.embeddingGenerator.batchProcess([document]);

      Logger.lazyDebug(() => `Storing embeddings for batch item ${itemId}`);
      const documentContentSize = new TextEncoder().encode(
        document.content,
      ).length;
      Logger.lazyDebug(
        () =>
          `Document content size before storage: ${documentContentSize} bytes (${document.content.length} chars)`,
      );
      if (!this.vectorStore) {
        this.vectorStore = await getVectorStore(this.env);
      }
      await this.vectorStore.store(embedded);

      const duration = Date.now() - startTime;
      Logger.info(
        `Completed batch item ${itemId} (${itemType}) in ${duration}ms`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      Logger.error(`Batch item ${itemId} processing failed:`, {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        itemType,
        itemId,
      });
      throw error;
    }
  }

  private async filterExistingFiles(files: any[]): Promise<any[]> {
    if (files.length === 0) {
      return files;
    }

    const fileIds = files.map((file) =>
      IdUtils.ensureSafeId(
        `github_file_${file.path.replace(/[^a-zA-Z0-9]/g, "_")}`,
      ),
    );

    Logger.lazyDebug(
      () =>
        `🔍 SQL Debug: Checking existence of ${fileIds.length} files using batched queries (SQLite limit: 250 variables)`,
    );

    const BATCH_SIZE = 100;
    const existingIds = new Set<string>();

    for (let i = 0; i < fileIds.length; i += BATCH_SIZE) {
      const batch = fileIds.slice(i, i + BATCH_SIZE);
      Logger.lazyDebug(
        () =>
          `🔍 SQL Debug: Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(fileIds.length / BATCH_SIZE)} with ${batch.length} variables`,
      );

      // TODO: replace this with Vectorize
      const existingDocs = { results: [] };
      // const existingDocs = await this.db
      //   .prepare(
      //     `
      //   SELECT id FROM documents WHERE id IN (${batch.map(() => "?").join(",")})
      // `,
      //   )
      //   .bind(...batch)
      //   .all();

      (existingDocs.results || []).forEach((doc: any) =>
        existingIds.add(doc.id),
      );
    }

    const newFiles = files.filter((_file, index) => {
      const fileId = fileIds[index];
      return !existingIds.has(fileId);
    });

    Logger.info(
      `📊 File existence check: ${files.length} total files, ${existingIds.size} already exist, ${newFiles.length} new files to process`,
    );

    return newFiles;
  }
}
