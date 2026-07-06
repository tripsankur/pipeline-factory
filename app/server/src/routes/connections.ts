import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DbxClient } from "@pf/dbx";
import type { AppConfig } from "../config.js";

/**
 * App-managed source connections (key feature): the app creates Unity Catalog
 * connections itself — including the full Salesforce OAuth (PKCE) dance using
 * its own public callback URL. Secrets pass browser → app → UC connection
 * options; they are never persisted anywhere else (constraint #4).
 */

interface PendingOAuth {
  name: string;
  clientId: string;
  clientSecret: string;
  loginHost: string;
  isSandbox: boolean;
  verifier: string;
  createdAt: number;
}

/** Transient PKCE state. In-flight OAuth only — losing it just restarts the wizard. */
const pending = new Map<string, PendingOAuth>();

function b64url(buf: Buffer): string {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

const SfdcStartBody = z.object({
  name: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  is_sandbox: z.boolean().default(false),
});

const GenericBody = z.object({
  name: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
  connection_type: z.enum(["MYSQL", "POSTGRESQL", "SQLSERVER", "SNOWFLAKE", "REDSHIFT", "HTTP", "SQLDW", "DATABRICKS"]),
  comment: z.string().default(""),
  options: z.record(z.string(), z.string()),
});

const IngestionBody = z.object({
  connection_name: z.string().min(1),
  source_system: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
  destination_catalog: z.string().default("workspace"),
  destination_schema: z.string().default("bronze"),
  /** SaaS connectors expose objects under a fixed source schema (Salesforce: "objects") */
  source_schema: z.string().default("objects"),
  tables: z.array(z.object({ source_object: z.string().min(1) })).min(1),
});

export function registerConnectionRoutes(app: FastifyInstance, dbx: DbxClient, cfg: AppConfig): void {
  /** Public base URL of this app, derived from the proxied request. */
  const appUrl = (req: { headers: Record<string, unknown> }) => {
    const host = (req.headers["x-forwarded-host"] as string) ?? (req.headers.host as string) ?? "";
    return `https://${host}`;
  };

  /**
   * The app SP owns connections it creates, so a human browsing Unity Catalog
   * can't see them. Grant the runner/owner principal full privileges so the
   * connection is visible in the UC UI AND usable by ingestion pipelines that
   * run as that principal. Best-effort: a grant failure never blocks creation.
   */
  const shareConnection = async (name: string): Promise<void> => {
    if (!cfg.PF_RUNNER_PRINCIPAL || !cfg.DATABRICKS_WAREHOUSE_ID) return;
    try {
      await dbx.sql(
        `GRANT ALL PRIVILEGES ON CONNECTION \`${name}\` TO \`${cfg.PF_RUNNER_PRINCIPAL}\``,
        cfg.DATABRICKS_WAREHOUSE_ID,
      );
    } catch (err) {
      app.log.warn({ err }, `connection grant to ${cfg.PF_RUNNER_PRINCIPAL} failed`);
    }
  };

  app.get("/api/connections", async () => {
    const r = await dbx.connectionsList();
    return {
      connections: (r.connections ?? []).map((c) => ({
        name: c.name,
        type: c.connection_type,
        comment: c.comment ?? "",
      })),
    };
  });

  app.delete("/api/connections/:name", async (req) => {
    const { name } = req.params as { name: string };
    await dbx.connectionDelete(name);
    return { deleted: name };
  });

  /** Generic connections: credentials straight into UC connection options. */
  app.post("/api/connections/generic", async (req, reply) => {
    const body = GenericBody.parse(req.body);
    try {
      await dbx.connectionCreate({
        name: body.name,
        connection_type: body.connection_type,
        comment: body.comment || `created by pipeline_factory`,
        options: body.options,
      });
      await shareConnection(body.name);
      return reply.code(201).send({ created: body.name });
    } catch (err) {
      return reply.code(422).send({ error: String(err).slice(0, 600) });
    }
  });

  /**
   * Salesforce OAuth step 1: app generates the authorize URL (PKCE) pointing
   * back at its own /callback. The user's browser does the consent.
   */
  app.post("/api/connections/sfdc/start", async (req) => {
    const body = SfdcStartBody.parse(req.body);
    const state = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(48));
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    const loginHost = body.is_sandbox ? "test.salesforce.com" : "login.salesforce.com";
    pending.set(state, {
      name: body.name,
      clientId: body.client_id,
      clientSecret: body.client_secret,
      loginHost,
      isSandbox: body.is_sandbox,
      verifier,
      createdAt: Date.now(),
    });
    // GC stale attempts
    for (const [k, v] of pending) if (Date.now() - v.createdAt > 15 * 60_000) pending.delete(k);

    const redirect = `${appUrl(req)}/api/connections/sfdc/callback`;
    const authorizeUrl =
      `https://${loginHost}/services/oauth2/authorize?response_type=code` +
      `&client_id=${encodeURIComponent(body.client_id)}` +
      `&redirect_uri=${encodeURIComponent(redirect)}` +
      `&code_challenge=${challenge}&code_challenge_method=S256` +
      `&scope=${encodeURIComponent("api refresh_token")}` +
      `&state=${state}`;
    return { authorize_url: authorizeUrl, redirect_uri: redirect, state };
  });

  /** Salesforce OAuth step 2: exchange code, create the UC connection. */
  app.get("/api/connections/sfdc/callback", async (req, reply) => {
    const { code, state, error, error_description } = req.query as Record<string, string | undefined>;
    const fail = (msg: string) =>
      reply.redirect(`/?connect_error=${encodeURIComponent(msg.slice(0, 300))}#settings`);
    if (error) return fail(`${error}: ${error_description ?? ""}`);
    if (!code || !state) return fail("missing code/state");
    const p = pending.get(state);
    if (!p) return fail("OAuth state expired — restart the wizard");
    pending.delete(state);

    const tokenRes = await fetch(`https://${p.loginHost}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: p.clientId,
        client_secret: p.clientSecret,
        redirect_uri: `${appUrl(req)}/api/connections/sfdc/callback`,
        code_verifier: p.verifier,
      }),
    });
    const token = (await tokenRes.json()) as {
      refresh_token?: string;
      instance_url?: string;
      error?: string;
      error_description?: string;
    };
    if (!tokenRes.ok || !token.refresh_token) {
      return fail(`token exchange failed: ${token.error ?? tokenRes.status} ${token.error_description ?? ""}`);
    }

    // Credentials must never be stripped — a connection without them is useless.
    const CREDENTIAL_KEYS = new Set(["client_id", "client_secret", "refresh_token", "oauth_refresh_token", "pkce_verifier"]);
    const options: Record<string, string> = {
      client_id: p.clientId,
      client_secret: p.clientSecret,
      refresh_token: token.refresh_token,
      oauth_refresh_token: token.refresh_token,
      instance_url: token.instance_url ?? "",
      is_sandbox: String(p.isSandbox),
    };
    // The connector's supported option set varies by version. Strip ONLY
    // rejected non-credential options and retry; a rejected credential is fatal
    // (surface the connector's "Supported options: …" so we use the right keys).
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await dbx.connectionCreate({
          name: p.name,
          connection_type: "SALESFORCE",
          comment: "created by pipeline_factory (OAuth via app)",
          options,
        });
        break;
      } catch (err) {
        const msg = String(err);
        const m = /does not support the following option\(s\): ([^.]+?)\./.exec(msg);
        const rejected = m?.[1]?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
        const strippable = rejected.filter((k) => !CREDENTIAL_KEYS.has(k) && k in options);
        if (strippable.length > 0 && attempt < 3) {
          for (const key of strippable) delete options[key];
          continue;
        }
        return fail(`UC connection create failed: ${msg.slice(0, 400)}`);
      }
    }
    await shareConnection(p.name);
    return reply.redirect(`/?connected=${encodeURIComponent(p.name)}#settings`);
  });

  /**
   * One-click ingestion: managed Lakeflow Connect pipeline pulling ALL listed
   * objects through the connection into bronze — the source's single batch.
   */
  app.post("/api/ingestion", async (req, reply) => {
    const body = IngestionBody.parse(req.body);
    const name = `brnz_${body.source_system}_batch`;
    try {
      const { pipeline_id } = await dbx.pipelineCreate({
        name,
        serverless: true,
        continuous: false,
        catalog: body.destination_catalog,
        schema: body.destination_schema,
        ingestion_definition: {
          connection_name: body.connection_name,
          objects: body.tables.map((t) => ({
            table: {
              source_schema: body.source_schema,
              source_table: t.source_object,
              destination_catalog: body.destination_catalog,
              destination_schema: body.destination_schema,
              destination_table: `${body.source_system}_${t.source_object.toLowerCase()}`,
            },
          })),
        },
      });
      const { update_id } = await dbx.pipelineStartUpdate(pipeline_id);
      return reply.code(201).send({ pipeline_id, update_id, name });
    } catch (err) {
      return reply.code(422).send({ error: String(err).slice(0, 800) });
    }
  });

  app.get("/api/ingestion/:pipelineId", async (req) => {
    const { pipelineId } = req.params as { pipelineId: string };
    const p = await dbx.pipelineGet(pipelineId);
    return { name: p.name, state: p.state, latest: p.latest_updates?.[0] ?? null };
  });

  void cfg;
}
