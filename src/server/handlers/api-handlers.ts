import { Context } from "hono";
import { InputGuardrailTripwireTriggered } from "@openai/agents";

import { POLICY_MESSAGE } from "@/agents/guardrails/input-guardrails";
import { createMainAgent, MainAgentResponse } from "@/agents/main-agent";
import { Logger } from "@/logger";
import { Auth, AuthUser } from "@/server/middleware/auth";
import { calculateServiceStatus } from "@/server/service-status";
import { Env } from "@/env";

export const webappQueryHandler = async (c: Context<{ Bindings: Env }>) => {
  const startTime = Date.now();

  try {
    const validatedData = (c as any).get("validatedData");
    const query = validatedData.query;
    const includeHistory = false;
    const maxResults = 10;

    if (!c.env.OPENAI_API_KEY) {
      return c.json({ error: "OpenAI API key not configured" }, 500);
    }

    let agentResult: MainAgentResponse;
    try {
      const agent = createMainAgent(c.env);
      agentResult = await agent.processQuery(query);
    } catch (error) {
      if (error instanceof InputGuardrailTripwireTriggered) {
        return c.json({ error: POLICY_MESSAGE }, 400);
      }
      throw error;
    }

    const result = {
      query,
      response: agentResult.content,
      sources: [],
      timestamp: new Date().toISOString(),
      queryId: Math.random().toString(36).substring(7),
      metadata: {
        processingTime: Date.now() - startTime,
        maxResults,
        includeHistory,
        originalLanguage: agentResult.questionLanguage,
      },
    };
    return c.json(result);
  } catch (error) {
    Logger.error("Error processing query:", error);
    throw error;
  }
};

export const getTokensHandler = async (c: Context<{ Bindings: Env }>) => {
  try {
    const user = (c as any).get("user") as AuthUser;
    const authenticator = new Auth(c.env);
    const tokens = await authenticator.listUserTokens(user.email);
    return c.json({ tokens });
  } catch (error) {
    Logger.error("Error fetching tokens:", error);
    return c.json({ error: "Failed to fetch tokens" }, 500);
  }
};

export const tokenCreationHandler = async (c: Context<{ Bindings: Env }>) => {
  try {
    const user = (c as any).get("user") as AuthUser;
    const { name, expiresInDays } = await c.req.json();
    const authenticator = new Auth(c.env);
    const result = await authenticator.generateApiToken(
      user.email,
      name,
      expiresInDays,
    );
    return c.json({ token: result.token, tokenRecord: result.tokenRecord });
  } catch (error) {
    Logger.error("Error generating token:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to generate token";
    return c.json({ error: errorMessage }, 500);
  }
};

export const tokenDeletionHandler = async (c: Context<{ Bindings: Env }>) => {
  try {
    const user = (c as any).get("user") as AuthUser;
    const tokenId = c.req.param("tokenId");
    const authenticator = new Auth(c.env);
    const success = await authenticator.revokeToken(tokenId, user.email);
    return c.json({ success });
  } catch (error) {
    Logger.error("Error revoking token:", error);
    return c.json({ error: "Failed to revoke token" }, 500);
  }
};

export const healthHandler = async (c: Context<{ Bindings: Env }>) => {
  const serviceHealth = await calculateServiceStatus(c.env);
  return c.json({
    status: serviceHealth.status,
    timestamp: new Date().toISOString(),
    services: serviceHealth.services,
  });
};
