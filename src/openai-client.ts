import OpenAI from "openai";
import { ModelProvider, OpenAIProvider } from "@openai/agents";

function buildCloudflareAIGatewayURL(env: {
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_AI_GATEWAY_ID?: string;
}): string {
  return `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.CLOUDFLARE_AI_GATEWAY_ID}/openai/`;
}

export function buildOpenAIClientForOnlineAccess(env: {
  OPENAI_API_KEY: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_AI_GATEWAY_ID?: string;
}): OpenAI {
  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_GATEWAY_ID) {
    return new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      baseURL: buildCloudflareAIGatewayURL(env),
    });
  } else {
    return new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    });
  }
}

export function buildOpenAIClientForDataPipeline(env: {
  OPENAI_API_KEY: string;
}): OpenAI {
  // Intentionally does not use AI Gateway to avoid being in the same rate limit policy with the online users
  return new OpenAI({
    apiKey: env.OPENAI_API_KEY,
  });
}

export function buildOpenAIModelProviderForOnlineAccess(env: {
  OPENAI_API_KEY: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_AI_GATEWAY_ID?: string;
}): ModelProvider {
  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_GATEWAY_ID) {
    return new OpenAIProvider({
      apiKey: env.OPENAI_API_KEY,
      baseURL: buildCloudflareAIGatewayURL(env),
    });
  } else {
    return new OpenAIProvider({
      apiKey: env.OPENAI_API_KEY,
    });
  }
}

export function buildOpenAIModelProviderForDataPipeline(env: {
  OPENAI_API_KEY: string;
}): ModelProvider {
  // Intentionally does not use AI Gateway to avoid being in the same rate limit policy with the online users
  return new OpenAIProvider({
    apiKey: env.OPENAI_API_KEY,
  });
}
