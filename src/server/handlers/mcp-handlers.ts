import { Context } from "hono";

import { Env } from "@/env";
import { MCPOAuth } from "@/server/middleware/mcp-oauth";
import { Logger } from "@/logger";
import { renderOAuthAuthorizePage } from "@/server/webapp/pages";
import { Auth, AuthUser } from "@/server/middleware/auth";
import { JsonRpcHandler, type JsonRpcRequest } from "@/server/mcp/mcp-server";

export const mcpWellKnownHandler = async (c: Context<{ Bindings: Env }>) => {
  try {
    console.log("mcpWellKnownHandler", c.req.url);
    const baseUrl = new URL(c.req.url).origin;
    const mcpOAuth = new MCPOAuth(c.env);
    const metadata = await mcpOAuth.getServerMetadata(baseUrl);
    return c.json(metadata);
  } catch (error) {
    Logger.error("OAuth metadata error", { error: (error as Error).message });
    return c.json({ error: "server_error" }, 500);
  }
};

export const mcpOtherMethodsHandler = async (c: Context<{ Bindings: Env }>) => {
  return c.json({ jsonrpc: "2.0" }, 200);
};

export const mcpServerHandler = async (c: Context<{ Bindings: Env }>) => {
  const contentType = c.req.header("Content-Type");
  if (!contentType || !contentType.includes("application/json")) {
    return c.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: "Invalid Request",
          data: "Content-Type must be application/json",
        },
        id: null,
      },
      400,
    );
  }
  const request = (await c.req.json()) as JsonRpcRequest;
  const requestId = request.id ?? null;
  try {
    if (!request || typeof request !== "object") {
      return c.json(
        {
          jsonrpc: "2.0",
          error: { code: -32700, message: "Parse error" },
          id: null,
        },
        400,
      );
    }

    if (request.jsonrpc !== "2.0") {
      return c.json(
        {
          jsonrpc: "2.0",
          error: { code: -32600, message: "Invalid Request" },
          id: requestId,
        },
        400,
      );
    }

    if (request.method === "initialize") {
      const sessionId = crypto.randomUUID();
      c.header("Mcp-Session-Id", sessionId);
      c.header("Access-Control-Expose-Headers", "Mcp-Session-Id");
    }

    const requestHeaders = c.req.header();
    const response = await new JsonRpcHandler(c.env).handleJsonRpcRequest(
      request,
      requestHeaders,
    );
    return c.json(response);
  } catch (error) {
    Logger.error("Error in /mcp endpoint:", error);
    return c.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal error",
          data: error instanceof Error ? error.message : "Unknown error",
        },
        id: requestId,
      },
      500,
    );
  }
};

export const mcpOAuthRegisterHandler = async (
  c: Context<{ Bindings: Env }>,
) => {
  try {
    const { client_name, redirect_uris, scopes } = await c.req.json();

    if (!client_name || !redirect_uris || !Array.isArray(redirect_uris)) {
      return c.json(
        { error: "client_name and redirect_uris are required" },
        400,
      );
    }

    for (const uri of redirect_uris) {
      try {
        const url = new URL(uri);
        if (url.protocol !== "https:" && url.hostname !== "localhost") {
          return c.json(
            {
              error: `Invalid redirect URI: ${uri}. Must be HTTPS or localhost`,
            },
            400,
          );
        }
      } catch {
        return c.json({ error: `Invalid redirect URI: ${uri}` }, 400);
      }
    }

    const mcpOAuth = new MCPOAuth(c.env);
    const result = await mcpOAuth.registerClient(
      "system@mcp-server.local",
      client_name,
      redirect_uris,
      scopes || ["mcp:read"],
    );

    return c.json({
      client_id: result.clientId,
      client_secret: result.clientSecret,
      client_name,
      redirect_uris,
      scopes: scopes || ["mcp:read"],
    });
  } catch (error) {
    Logger.error("MCP client registration error", {
      error: (error as Error).message,
    });
    return c.json({ error: "Client registration failed" }, 500);
  }
};

export const mcpOAuthAuthorizeHandler = async (
  c: Context<{ Bindings: Env }>,
) => {
  try {
    const clientId = c.req.query("client_id");
    const redirectUri = c.req.query("redirect_uri");
    const responseType = c.req.query("response_type");
    const scope = c.req.query("scope");
    const state = c.req.query("state");
    const codeChallenge = c.req.query("code_challenge");
    const codeChallengeMethod = c.req.query("code_challenge_method");

    if (!clientId || !redirectUri || responseType !== "code") {
      return c.json({ error: "Invalid request parameters" }, 400);
    }

    const mcpOAuth = new MCPOAuth(c.env);
    const client = await mcpOAuth.validateClient(clientId);

    if (!client) {
      return c.json({ error: "Invalid client_id" }, 400);
    }

    if (!client.redirectUris.includes(redirectUri)) {
      return c.json({ error: "Invalid redirect_uri" }, 400);
    }

    const auth = new Auth(c.env);
    const user = await auth.getCurrentUser(c);

    if (!user) {
      const mcpState = encodeURIComponent(
        JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          scope: scope || "mcp:read",
          state,
          code_challenge: codeChallenge,
          code_challenge_method: codeChallengeMethod,
          type: "mcp_oauth",
        }),
      );
      const authUrl = auth.buildGoogleAuthUrl({ mcpState });
      return c.redirect(authUrl);
    }

    const scopes = scope ? scope.split(" ") : ["mcp:read"];
    return c.html(
      renderOAuthAuthorizePage({
        clientId,
        redirectUri,
        scope,
        state,
        codeChallenge,
        codeChallengeMethod,
        clientName: client.clientName,
        user,
        scopes,
      }),
    );
  } catch (error) {
    Logger.error("MCP OAuth authorize error", {
      error: (error as Error).message,
    });
    return c.json({ error: "Authorization failed" }, 500);
  }
};

