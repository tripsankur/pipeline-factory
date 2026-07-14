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

  /**
   * Schema discovery (contract v1.1, ask #10): fetch the TRUE field list from
   * the source so the Interface Contract reflects reality (e.g. 68 Account
   * fields, not a hand-typed 6). Server-side describe via secret-scope creds
   * (~2s); ingestion itself stays with Lakeflow Connect (ADR-009).
   */
  app.post("/api/connections/:name/discover", async (req, reply) => {
    const { name } = req.params as { name: string };
    const body = z.object({ objects: z.array(z.string().min(1)).min(1).max(50) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid body", detail: body.error.issues });
    try {
      const { sfdcDescribe } = await import("../lib/sfdc-describe.js");
      const result = await sfdcDescribe(dbx, cfg.PF_SECRET_SCOPE, name, body.data.objects);
      return {
        connection: name,
        discovered_at: new Date().toISOString(),
        rotated_refresh_token: result.rotated,
        objects: result.objects,
      };
    } catch (err) {
      return reply.code(502).send({
        error: `schema discovery failed: ${String(err).slice(0, 300)}`,
        fallback: "verify secret-scope credentials (scripts/demo/sf_auth.py --check) and retry",
      });
    }
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

    // Store the OAuth credentials in a Databricks SECRET SCOPE (constraint #4:
    // no plaintext creds in connection options, code, or app state beyond
    // transit). The ingestion runner reads them from the scope at run time.
    // Databricks' managed SALESFORCE connector silently drops injected OAuth
    // fields (it wants Databricks-UI OAuth), so the secret scope is the store.
    try {
      await dbx.secretScopeEnsure(cfg.PF_SECRET_SCOPE);
      const prefix = `sfdc_${p.name}`;
      await dbx.secretPut(cfg.PF_SECRET_SCOPE, `${prefix}_client_id`, p.clientId);
      await dbx.secretPut(cfg.PF_SECRET_SCOPE, `${prefix}_client_secret`, p.clientSecret);
      await dbx.secretPut(cfg.PF_SECRET_SCOPE, `${prefix}_refresh_token`, token.refresh_token);
      await dbx.secretPut(cfg.PF_SECRET_SCOPE, `${prefix}_instance_url`, token.instance_url ?? "");
      await dbx.secretPut(cfg.PF_SECRET_SCOPE, `${prefix}_login_host`, p.loginHost);
    } catch (err) {
      return fail(`storing credentials in secret scope failed: ${String(err).slice(0, 250)}`);
    }
    // Register the source as a lightweight UC connection for discoverability
    // (metadata only — no creds). Best-effort.
    try {
      await dbx.connectionCreate({
        name: p.name,
        connection_type: "SALESFORCE",
        comment: `created by pipeline_factory · creds in secret scope ${cfg.PF_SECRET_SCOPE}`,
        options: { is_sandbox: String(p.isSandbox) },
      });
      await shareConnection(p.name);
    } catch {
      // connection is optional metadata; secrets are the source of truth
    }
    return reply.redirect(`/?connected=${encodeURIComponent(p.name)}#settings`);
  });

  /**
   * One-click ingestion: managed Lakeflow Connect pipeline pulling ALL listed
   * objects through the connection into bronze — the source's single batch.
   */
  /** Ad-hoc ingestion: ALWAYS a managed Lakeflow Connect ingestion pipeline
   *  (ADR-009 — Databricks-standard primitives; the old REST runner path is
   *  retired). Requires a working UC connection (for Salesforce that means the
   *  one-time OAuth U2M consent in Catalog Explorer). */
  app.post("/api/ingestion", async (req, reply) => {
    const body = IngestionBody.parse(req.body);
    const name = `brnz_${body.source_system}_ingest`;
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
        tags: { generated_by: "pipeline_factory" },
      });
      const { update_id } = await dbx.pipelineStartUpdate(pipeline_id);
      return reply.code(201).send({ mode: "pipeline", pipeline_id, update_id, name });
    } catch (err) {
      return reply.code(422).send({ error: String(err).slice(0, 800) });
    }
  });

  /** Ingestion pipeline status. */
  app.get("/api/ingestion/:id", async (req) => {
    const { id } = req.params as { id: string };
    const p = await dbx.pipelineGet(id);
    return { mode: "pipeline", name: p.name, state: p.state, latest: p.latest_updates?.[0] ?? null };
  });
}
