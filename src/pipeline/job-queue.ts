import { eq, and, count } from "drizzle-orm";
import type { D1Database, Queue } from "@cloudflare/workers-types";

import { Logger } from "@/logger";
import { getDrizzleDB, type DrizzleDB } from "@/storage/d1-database";
import {
  jobQueue,
  workItems,
  collectionRuns,
} from "@/storage/d1-database/schema";

export interface Job {
  id: number;
  jobType: string;
  status: string;
  priority: number;
  payload: string;
  collectionRunId: number | null;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface WorkItem {
  id: number;
  collectionRunId: number;
  itemType: string;
  itemId: string;
  status: string;
  sourceData: string;
  processedData?: string | null;
  retryCount: number;
  createdAt: string;
  processedAt?: string | null;
  errorMessage?: string | null;
}

export class JobQueue {
  private drizzleDb: DrizzleDB;

  constructor(
    private db: D1Database,
    private queue?: Queue,
  ) {
    this.drizzleDb = getDrizzleDB(db);
  }

  async createJob(
    jobType: string,
    payload: any,
    collectionRunId?: number,
    priority: number = 0,
  ): Promise<number> {
    const result = await this.drizzleDb
      .insert(jobQueue)
      .values({
        jobType,
        status: "pending",
        priority,
        payload: JSON.stringify(payload),
        collectionRunId: collectionRunId || null,
        createdAt: new Date().toISOString(),
      })
      .run();

    const jobId = result.meta?.last_row_id as number;
    if (this.queue) {
      await this.queue.send({ jobId });
    }

    return jobId;
  }

  async getNextJobs(limit: number = 5): Promise<Job[]> {
    const staleJobTimeoutMinutes = 5;
    const staleJobCutoff = new Date(
      Date.now() - staleJobTimeoutMinutes * 60 * 1000,
    ).toISOString();

    const resetResult = await this.drizzleDb
      .update(jobQueue)
      .set({
        status: "pending",
        startedAt: null,
      })
      .where(
        and(
          eq(jobQueue.status, "running"),
          eq(jobQueue.startedAt, staleJobCutoff),
        ),
      )
      .run();

    if (resetResult.meta?.changes && resetResult.meta.changes > 0) {
      Logger.info(
        `Reset ${resetResult.meta.changes} stale running jobs back to pending status`,
      );
    }

    const jobs = await this.drizzleDb
      .select()
      .from(jobQueue)
      .where(eq(jobQueue.status, "pending"))
      .orderBy(jobQueue.priority, jobQueue.createdAt)
      .limit(limit)
      .all();

    if (jobs.length === 0) {
      Logger.lazyDebug(() => "No pending jobs to process");
    } else {
      Logger.info(`Found ${jobs.length} jobs to process`);
    }

    return jobs;
  }

  async getJob(jobId: number): Promise<Job | null> {
    const job = await this.drizzleDb
      .select()
      .from(jobQueue)
      .where(eq(jobQueue.id, jobId))
      .get();
    return job || null;
  }

  async markJobRunning(jobId: number): Promise<void> {
    await this.drizzleDb
      .update(jobQueue)
      .set({
        status: "running",
        startedAt: new Date().toISOString(),
      })
      .where(eq(jobQueue.id, jobId))
      .run();
  }

  async markJobCompleted(jobId: number): Promise<void> {
    await this.drizzleDb
      .update(jobQueue)
      .set({
        status: "completed",
        completedAt: new Date().toISOString(),
      })
      .where(eq(jobQueue.id, jobId))
      .run();

    await this.checkAndCompleteCollectionRun(jobId);
  }

  async markJobFailed(jobId: number, errorMessage: string): Promise<void> {
    const job = await this.drizzleDb
      .select()
      .from(jobQueue)
      .where(eq(jobQueue.id, jobId))
      .get();

    if (job) {
      await this.drizzleDb
        .update(jobQueue)
        .set({
          status: "failed",
          completedAt: new Date().toISOString(),
          errorMessage,
          retryCount: job.retryCount + 1,
        })
        .where(eq(jobQueue.id, jobId))
        .run();
    }

    await this.checkAndCompleteCollectionRun(jobId);
  }

