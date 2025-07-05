import { Env } from "@/env";
import { Logger } from "@/logger";
import { JobProcessor } from "@/pipeline/job-processor";

export async function processJobQueue(env: Env) {
  const startTime = Date.now();
  try {
    Logger.info("Starting job queue processing");
    const jobProcessor = new JobProcessor(env);
    const processingResult = await jobProcessor.processNextJobs(15);
    const duration = Date.now() - startTime;
    Logger.info(
      `Job queue processing completed successfully in ${duration}ms (details: ${JSON.stringify(
        {
          processed: processingResult.processed,
          succeeded: processingResult.succeeded,
          failed: processingResult.failed,
          duration,
          timestamp: new Date().toISOString(),
        },
      )})`,
    );

    if (processingResult.errors.length > 0) {
      Logger.warn(
        "Job processing errors encountered:",
        processingResult.errors,
      );
    }

    return processingResult;
  } catch (error) {
    const duration = Date.now() - startTime;
    Logger.error("Error processing job queue:", {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
      duration,
      timestamp: new Date().toISOString(),
    });
    throw error;
  }
}
