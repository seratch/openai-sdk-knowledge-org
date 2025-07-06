import { eq, and } from "drizzle-orm";

import type { Env } from "@/env";
import { Auth } from "@/server/middleware/auth";
import { Logger } from "@/logger";
import { getDrizzleDB, type DrizzleDB } from "@/storage/d1-database";
import {
  mcpClients,
  mcpAuthorizationCodes,
} from "@/storage/d1-database/schema";

export interface MCPClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  scopes: string[];
  userEmail: string;
  createdAt: string;
  isActive: boolean;
}

export class MCPOAuth {
  private db: DrizzleDB;

  constructor(private env: Env) {
    this.db = getDrizzleDB(env.DB);
  }

  async registerClient(
    userEmail: string,
    clientName: string,
    redirectUris: string[],
    scopes: string[] = ["mcp:read"],
  ): Promise<{ clientId: string; clientSecret: string }> {
    const clientId = `mcp_${crypto.randomUUID()}`;
    const clientSecret = `mcp_secret_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;

    const encoder = new TextEncoder();
    const data = encoder.encode(clientSecret);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const clientSecretHash = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    await this.db
      .insert(mcpClients)
      .values({
        id,
        clientId,
        clientSecretHash,
        clientName,
        redirectUris: JSON.stringify(redirectUris),
        scopes: JSON.stringify(scopes),
        userEmail,
        createdAt: now,
      })
      .run();

    return { clientId, clientSecret };
  }

  async validateClient(
    clientId: string,
    clientSecret?: string,
  ): Promise<MCPClient | null> {
    const result = await this.db
      .select()
      .from(mcpClients)
      .where(
        and(eq(mcpClients.clientId, clientId), eq(mcpClients.isActive, true)),
      )
      .get();
    if (!result) return null;

    if (clientSecret) {
      const encoder = new TextEncoder();
      const data = encoder.encode(clientSecret);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const providedHash = hashArray
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      if (providedHash !== result.clientSecretHash) {
        return null;
      }
    }

    return {
      clientId: result.clientId,
      clientName: result.clientName,
      redirectUris: JSON.parse(result.redirectUris),
      scopes: JSON.parse(result.scopes),
      userEmail: result.userEmail,
      createdAt: result.createdAt,
      isActive: result.isActive ?? true,
    };
  }

  async generateAuthorizationCode(
    clientId: string,
    userEmail: string,
    redirectUri: string,
    scopes: string[],
    codeChallenge?: string,
    codeChallengeMethod?: string,
  ): Promise<string> {
    const code = `mcp_auth_${crypto.randomUUID().replace(/-/g, "")}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    await this.db
      .insert(mcpAuthorizationCodes)
      .values({
        code,
        clientId,
        userEmail,
        redirectUri,
        scopes: JSON.stringify(scopes),
        codeChallenge,
        codeChallengeMethod,
        expiresAt,
        createdAt: now,
      })
      .run();

    return code;
  }

