import { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { eq, and, desc } from "drizzle-orm";
import jwt from "@tsndr/cloudflare-worker-jwt";

import type { Env } from "@/env";
import { getDrizzleDB, type DrizzleDB } from "@/storage/d1-database";
import { apiTokens } from "@/storage/d1-database/schema";

export interface AuthUser {
  email: string;
  name: string;
  picture?: string;
}

export interface ApiToken {
  id: string;
  user_email: string;
  name: string;
  created_at: string;
  expires_at?: string;
  last_used_at?: string;
  is_revoked: boolean;
}

export interface JWTPayload {
  email: string;
  name: string;
  picture?: string;
  exp: number;
  iat: number;
}

const DEFAULT_JWT_SECRET = "dE4YIVp3Qw7CeN9UGOudNDp2otF2jfH";

export interface AuthState {
  returnTo?: string;
  mcpState?: string;
}

export class Auth {
  private db: DrizzleDB;
  constructor(private env: Env) {
    this.db = getDrizzleDB(env.DB);
  }

  buildGoogleAuthUrl(state?: AuthState): string {
    const clientId = this.env.GOOGLE_CLIENT_ID;
    const redirectUri =
      this.env.GOOGLE_REDIRECT_URI || "http://localhost:8787/auth/callback";

    const params = new URLSearchParams({
      client_id: clientId!,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "consent",
    });

    if (state) {
      params.set("state", JSON.stringify(state));
    }

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string): Promise<any> {
    const tokenUrl = "https://oauth2.googleapis.com/token";
    const redirectUri =
      this.env.GOOGLE_REDIRECT_URI || "http://localhost:8787/auth/callback";

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: this.env.GOOGLE_CLIENT_ID!,
        client_secret: this.env.GOOGLE_CLIENT_SECRET!,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to exchange code for tokens");
    }

    return response.json();
  }

  async getUserInfo(accessToken: string): Promise<AuthUser> {
    const response = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error("Failed to get user info");
    }

    const userInfo = (await response.json()) as any;
    return {
      email: userInfo.email,
      name: userInfo.name,
      picture: userInfo.picture,
    };
  }

  isAdminEmail(email: string): boolean {
    const adminEmails = this.env.ADMIN_EMAILS || "seratch@gmail.com";
    const allowedEmails = adminEmails
      .split(",")
      .map((e: string) => e.trim().toLowerCase());
    return allowedEmails.includes(email.toLowerCase());
  }

  async createJWT(user: AuthUser): Promise<string> {
    const payload: JWTPayload = {
      email: user.email,
      name: user.name,
      picture: user.picture,
      exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
      iat: Math.floor(Date.now() / 1000),
    };

    return jwt.sign(payload, this.env.GOOGLE_JWT_SECRET || DEFAULT_JWT_SECRET);
  }

  async verifyJWT(token: string): Promise<JWTPayload | null> {
    try {
      const isValid = await jwt.verify(
        token,
        this.env.GOOGLE_JWT_SECRET || DEFAULT_JWT_SECRET,
      );
      if (!isValid) return null;

      const payload = jwt.decode(token);
      return payload.payload as JWTPayload;
    } catch {
      return null;
    }
  }

  async getCurrentUser(c: Context): Promise<AuthUser | null> {
    const token = getCookie(c, "auth_token");
    if (!token) return null;

    const payload = await this.verifyJWT(token);
    if (!payload) return null;

    return {
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    };
  }

  setAuthCookie(c: Context, token: string) {
    setCookie(c, "auth_token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      maxAge: 24 * 60 * 60,
      path: "/",
    });
  }

  clearAuthCookie(c: Context) {
    deleteCookie(c, "auth_token", {
      path: "/",
    });
  }

  async generateApiToken(
    userEmail: string,
    name: string,
    expiresInDays?: number,
    bypassTokenLimit: boolean = false,
  ): Promise<{ token: string; tokenRecord: ApiToken }> {
    if (!bypassTokenLimit) {
      const existingTokens = await this.listUserTokens(userEmail);
      if (existingTokens.length >= 2) {
        throw new Error(
          "User already has the maximum number of API tokens (2). Please revoke an existing token before creating a new one.",
        );
      }
    }

    const tokenId = crypto.randomUUID();
    const token = `mcp_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;

    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const tokenHash = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const now = new Date().toISOString();
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

    const tokenRecord: ApiToken = {
      id: tokenId,
      user_email: userEmail,
      name,
      created_at: now,
      expires_at: expiresAt || undefined,
      last_used_at: undefined,
      is_revoked: false,
    };

    await this.db
      .insert(apiTokens)
      .values({
        id: tokenId,
        userEmail,
        tokenHash,
        name,
        createdAt: now,
        expiresAt,
        isRevoked: false,
      })
      .run();

    return { token, tokenRecord };
  }

  async validateApiToken(
    token: string,
  ): Promise<{ valid: boolean; userEmail?: string; tokenId?: string }> {
    if (!token.startsWith("mcp_")) {
      return { valid: false };
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const tokenHash = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const result = await this.db
      .select({
        id: apiTokens.id,
        user_email: apiTokens.userEmail,
        expires_at: apiTokens.expiresAt,
        is_revoked: apiTokens.isRevoked,
      })
      .from(apiTokens)
      .where(eq(apiTokens.tokenHash, tokenHash))
      .get();

    if (!result || result.is_revoked) {
      return { valid: false };
    }

    if (
      result.expires_at &&
      new Date(result.expires_at as string) < new Date()
    ) {
      return { valid: false };
    }

    return {
      valid: true,
      userEmail: result.user_email as string,
      tokenId: result.id as string,
    };
  }

  async listUserTokens(userEmail: string): Promise<ApiToken[]> {
    const results = await this.db
      .select({
        id: apiTokens.id,
        user_email: apiTokens.userEmail,
        name: apiTokens.name,
        created_at: apiTokens.createdAt,
        expires_at: apiTokens.expiresAt,
        last_used_at: apiTokens.lastUsedAt,
        is_revoked: apiTokens.isRevoked,
      })
      .from(apiTokens)
      .where(
        and(eq(apiTokens.userEmail, userEmail), eq(apiTokens.isRevoked, false)),
      )
      .orderBy(desc(apiTokens.createdAt))
      .all();
    return results as ApiToken[];
  }

  async revokeToken(tokenId: string, userEmail: string): Promise<boolean> {
    const result = await this.db
      .update(apiTokens)
      .set({ isRevoked: true })
      .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userEmail, userEmail)))
      .run();
    return result.success ?? false;
  }

  async updateTokenLastUsed(tokenId: string): Promise<void> {
    await this.db
      .update(apiTokens)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(apiTokens.id, tokenId))
      .run();
  }

  async findMCPTokenByClientId(
    userEmail: string,
    clientId: string,
  ): Promise<ApiToken | null> {
    const tokenName = `MCP OAuth Connection: ${clientId}`;
    const result = await this.db
      .select({
        id: apiTokens.id,
        user_email: apiTokens.userEmail,
        name: apiTokens.name,
        created_at: apiTokens.createdAt,
        expires_at: apiTokens.expiresAt,
        last_used_at: apiTokens.lastUsedAt,
        is_revoked: apiTokens.isRevoked,
      })
      .from(apiTokens)
      .where(
        and(
          eq(apiTokens.userEmail, userEmail),
          eq(apiTokens.name, tokenName),
          eq(apiTokens.isRevoked, false),
        ),
      )
      .orderBy(desc(apiTokens.createdAt))
      .limit(1)
      .get();
    if (!result) return null;

    if (
      result.expires_at &&
      new Date(result.expires_at as string) < new Date()
    ) {
      return null;
    }

    return result as unknown as ApiToken;
  }
}

export async function requireAdminAuth(c: Context, next: () => Promise<void>) {
  const env = c.env as Env;

  if (
    env.ENVIRONMENT === "development" &&
    env.DISABLE_ADMIN_AUTH_FOR_LOCAL_DEV === "true"
  ) {
    const mockUser: AuthUser = {
      email: "dev-admin@example.com",
      name: "Dev Admin User",
    };
    (c as any).set("user", mockUser);
    return next();
  }

  const auth = new Auth(env);
  const user = await auth.getCurrentUser(c);

  if (!user) {
    return c.redirect("/auth/login?redirect=" + encodeURIComponent(c.req.url));
  }

  if (!auth.isAdminEmail(user.email)) {
    return c.json({ error: "Access denied. Admin privileges required." }, 403);
  }

  (c as any).set("user", user);
  return next();
}

export async function requireApiToken(c: Context, next: () => Promise<void>) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "API token required" }, 401);
  }

  const token = authHeader.substring(7);
  const auth = new Auth(c.env as Env);
  const validation = await auth.validateApiToken(token);

  if (!validation.valid) {
    return c.json({ error: "Invalid API token" }, 401);
  }

  if (validation.tokenId) {
    await auth.updateTokenLastUsed(validation.tokenId);
  }

  (c as any).set("tokenUser", { email: validation.userEmail });
  return next();
}

export async function requireAuth(c: Context, next: () => Promise<void>) {
  const env = c.env as Env;

  if (
    env.ENVIRONMENT === "development" &&
    env.DISABLE_ADMIN_AUTH_FOR_LOCAL_DEV === "true"
  ) {
    const mockUser: AuthUser = {
      email: "local-dev@example.com",
      name: "Local Development User",
    };
    (c as any).set("user", mockUser);
    return next();
  }

  const auth = new Auth(env);
  const user = await auth.getCurrentUser(c);

  if (!user) {
    return c.redirect("/auth/login?redirect=" + encodeURIComponent(c.req.url));
  }

  (c as any).set("user", user);
  return next();
}
