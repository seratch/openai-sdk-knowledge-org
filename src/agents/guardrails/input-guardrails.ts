import { buildOpenAIClientForOnlineAccess } from "@/openai-client";
import { InputGuardrail } from "@openai/agents";

const POLICY_MESSAGE =
  "This app does not respond to this request due to its policies.";

export function createContentModerationGuardrail(
  apiKey: string,
): InputGuardrail {
  const openai = buildOpenAIClientForOnlineAccess({ OPENAI_API_KEY: apiKey });

  return {
    name: "Content Moderation Guardrail",
    execute: async ({ input }: { input: any }) => {
      try {
        const inputText =
          typeof input === "string" ? input : JSON.stringify(input);
        const response = await openai.moderations.create({
          input: inputText,
        });

        const result = response.results[0];
        if (result.flagged) {
          return {
            outputInfo: {
              reason: "harmful_content",
              categories: result.categories,
            },
            tripwireTriggered: true,
          };
        }

        return {
          outputInfo: { reason: "content_approved" },
          tripwireTriggered: false,
        };
      } catch (error) {
        return {
          outputInfo: {
            reason: "moderation_error",
            error: error instanceof Error ? error.message : "Unknown error",
          },
          tripwireTriggered: false,
        };
      }
    },
  };
}

export function createTopicRelevanceGuardrail(apiKey: string): InputGuardrail {
  const openai = buildOpenAIClientForOnlineAccess({ OPENAI_API_KEY: apiKey });

  return {
    name: "Topic Relevance Guardrail",
    execute: async ({ input }: { input: any }) => {
      try {
        const response = await openai.responses.create({
          model: "gpt-4.1-nano",
          instructions: `You are a topic classifier. Determine if the user's question is related to OpenAI API, OpenAI platform technology, or OpenAI services (like OpenAI's APIs, Responses API, Agents SDK, etc.). The input itself may not directly mention the terms like "OpenAI" but if you think the question is related to OpenAI if that's the context behind the question, respond with "YES".

Respond with only "YES" if the question is related to OpenAI API/platform/technology, or "NO" if it's unrelated.

Examples of RELATED topics:
- How to use OpenAI API in general
- Responses API
- Chat Completions API
- GPT model questions
- Function calling
- Built-in tools like web search, code interpreter, image generation, file search, etc.
- speech-text, text-to-speech, etc.
- Realtime API (WebRTC, WebSocket)
- OpenAI embeddings
- Fine-tuning models
- OpenAI Agents SDK (Python, TypeScript)

Examples of UNRELATED topics:
- General programming questions not specific to OpenAI
- Other AI services (Anthropic, Google, etc.)
- General life advice
- Non-technical questions
`,
          input: input,
          max_output_tokens: 16,
          temperature: 0,
        });

        const result = response.output_text.toUpperCase();

        if (result === "NO") {
          return {
            outputInfo: { reason: "off_topic" },
            tripwireTriggered: true,
          };
        }

        return {
          outputInfo: { reason: "topic_approved" },
          tripwireTriggered: false,
        };
      } catch (error) {
        return {
          outputInfo: {
            reason: "topic_check_error",
            error: error instanceof Error ? error.message : "Unknown error",
          },
          tripwireTriggered: false,
        };
      }
    },
  };
}

export { POLICY_MESSAGE };
