/**
 * Databricks auth without the SDK.
 *
 * App runtime: Databricks Apps injects DATABRICKS_HOST, DATABRICKS_CLIENT_ID,
 * DATABRICKS_CLIENT_SECRET — exchanged for an OAuth token via client_credentials.
 * Local dev: DATABRICKS_TOKEN (PAT or `databricks auth token` output).
 */

export interface DbxAuthConfig {
  host: string;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  token?: string | undefined;
}

export function authConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DbxAuthConfig {
  const host = env.DATABRICKS_HOST;
  if (!host) throw new Error("DATABRICKS_HOST is not set");
  return {
    host: host.startsWith("http") ? host : `https://${host}`,
    clientId: env.DATABRICKS_CLIENT_ID,
    clientSecret: env.DATABRICKS_CLIENT_SECRET,
    token: env.DATABRICKS_TOKEN,
  };
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

export class TokenProvider {
  private cached: CachedToken | null = null;

  constructor(private readonly cfg: DbxAuthConfig) {}

  async getToken(): Promise<string> {
    if (this.cfg.token) return this.cfg.token;
    if (this.cached && Date.now() < this.cached.expiresAt - 60_000) {
      return this.cached.accessToken;
    }
    if (!this.cfg.clientId || !this.cfg.clientSecret) {
      throw new Error(
        "No Databricks credentials: set DATABRICKS_TOKEN (local) or DATABRICKS_CLIENT_ID/SECRET (app runtime)",
      );
    }
    const res = await fetch(`${this.cfg.host}/oidc/v1/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64")}`,
      },
      body: "grant_type=client_credentials&scope=all-apis",
    });
    if (!res.ok) {
      throw new Error(`OAuth token exchange failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.cached = {
      accessToken: body.access_token,
      expiresAt: Date.now() + body.expires_in * 1000,
    };
    return body.access_token;
  }
}
