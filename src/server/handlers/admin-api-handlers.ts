import { Context } from "hono";
import { eq, desc, count, asc } from "drizzle-orm";

import { Logger } from "@/logger";
import { JobQueue } from "@/pipeline/job-queue";
import { DataPipelineOrchestrator } from "@/pipeline/orchestrator";
import { getDrizzleDB } from "@/storage/d1-database";
import * as Schema from "@/storage/d1-database/schema";
import { calculateServiceStatus } from "@/server/service-status";
import { Env } from "@/env";

export const adminApiCollectHanlder = async (c: Context) => {
  const orchestrator = new DataPipelineOrchestrator(c.env, () => false);
  let runId: number | null = null;
  try {
    const validatedData = (c as any).get("validatedData");
    const { source, url, category, maxPages = 20 } = validatedData;
    if (!c.env.OPENAI_API_KEY) {
      Logger.error("OpenAI API key not configured");
      return c.json({ error: "OpenAI API key not configured" }, 500);
    }
    const jobQueue = new JobQueue(c.env.DB, c.env.JOB_QUEUE);
    const runningJobs = await jobQueue.getRunningJobs();

    if (runningJobs.length > 0) {
      return c.json(
        {
          error: "Data collection already in progress",
          message:
            "Another data collection job is currently running. Please wait for it to complete before starting a new one.",
          runningJob: {
            id: runningJobs[0].id,
            type: runningJobs[0].jobType,
            startedAt: runningJobs[0].startedAt,
          },
        },
        409,
      );
    }

    runId = await orchestrator.startCollectionRun(source);

    let owner = "openai";
    let repo = "openai-python";

    Logger.info("Starting GitHub collection job creation", {
      url,
      source,
    });

    if (url) {
      try {
        const urlParts = new URL(url);
        const pathParts = urlParts.pathname
          .split("/")
          .filter((part) => part.length > 0);
        if (pathParts.length >= 2) {
          owner = pathParts[0];
          repo = pathParts[1];
          Logger.info("Successfully parsed GitHub URL", {
            url,
            owner,
            repo,
            pathParts,
          });
        } else {
          Logger.warn("GitHub URL does not have enough path parts", {
            url,
            pathParts,
          });
        }
      } catch (error) {
        Logger.info("Invalid URL provided, using default repository", {
          url,
          error,
        });
      }
    } else {
      Logger.warn("No URL provided, using default repository", {
        owner,
        repo,
      });
    }

    if (!owner || !repo) {
      Logger.error(
        "Owner or repo is undefined, cannot create GitHub collection job",
        { owner, repo, url },
      );
      return c.json({ error: "Invalid GitHub repository URL" }, 400);
    }

    const payload = {
      source,
      url,
      category,
      maxPages,
      collectionRunId: runId,
      owner,
      repo,
      categories: source === "forum" ? ["api"] : undefined,
    };

    Logger.info("Creating GitHub collection job with payload", payload);

    const jobId = await jobQueue.createJob(
      source === "github" ? "github_collect" : "forum_collect",
      payload,
      runId,
      10,
    );

    const batchProcessingJobId = await jobQueue.createJob(
      "process_pending_work_items",
      {
        collectionRunId: runId,
        batchSize: 10,
      },
      runId,
      5,
    );

    return c.json({
      message: "Data collection job queued successfully",
      jobId: jobId,
      batchProcessingJobId: batchProcessingJobId,
      collectionRunId: runId,
      source,
      url,
      category,
      maxPages,
      estimatedTime: `${maxPages * 2} minutes`,
      timestamp: new Date().toISOString(),
      status: "queued",
      statusUrl: `/api/admin/collect/status/${runId}`,
    });
  } catch (error) {
    Logger.error("Error in collect endpoint:", error);
    if (runId) {
      await orchestrator.failCollectionRun(
        runId,
        error instanceof Error ? error.message : "Unknown error",
      );
    }
    throw error;
  }
};