export const mcpOAuthConsentHandler = async (c: Context<{ Bindings: Env }>) => {
  try {
    const user = (c as any).get("user") as AuthUser;
    const formData = await c.req.formData();

    const clientId = formData.get("client_id") as string;
    const redirectUri = formData.get("redirect_uri") as string;
    const scope = formData.get("scope") as string;
    const state = formData.get("state") as string;
    const action = formData.get("action") as string;
    const codeChallenge = formData.get("code_challenge") as string;
    const codeChallengeMethod = formData.get("code_challenge_method") as string;

    if (action === "deny") {
      const errorUrl = new URL(redirectUri);
      errorUrl.searchParams.set("error", "access_denied");
      if (state) errorUrl.searchParams.set("state", state);
      return c.redirect(errorUrl.toString());
    }

    const mcpOAuth = new MCPOAuth(c.env);
    const scopes = scope ? scope.split(" ") : ["mcp:read"];

    const authCode = await mcpOAuth.generateAuthorizationCode(
      clientId,
      user.email,
      redirectUri,
      scopes,
      codeChallenge,
      codeChallengeMethod,
    );

    const successUrl = new URL(redirectUri);
    successUrl.searchParams.set("code", authCode);
    if (state) successUrl.searchParams.set("state", state);

    return c.redirect(successUrl.toString());
  } catch (error) {
    Logger.error("MCP OAuth consent error", {
      error: (error as Error).message,
    });
    return c.json({ error: "Consent processing failed" }, 500);
  }
};

export const mcpOAuthTokenHandler = async (c: Context<{ Bindings: Env }>) => {
  try {
    const contentType = c.req.header("Content-Type");
    let grantType: string,
      code: string,
      redirectUri: string,
      clientId: string,
      clientSecret: string,
      codeVerifier: string;

    if (contentType?.includes("application/x-www-form-urlencoded")) {
      const formData = await c.req.formData();
      grantType = formData.get("grant_type") as string;
      code = formData.get("code") as string;
      redirectUri = formData.get("redirect_uri") as string;
      clientId = formData.get("client_id") as string;
      clientSecret = formData.get("client_secret") as string;
      codeVerifier = formData.get("code_verifier") as string;
    } else {
      const body = await c.req.json();
      ({
        grant_type: grantType,
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: codeVerifier,
      } = body);
    }

    if (!clientId || !clientSecret) {
      const authHeader = c.req.header("Authorization");
      if (authHeader && authHeader.startsWith("Basic ")) {
        try {
          const base64Credentials = authHeader.slice(6); // Remove "Basic " prefix
          const credentials = atob(base64Credentials);
          const [headerClientId, headerClientSecret] = credentials.split(
            ":",
            2,
          );

          if (headerClientId && headerClientSecret) {
            clientId = clientId || headerClientId;
            clientSecret = clientSecret || headerClientSecret;
          }
        } catch (error) {
          Logger.warn("Failed to parse Authorization header", {
            error: (error as Error).message,
          });
        }
      }
    }

    Logger.lazyDebug(
      () =>
        `MCP OAuth token request ${JSON.stringify({
          grantType,
          clientId,
          redirectUri,
          hasCode: !!code,
          hasClientSecret: !!clientSecret,
          hasCodeVerifier: !!codeVerifier,
        })}`,
    );

    if (grantType !== "authorization_code") {
      Logger.warn("Invalid grant type", { grantType });
      return c.json({ error: "unsupported_grant_type" }, 400);
    }

    if (!code || !redirectUri || !clientId || !clientSecret) {
      Logger.warn("Missing required parameters", {
        hasCode: !!code,
        hasRedirectUri: !!redirectUri,
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
      });
      return c.json({ error: "invalid_request" }, 400);
    }

    const mcpOAuth = new MCPOAuth(c.env);

    const client = await mcpOAuth.validateClient(clientId, clientSecret);
    if (!client) {
      Logger.warn("Client validation failed", { clientId });
      return c.json({ error: "invalid_client" }, 401);
    }

    Logger.lazyDebug(
      () =>
        `Client validated successfully ${JSON.stringify({
          clientId,
          clientName: client.clientName,
        })}`,
    );

    const authResult = await mcpOAuth.validateAndConsumeAuthorizationCode(
      code,
      clientId,
      redirectUri,
      codeVerifier,
    );
    if (!authResult) {
      Logger.warn("Authorization code validation failed", {
        code,
        clientId,
        redirectUri,
        hasCodeVerifier: !!codeVerifier,
      });
      return c.json({ error: "invalid_grant" }, 400);
    }

    Logger.lazyDebug(
      () =>
        `Authorization code validated successfully ${JSON.stringify({
          userEmail: authResult.userEmail,
          scopes: authResult.scopes,
        })}`,
    );

    const accessToken = await mcpOAuth.generateMCPAccessToken(
      authResult.userEmail,
      clientId,
      authResult.scopes,
    );

    Logger.info("MCP OAuth token generated successfully", {
      clientId,
      userEmail: authResult.userEmail,
    });

    return c.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 30 * 24 * 60 * 60,
      scope: authResult.scopes.join(" "),
    });
  } catch (error) {
    Logger.error("MCP OAuth token error", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    return c.json({ error: "server_error" }, 500);
  }
};
