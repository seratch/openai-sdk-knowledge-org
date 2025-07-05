import { Context } from "hono";

import { Auth, AuthState } from "@/server/middleware/auth";
import { Env } from "@/env";
import { Logger } from "@/logger";

export const authLoginHandler = async (c: Context<{ Bindings: Env }>) => {
  const auth = new Auth(c.env);
  const state = { returnTo: c.req.query("redirect") || "/" };
  const authUrl = auth.buildGoogleAuthUrl(state);
  return c.redirect(authUrl);
};

export const authCallbackHandler = async (c: Context<{ Bindings: Env }>) => {
  try {
    const code = c.req.query("code");
    const state: AuthState = JSON.parse(c.req.query("state") || "{}");

    if (!code) {
      return c.json({ error: "Authorization code not provided" }, 400);
    }

    const auth = new Auth(c.env);
    const tokens = await auth.exchangeCodeForTokens(code);
    const user = await auth.getUserInfo(tokens.access_token);

    const token = await auth.createJWT(user);
    auth.setAuthCookie(c, token);

    if (state.mcpState) {
      try {
        const mcpParams = JSON.parse(decodeURIComponent(state.mcpState));
        if (mcpParams.type === "mcp_oauth") {
          const redirectUrl = new URL("/mcp/oauth/authorize", c.req.url);
          redirectUrl.searchParams.set("client_id", mcpParams.client_id);
          redirectUrl.searchParams.set("redirect_uri", mcpParams.redirect_uri);
          redirectUrl.searchParams.set("response_type", "code");
          redirectUrl.searchParams.set("scope", mcpParams.scope);
          if (mcpParams.state) {
            redirectUrl.searchParams.set("state", mcpParams.state);
          }
          if (mcpParams.code_challenge) {
            redirectUrl.searchParams.set(
              "code_challenge",
              mcpParams.code_challenge,
            );
          }
          if (mcpParams.code_challenge_method) {
            redirectUrl.searchParams.set(
              "code_challenge_method",
              mcpParams.code_challenge_method,
            );
          }
          return c.redirect(redirectUrl.toString());
        }
      } catch (error) {
        Logger.error("MCP state parsing error", {
          error: (error as Error).message,
        });
      }
    }

    return c.redirect(decodeURIComponent(state.returnTo || "/"));
  } catch (error) {
    Logger.error("OAuth callback error", { error: (error as Error).message });
    return c.json({ error: "Authentication failed" }, 500);
  }
};

export const authLogoutHandler = async (c: Context<{ Bindings: Env }>) => {
  const auth = new Auth(c.env);
  auth.clearAuthCookie(c);
  return c.redirect("/");
};