export const adminApiGetCollectStatusHandler = async (c: Context) => {
  try {
    const runId = c.req.param("runId");
    const jobQueue = new JobQueue(c.env.DB, c.env.JOB_QUEUE);
    const db = getDrizzleDB(c.env.DB);
    if (runId) {
      const run = (
        await db
          .select()
          .from(Schema.collectionRuns)
          .where(eq(Schema.collectionRuns.id, Number(runId)))
      ).at(0);
      if (!run) {
        return c.json({ error: "Collection run not found" }, 404);
      }

      const jobs = await db
        .select()
        .from(Schema.jobQueue)
        .where(eq(Schema.jobQueue.collectionRunId, Number(runId)));

      const workItems = await db
        .select()
        .from(Schema.workItems)
        .where(eq(Schema.workItems.collectionRunId, Number(runId)))
        .groupBy(Schema.workItems.itemType, Schema.workItems.status);

      return c.json({
        run,
        jobs: jobs || [],
        workItems: workItems || [],
        progress: {
          itemsCollected: run.documentsCollected || 0,
          itemsProcessed: run.documentsProcessed || 0,
          totalEstimated: run.totalEstimated || 0,
          percentComplete: run.totalEstimated
            ? Math.round(
                ((Number(run.documentsProcessed) || 0) /
                  Number(run.totalEstimated)) *
                  100,
              )
            : 0,
        },
        timestamp: new Date().toISOString(),
      });
    } else {
      const recentRuns = await db
        .select()
        .from(Schema.collectionRuns)
        .orderBy(desc(Schema.collectionRuns.startedAt))
        .limit(10);
      const runningJobs = await jobQueue.getRunningJobs();

      return c.json({
        isRunning: runningJobs.length > 0,
        recentRuns: recentRuns || [],
        totalCollected: 0,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    Logger.error("Error fetching collection status:", error);
    return c.json({
      isRunning: false,
      recentRuns: [],
      totalCollected: 0,
      timestamp: new Date().toISOString(),
    });
  }
};

export const adminApiGetHealthHandler = async (c: Context) => {
  try {
    const serviceHealth = await calculateServiceStatus(c.env);
    return c.json({
      status: serviceHealth.status,
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      environment: c.env.ENVIRONMENT || "development",
      services: serviceHealth.services,
    });
  } catch (error) {
    Logger.error("Health check failed", {
      error: (error as Error).message,
    });
    return c.json(
      {
        status: "down",
        timestamp: new Date().toISOString(),
        error: "Health check failed",
      },
      500,
    );
  }
};

export const adminApiGetCollectionRunsHandler = async (c: Context) => {
  try {
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "20");
    const status = c.req.query("status") || "";
    const offset = (page - 1) * limit;

    const db = getDrizzleDB(c.env.DB);
    const query = db
      .select()
      .from(Schema.collectionRuns)
      .orderBy(desc(Schema.collectionRuns.startedAt))
      .limit(limit)
      .offset(offset);
    const countQuery = db
      .select({ total: count() })
      .from(Schema.collectionRuns);

    const [runs, countResult] = await Promise.all([
      query.all(),
      countQuery.then((result) => result.at(0)?.total || 0),
    ]);

    const total = countResult;
    const totalPages = Math.ceil(total / limit);

    return c.json({
      runs: runs || [],
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
      status,
    });
  } catch (error) {
    Logger.error("Error fetching collection runs:", error);
    return c.json({ error: "Failed to fetch collection runs" }, 500);
  }
};

export const adminApiGetCollectionRunDetailsHandler = async (c: Context) => {
  try {
    const id = c.req.param("id");

    const db = getDrizzleDB(c.env.DB);
    const run = (
      await db
        .select()
        .from(Schema.collectionRuns)
        .where(eq(Schema.collectionRuns.id, Number(id)))
    ).at(0);

    if (!run) {
      return c.json({ error: "Collection run not found" }, 404);
    }

    const [jobs, workItems] = await Promise.all([
      db
        .select()
        .from(Schema.jobQueue)
        .where(eq(Schema.jobQueue.collectionRunId, Number(id)))
        .orderBy(desc(Schema.jobQueue.createdAt))
        .all(),
      db
        .select()
        .from(Schema.workItems)
        .where(eq(Schema.workItems.collectionRunId, Number(id)))
        .groupBy(Schema.workItems.itemType, Schema.workItems.status)
        .orderBy(desc(Schema.workItems.createdAt))
        .all(),
    ]);

    return c.json({
      run,
      jobs: jobs || [],
      workItems: workItems || [],
      progress: {
        itemsCollected: run.documentsCollected || 0,
        itemsProcessed: run.documentsProcessed || 0,
        totalEstimated: run.totalEstimated || 0,
        percentComplete: run.totalEstimated
          ? Math.round(
              ((Number(run.documentsProcessed) || 0) /
                Number(run.totalEstimated)) *
                100,
            )
          : 0,
      },
    });
  } catch (error) {
    Logger.error("Error fetching collection run details:", error);
    return c.json({ error: "Failed to fetch collection run details" }, 500);
  }
};

export const adminApiGetJobQueueHandler = async (
  c: Context<{ Bindings: Env }>,
) => {
  try {
    const status = c.req.query("status") || "";
    const limit = parseInt(c.req.query("limit") || "100");

    const db = getDrizzleDB(c.env.DB);
    const jobs = await db
      .select()
      .from(Schema.jobQueue)
      .leftJoin(
        Schema.collectionRuns,
        eq(Schema.jobQueue.collectionRunId, Schema.collectionRuns.id),
      )
      .orderBy(desc(Schema.jobQueue.priority), asc(Schema.jobQueue.createdAt))
      .limit(limit)
      .all();

    const stats = await db
      .select({ status: Schema.jobQueue.status, count: count() })
      .from(Schema.jobQueue)
      .groupBy(Schema.jobQueue.status)
      .all();

    return c.json({
      jobs: jobs || [],
      stats: stats || [],
      filters: { status, limit },
    });
  } catch (error) {
    Logger.error("Error fetching job queue:", error);
    return c.json({ error: "Failed to fetch job queue" }, 500);
  }
};