  async createWorkItems(
    items: Omit<WorkItem, "id" | "createdAt">[],
  ): Promise<number[]> {
    if (items.length === 0) {
      return [];
    }

    const CHUNK_SIZE = 50;
    const createdIds: number[] = [];

    try {
      Logger.lazyDebug(
        () =>
          `🔍 SQL Debug: Creating ${items.length} work items using chunk size ${CHUNK_SIZE} (SQLite limit: 250 variables)`,
      );

      for (let i = 0; i < items.length; i += CHUNK_SIZE) {
        const chunk = items.slice(i, i + CHUNK_SIZE);
        Logger.lazyDebug(
          () =>
            `🔍 SQL Debug: Processing work items chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(items.length / CHUNK_SIZE)} with ${chunk.length * 5} variables (5 per item)`,
        );

        for (const item of chunk) {
          const result = await this.drizzleDb
            .insert(workItems)
            .values({
              collectionRunId: item.collectionRunId,
              itemType: item.itemType,
              itemId: item.itemId,
              status: "pending",
              sourceData: item.sourceData,
              createdAt: new Date().toISOString(),
            })
            .run();
          createdIds.push(result.meta?.last_row_id as number);
        }
      }

      Logger.info(
        `Successfully created ${createdIds.length} work items in ${Math.ceil(items.length / CHUNK_SIZE)} chunks`,
      );
      return createdIds;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      Logger.error(`Failed to create work items: ${errorMessage}`, {
        totalItems: items.length,
        createdSoFar: createdIds.length,
        error: errorMessage,
      });
      Logger.error(`❌ STDERR: Failed to create work items: ${errorMessage}`, {
        totalItems: items.length,
        createdSoFar: createdIds.length,
      });
      throw error;
    }
  }

  async getWorkItem(workItemId: number): Promise<WorkItem | null> {
    const result = await this.drizzleDb
      .select()
      .from(workItems)
      .where(eq(workItems.id, workItemId))
      .get();
    if (!result) return null;
    return result;
  }

  async markWorkItemProcessing(workItemId: number): Promise<void> {
    await this.drizzleDb
      .update(workItems)
      .set({
        status: "processing",
      })
      .where(eq(workItems.id, workItemId))
      .run();
  }

  async markWorkItemCompleted(
    workItemId: number,
    processedData: any,
  ): Promise<void> {
    await this.drizzleDb
      .update(workItems)
      .set({
        status: "completed",
        processedData,
        processedAt: new Date().toISOString(),
      })
      .where(eq(workItems.id, workItemId))
      .run();
  }

  async markWorkItemFailed(
    workItemId: number,
    errorMessage: string,
  ): Promise<void> {
    const item = await this.drizzleDb
      .select()
      .from(workItems)
      .where(eq(workItems.id, workItemId))
      .get();

    if (item) {
      await this.drizzleDb
        .update(workItems)
        .set({
          status: "failed",
          errorMessage,
          retryCount: item.retryCount + 1,
        })
        .where(eq(workItems.id, workItemId))
        .run();
    }
  }

  async markWorkItemSkipped(
    workItemId: number,
    reason?: string,
  ): Promise<void> {
    await this.drizzleDb
      .update(workItems)
      .set({
        status: "skipped",
        errorMessage: reason || "Item was skipped during processing",
        processedAt: new Date().toISOString(),
      })
      .where(eq(workItems.id, workItemId))
      .run();
  }

  async markWorkItemCancelled(
    workItemId: number,
    reason?: string,
  ): Promise<void> {
    await this.drizzleDb
      .update(workItems)
      .set({
        status: "cancelled",
        errorMessage: reason || "Item was cancelled",
        processedAt: new Date().toISOString(),
      })
      .where(eq(workItems.id, workItemId))
      .run();
  }

