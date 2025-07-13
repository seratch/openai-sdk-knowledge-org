// Main entry point for the OpenAI SDK Knowledge MCP Server
// This Cloudflare Worker provides an MCP server with RAG capabilities for OpenAI SDK knowledge
// Documentation: https://developers.cloudflare.com/workers/runtime-apis/handlers/

import {
  getGlobalTraceProvider,
  setDefaultOpenAITracingExporter,
} from "@openai/agents";
import type { MessageBatch } from "@cloudflare/workers-types";

import { Env } from "@/env";
import { JobProcessor } from "@/pipeline/job-processor";
import { Logger } from "@/logger";
import { app } from "@/server";

// Default export required by Cloudflare Workers
export default {
  // HTTP request handler - processes all incoming HTTP requests
  // https://developers.cloudflare.com/workers/runtime-apis/handlers/fetch/
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    setDefaultOpenAITracingExporter();
    try {
      // Delegate to Hono app for request handling
      return await app.fetch(request, env, ctx);
    } finally {
      // Flush OpenAI Agents SDK traces before response completes
      // This ensures telemetry data is properly sent to OpenAI
      // https://openai.github.io/openai-agents-js/guides/tracing
      ctx.waitUntil(
        (async () => {
          await getGlobalTraceProvider().forceFlush();
          Logger.lazyDebug(() => "OpenAI Agents SDK traces flushed");
        })(),
      );
    }
  },

  // Queue handler - processes background jobs via Cloudflare Queues
  // https://developers.cloudflare.com/queues/
  async queue(
    batch: MessageBatch<{ jobId: number }>,
    env: Env,
    ctx: ExecutionContext,
  ) {
    setDefaultOpenAITracingExporter();
    try {
      Logger.info(`Processing job queue`, {
        batch: batch.messages.map((msg) => msg.body.jobId),
      });

      // Process each job in the batch sequentially
      // Jobs handle data collection from GitHub API and OpenAI forum
      const processor = new JobProcessor(env);
      for (const msg of batch.messages) {
        await processor.processJob(msg.body.jobId);
      }
    } finally {
      // Flush OpenAI Agents SDK traces before response completes
      // This ensures telemetry data is properly sent to OpenAI
      // https://openai.github.io/openai-agents-js/guides/tracing
      ctx.waitUntil(
        (async () => {
          await getGlobalTraceProvider().forceFlush();
          Logger.lazyDebug(() => "OpenAI Agents SDK traces flushed");
        })(),
      );
    }
  },
};
