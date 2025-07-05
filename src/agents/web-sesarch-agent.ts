import { Agent, webSearchTool } from "@openai/agents";

import type { Env } from "@/env";
import {
  createContentModerationGuardrail,
  createTopicRelevanceGuardrail,
} from "@/agents/guardrails/input-guardrails";

export async function createWebSearchAgent(env: Env): Promise<Agent> {
  return new Agent({
    name: "web-search-agent",
    model: "gpt-4.1-mini",
    instructions: `You are an expert assistant for OpenAI APIs, tools, and documentation. You are being used as a fallback when the RAG system couldn't find sufficient information.

Use web search to find current, comprehensive information about OpenAI APIs and related technologies. Focus on:
- Official OpenAI documentation and announcements
- Recent updates and changes to APIs
- Community discussions and solutions
- Code examples and best practices

When providing responses:
- Include practical code examples when relevant
- Explain concepts clearly with context
- Provide step-by-step guidance when appropriate
- Always cite your web sources and indicate this information comes from web search
- Don't mix programming language; if the language is not specified, use Python
- When you don't have from the tool results, don't guess any parts of the code examples and explanations your provide
`,
    tools: [webSearchTool({ searchContextSize: "low" })],
    inputGuardrails: [
      createContentModerationGuardrail(env.OPENAI_API_KEY),
      createTopicRelevanceGuardrail(env.OPENAI_API_KEY),
    ],
  });
}
