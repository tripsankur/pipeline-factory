import { TokenProvider, type DbxAuthConfig, authConfigFromEnv } from "./auth.js";

/** Thin typed Databricks REST client (fetch-based, no SDK dependency). */

export interface SqlStatementResult {
  statement_id: string;
  status: { state: string; error?: { message: string } };
  result?: { data_array?: string[][] };
  manifest?: { schema?: { columns?: { name: string }[] } };
}

export interface JobRunNowResponse {
  run_id: number;
}

export interface JobRunState {
  state: {
    life_cycle_state: string;
    result_state?: string;
    state_message?: string;
  };
  run_page_url?: string;
}

export class DbxClient {
  private readonly tokens: TokenProvider;
  readonly host: string;

  constructor(cfg?: DbxAuthConfig) {
    const resolved = cfg ?? authConfigFromEnv();
    this.host = resolved.host;
    this.tokens = new TokenProvider(resolved);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.tokens.getToken();
    const res = await fetch(`${this.host}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Databricks API ${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  // ---- SQL Statement Execution ----

  /**
   * Execute SQL and wait for the result. Uses hybrid polling: the API waits up
   * to 50s inline, then we poll GET until terminal state.
   */
  async sql(statement: string, warehouseId: string, timeoutMs = 120_000): Promise<SqlStatementResult> {
    let r = await this.request<SqlStatementResult>("POST", "/api/2.0/sql/statements", {
      statement,
      warehouse_id: warehouseId,
      wait_timeout: "50s",
      on_wait_timeout: "CONTINUE",
    });
    const deadline = Date.now() + timeoutMs;
    while (["PENDING", "RUNNING"].includes(r.status.state)) {
      if (Date.now() > deadline) {
        throw new Error(`SQL statement ${r.statement_id} timed out after ${timeoutMs}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
      r = await this.request<SqlStatementResult>("GET", `/api/2.0/sql/statements/${r.statement_id}`);
    }
    if (r.status.state !== "SUCCEEDED") {
      throw new Error(
        `SQL statement failed (${r.status.state}): ${r.status.error?.message ?? "unknown"}\n${statement.slice(0, 300)}`,
      );
    }
    return r;
  }

  /** Rows as objects keyed by column name. */
  async sqlRows(statement: string, warehouseId: string): Promise<Record<string, string | null>[]> {
    const r = await this.sql(statement, warehouseId);
    const cols = r.manifest?.schema?.columns?.map((c) => c.name) ?? [];
    return (r.result?.data_array ?? []).map((row) =>
      Object.fromEntries(cols.map((c, i) => [c, row[i] ?? null])),
    );
  }

  // ---- Jobs ----

  async jobRunNow(jobId: number, params?: Record<string, string>): Promise<JobRunNowResponse> {
    return this.request("POST", "/api/2.2/jobs/run-now", {
      job_id: jobId,
      ...(params ? { job_parameters: params } : {}),
    });
  }

  async jobGetRun(runId: number): Promise<JobRunState> {
    return this.request("GET", `/api/2.2/jobs/runs/get?run_id=${runId}`);
  }

  // ---- Files (UC volumes) ----

  async filePut(volumePath: string, content: string): Promise<void> {
    const token = await this.tokens.getToken();
    const res = await fetch(`${this.host}/api/2.0/fs/files${volumePath}?overwrite=true`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
      body: content,
    });
    if (!res.ok && res.status !== 204) {
      throw new Error(`file upload ${volumePath} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
  }

  // ---- Serving (raw invocation; the LLM adapter uses the OpenAI-compat route) ----

  async servingInvoke<T>(endpoint: string, payload: unknown): Promise<T> {
    return this.request("POST", `/serving-endpoints/${endpoint}/invocations`, payload);
  }

  async servingGet(endpoint: string): Promise<{ name: string; state?: { ready?: string } }> {
    return this.request("GET", `/api/2.0/serving-endpoints/${endpoint}`);
  }

  async currentUser(): Promise<{ userName: string }> {
    return this.request("GET", "/api/2.0/preview/scim/v2/Me");
  }
}
