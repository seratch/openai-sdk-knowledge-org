import { getGlobalTraceProvider } from "@openai/agents";
import type { MessageBatch } from "@cloudflare/workers-types";

import { Env } from "@/env";
import { JobProcessor } from "@/pipeline/job-processor";
import { Logger } from "@/logger";
import { app } from "@/server";

export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    try {
      return app.fetch(request, env, ctx);
    } finally {
      // make sure to flush any remaining traces before exiting
      ctx.waitUntil(getGlobalTraceProvider().forceFlush());
    }
  },
  async queue(batch: MessageBatch<{ jobId: number }>, env: Env, ctx: any) {
    Logger.info(`Processing job queue`, {
      batch: batch.messages.map((msg) => msg.body.jobId),
    });
    const processor = new JobProcessor(env);
    for (const msg of batch.messages) {
      await processor.processJob(msg.body.jobId);
    }
    ctx.waitUntil(getGlobalTraceProvider().forceFlush());
  },
};
