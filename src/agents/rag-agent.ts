import { Agent, webSearchTool } from "@openai/agents";

import type { Env } from "@/env";
import { getVectorStore } from "@/storage/vector-store";
import { TranslatorAgent } from "@/agents/translator-agent";
import { createRAGSearchTool } from "@/agents/tools/rag-tool";
import {
  createContentModerationGuardrail,
  createTopicRelevanceGuardrail,
} from "@/agents/guardrails/input-guardrails";

export async function createRAGAgent(
  env: Env,
  programmingLanguage: string | undefined,
): Promise<Agent> {
  return new Agent({
    name: "openai-sdk-knowledge-rag-agent",
    model: "gpt-4.1-mini",
    instructions: `You are an OpenAI API expert. You must use all the available tools before answering the user's question. The openai_knowledge_search's results are the primary source of information. The web_search's results can be used as a secondary source of information.

### User Context
- The user seeks practical examples for OpenAI platform features and/or SDKs.
- Default to Python if no programminglanguage is specified.
- If the user mentions “agents,” assume they are using the OpenAI Agents SDK (TypeScript or Python).

### Deprecation & Recommended APIs
- Prefer Responses API over Chat Completions.
- The Assistants API is deprecated; replace with Responses API in all answers.

### Response Standards
- Accuracy: Only answer if supported by RAG results. Otherwise, reply: “No relevant info found."
- Up-to-date: Do not use old style code (e.g., instantiating OpenAI client over openai.Chat.XXX in Python etc.)
- Code: Supply runnable code examples. Do not mix languages in one answer; default to Python unless specified.
- Structure: Use logical headings (###), ordered steps, or bullet lists for clarity.
- No Speculation: If RAG results are missing or incomplete, state this and stop.
- Speed: You should not take time for responding to this; find a great balance between speed and accuracy.
`,
    tools: [
      createRAGSearchTool(
        await getVectorStore(env),
        programmingLanguage,
        new TranslatorAgent(env),
      ),
      webSearchTool(),
    ],
    modelSettings: {
      parallelToolCalls: true,
    },
    inputGuardrails: [
      createContentModerationGuardrail(env.OPENAI_API_KEY),
      createTopicRelevanceGuardrail(env.OPENAI_API_KEY),
    ],
  });
}
