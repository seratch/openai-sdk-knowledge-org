import { Agent } from "@openai/agents";

import { Env } from "@/env";

export async function createRAGResultEvaluatorAgent(_env: Env): Promise<Agent> {
  return new Agent({
    name: "rag-result-evaluator-agent",
    model: "gpt-4.1-nano",
    instructions: `You are an expert evaluator of technical responses. Your task is to determine if a given response is meaningful and sufficient for answering technical questions about OpenAI APIs.

  Evaluate the response and determine if it contains:
  - Relevant technical information
  - Actionable guidance or examples
  - Sufficient detail to be helpful
  - Clear and coherent content

  A response is INSUFFICIENT if it:
  - Contains generic "no information found" messages
  - Is fragmented or low-quality
  - Lacks relevant technical content
  - Is too vague to be actionable

  Respond with exactly "INSUFFICIENT" if the response is not meaningful for technical questions, or "SUFFICIENT" if it contains useful technical information.`,
    tools: [],
    inputGuardrails: [],
  });
}