  async getRunningJobs(): Promise<Job[]> {
    const result = await this.drizzleDb
      .select()
      .from(jobQueue)
      .where(eq(jobQueue.status, "running"))
      .orderBy(jobQueue.startedAt)
      .all();
    return result;
  }

  async getPendingWorkItems(
    collectionRunId: number,
    limit: number = 10,
  ): Promise<WorkItem[]> {
    const result = await this.drizzleDb
      .select()
      .from(workItems)
      .where(
        and(
          eq(workItems.collectionRunId, collectionRunId),
          eq(workItems.status, "pending"),
        ),
      )
      .orderBy(workItems.createdAt)
      .limit(limit)
      .all();
    return result;
  }

  async getPendingWorkItemsCount(collectionRunId: number): Promise<number> {
    const result = await this.drizzleDb
      .select({ count: count() })
      .from(workItems)
      .where(
        and(
          eq(workItems.collectionRunId, collectionRunId),
          eq(workItems.status, "pending"),
        ),
      )
      .get();
    return result?.count || 0;
  }

  private async checkAndCompleteCollectionRun(jobId: number): Promise<void> {
    try {
      const jobResult = await this.drizzleDb
        .select({ collectionRunId: jobQueue.collectionRunId })
        .from(jobQueue)
        .where(eq(jobQueue.id, jobId))
        .get();

      if (!jobResult?.collectionRunId) {
        return;
      }

      const collectionRunId = jobResult.collectionRunId;

      const pendingJobs = await this.drizzleDb
        .select({ count: count() })
        .from(jobQueue)
        .where(
          and(
            eq(jobQueue.collectionRunId, collectionRunId),
            eq(jobQueue.status, "pending"),
          ),
        )
        .get();

      const runningJobs = await this.drizzleDb
        .select({ count: count() })
        .from(jobQueue)
        .where(
          and(
            eq(jobQueue.collectionRunId, collectionRunId),
            eq(jobQueue.status, "running"),
          ),
        )
        .get();

      const totalPendingRunning =
        (pendingJobs?.count || 0) + (runningJobs?.count || 0);

      if (totalPendingRunning === 0) {
        const completedJobs = await this.drizzleDb
          .select({ count: count() })
          .from(jobQueue)
          .where(
            and(
              eq(jobQueue.collectionRunId, collectionRunId),
              eq(jobQueue.status, "completed"),
            ),
          )
          .get();

        const failedJobs = await this.drizzleDb
          .select({ count: count() })
          .from(jobQueue)
          .where(
            and(
              eq(jobQueue.collectionRunId, collectionRunId),
              eq(jobQueue.status, "failed"),
            ),
          )
          .get();

        const completedCount = completedJobs?.count || 0;
        const failedCount = failedJobs?.count || 0;

        const workItemsResult = await this.drizzleDb
          .select({ count: count() })
          .from(workItems)
          .where(
            and(
              eq(workItems.collectionRunId, collectionRunId),
              eq(workItems.status, "completed"),
            ),
          )
          .get();

        const documentsCollected = workItemsResult?.count || 0;

        if (failedCount > 0 && completedCount === 0) {
          await this.drizzleDb
            .update(collectionRuns)
            .set({
              status: "failed",
              errorMessage: "All jobs failed",
              completedAt: new Date().toISOString(),
            })
            .where(eq(collectionRuns.id, collectionRunId))
            .run();

          Logger.error(
            `Collection run ${collectionRunId} failed - all ${failedCount} jobs failed`,
          );
        } else {
          await this.drizzleDb
            .update(collectionRuns)
            .set({
              status: "completed",
              documentsCollected,
              completedAt: new Date().toISOString(),
            })
            .where(eq(collectionRuns.id, collectionRunId))
            .run();

          Logger.info(
            `Collection run ${collectionRunId} completed successfully with ${documentsCollected} documents collected (${completedCount} jobs completed, ${failedCount} jobs failed)`,
          );
        }
      }
    } catch (error) {
      Logger.error("Error checking collection run completion:", error);
    }
  }
}
