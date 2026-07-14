import type { DbxClient } from "@pf/dbx";

/**
 * Server-side Salesforce schema DISCOVERY (ask #10 / contract v1.1) — describe
 * only, never ingestion (ADR-009: ingestion belongs to Lakeflow Connect).
 * Credentials come from the Databricks secret scope the connect wizard wrote
 * (sfdc_{conn}_client_id / _client_secret / _refresh_token / _instance_url /
 * _login_host). ~2s interactive vs minutes for a job-based describe; the
 * credentials come from the secret scope; there is no job-based fallback.
 */

export interface DiscoveredField {
  name: string;
  type: string;
  nullable: boolean;
  length: number | null;
  picklist_values: string[];
  pii_hint: boolean;
  calculated: boolean;
  compound: boolean;
}

export interface DiscoveredObject {
  name: string;
  fields: DiscoveredField[];
}

const SKIP_TYPES = new Set(["address", "location", "base64", "complexvalue"]);
const PII_PATTERN = /(first|last|full)?name|email|phone|mobile|fax|street|address|city|postal|zip|birth|ssn|passport|salutation/i;

async function secret(dbx: DbxClient, scope: string, conn: string, suffix: string): Promise<string> {
  return dbx.secretGet(scope, `sfdc_${conn}_${suffix}`);
}

export async function sfdcDescribe(
  dbx: DbxClient,
  scope: string,
  conn: string,
  objects: string[],
): Promise<{ objects: DiscoveredObject[]; rotated: boolean }> {
  const [clientId, clientSecret, refreshToken] = await Promise.all([
    secret(dbx, scope, conn, "client_id"),
    secret(dbx, scope, conn, "client_secret"),
    secret(dbx, scope, conn, "refresh_token"),
  ]);
  const loginHost = (await secret(dbx, scope, conn, "login_host").catch(() => "")) || "login.salesforce.com";

  const tokenRes = await fetch(`https://${loginHost}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`Salesforce token grant failed (${tokenRes.status}): ${(await tokenRes.text()).slice(0, 300)}`);
  }
  const tok = (await tokenRes.json()) as { access_token: string; instance_url?: string; refresh_token?: string };
  const instanceUrl = tok.instance_url ?? (await secret(dbx, scope, conn, "instance_url"));

  // orgs may rotate the refresh token on every grant — persist it or the next
  // grant dies with invalid_grant (learned the hard way)
  let rotated = false;
  if (tok.refresh_token && tok.refresh_token !== refreshToken) {
    await dbx.secretPut(scope, `sfdc_${conn}_refresh_token`, tok.refresh_token);
    rotated = true;
  }

  const out: DiscoveredObject[] = [];
  for (const obj of objects) {
    const res = await fetch(`${instanceUrl}/services/data/v60.0/sobjects/${encodeURIComponent(obj)}/describe`, {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    if (!res.ok) {
      throw new Error(`describe ${obj} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const desc = (await res.json()) as {
      fields: { name: string; type?: string; nillable?: boolean; length?: number; calculated?: boolean; picklistValues?: { value: string; active: boolean }[] }[];
    };
    out.push({
      name: obj,
      fields: desc.fields.map((f) => ({
        name: f.name,
        type: f.type ?? "string",
        nullable: f.nillable ?? true,
        length: f.length ?? null,
        picklist_values: (f.picklistValues ?? []).filter((v) => v.active).map((v) => v.value),
        pii_hint: PII_PATTERN.test(f.name),
        calculated: f.calculated === true,
        compound: SKIP_TYPES.has(f.type ?? ""),
      })),
    });
  }
  return { objects: out, rotated };
}