  async validateAndConsumeAuthorizationCode(
    code: string,
    clientId: string,
    redirectUri: string,
    codeVerifier?: string,
  ): Promise<{ userEmail: string; scopes: string[] } | null> {
    const result = await this.db
      .select()
      .from(mcpAuthorizationCodes)
      .where(
        and(
          eq(mcpAuthorizationCodes.code, code),
          eq(mcpAuthorizationCodes.clientId, clientId),
          eq(mcpAuthorizationCodes.redirectUri, redirectUri),
        ),
      )
      .get();
    if (!result) {
      Logger.lazyDebug(
        () =>
          `Authorization code not found ${JSON.stringify({
            code,
            clientId,
            redirectUri,
          })}`,
      );
      return null;
    }

    if (result.usedAt) {
      Logger.lazyDebug(
        () =>
          `Authorization code already used ${JSON.stringify({
            code,
            usedAt: result.usedAt,
          })}`,
      );
      return null;
    }

    if (new Date(result.expiresAt) < new Date()) {
      Logger.lazyDebug(
        () =>
          `Authorization code expired ${JSON.stringify({
            code,
            expiresAt: result.expiresAt,
          })}`,
      );
      return null;
    }

    if (result.codeChallenge && result.codeChallengeMethod === "S256") {
      if (!codeVerifier) {
        Logger.lazyDebug(
          () =>
            `PKCE code verifier missing ${JSON.stringify({
              code,
              hasCodeChallenge: !!result.codeChallenge,
            })}`,
        );
        return null;
      }

      try {
        const encoder = new TextEncoder();
        const data = encoder.encode(codeVerifier);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hash = btoa(String.fromCharCode(...hashArray))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=/g, "");

        Logger.lazyDebug(
          () =>
            `PKCE verification ${JSON.stringify({
              codeChallenge: result.codeChallenge,
              computedHash: hash,
              codeVerifierLength: codeVerifier.length,
            })}`,
        );

        if (hash !== result.codeChallenge) {
          Logger.warn("PKCE code challenge verification failed", {
            expected: result.codeChallenge,
            computed: hash,
            codeVerifierLength: codeVerifier.length,
          });
          return null;
        }
      } catch (error) {
        Logger.error("PKCE verification error", {
          error: (error as Error).message,
        });
        return null;
      }
    }

    await this.db
      .update(mcpAuthorizationCodes)
      .set({
        usedAt: new Date().toISOString(),
      })
      .where(eq(mcpAuthorizationCodes.code, code))
      .run();

    Logger.lazyDebug(
      () =>
        `Authorization code consumed successfully ${JSON.stringify({
          code,
          userEmail: result.userEmail,
        })}`,
    );

    return {
      userEmail: result.userEmail,
      scopes: JSON.parse(result.scopes),
    };
  }

  async generateMCPAccessToken(
    userEmail: string,
    clientId: string,
    _scopes: string[],
  ): Promise<string> {
    try {
      const auth = new Auth(this.env);
      const existingToken = await auth.findMCPTokenByClientId(
        userEmail,
        clientId,
      );
      if (existingToken) {
        Logger.lazyDebug(
          () =>
            `Reusing existing MCP access token ${JSON.stringify({
              userEmail,
              clientId,
              tokenId: existingToken.id,
            })}`,
        );
        await auth.updateTokenLastUsed(existingToken.id);
        await auth.revokeToken(existingToken.id, userEmail);
      }

      const clientName = await this.getClientName(clientId);
      const tokenName = clientName
        ? `OAuth: ${clientName}`
        : `OAuth: ${clientId}`;
      const expiresInDays = 365;

      Logger.lazyDebug(
        () =>
          `Generating MCP access token ${JSON.stringify({
            userEmail,
            clientId,
            clientName,
            tokenName,
            reusingExisting: !!existingToken,
          })}`,
      );

      const result = await auth.generateApiToken(
        userEmail,
        tokenName,
        expiresInDays,
        true,
      );

      Logger.lazyDebug(
        () =>
          `MCP access token generated successfully ${JSON.stringify({
            userEmail,
            clientId,
            tokenId: result.tokenRecord.id,
          })}`,
      );

      return result.token;
    } catch (error) {
      Logger.error("Failed to generate MCP access token", {
        error: (error as Error).message,
        userEmail,
        clientId,
      });
      throw error;
    }
  }

  async getClientName(clientId: string): Promise<string | null> {
    const result = await this.db
      .select({ clientName: mcpClients.clientName })
      .from(mcpClients)
      .where(
        and(eq(mcpClients.clientId, clientId), eq(mcpClients.isActive, true)),
      )
      .get();

    return result?.clientName || null;
  }

  async getServerMetadata(baseUrl: string) {
    return {
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/mcp/oauth/authorize`,
      token_endpoint: `${baseUrl}/mcp/oauth/token`,
      registration_endpoint: `${baseUrl}/mcp/oauth/register`,
      scopes_supported: ["mcp:read"],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: [
        "client_secret_post",
        "client_secret_basic",
      ],
    };
  }
}
