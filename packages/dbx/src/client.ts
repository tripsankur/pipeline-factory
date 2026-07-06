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
  tasks?: { run_id: number }[];
}

export interface JobRunOutput {
  error?: string;
  error_trace?: string;
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

  /** Task-level output — the real error text for failed Python task runs. */
  async jobGetRunOutput(taskRunId: number): Promise<JobRunOutput> {
    return this.request("GET", `/api/2.2/jobs/runs/get-output?run_id=${taskRunId}`);
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

  // ---- Secrets ----

  async secretScopeEnsure(scope: string): Promise<void> {
    try {
      await this.request("POST", "/api/2.0/secrets/scopes/create", {
        scope,
        initial_manage_principal: "users",
      });
    } catch (err) {
      // already-exists is fine; anything else propagates
      if (!String(err).includes("RESOURCE_ALREADY_EXISTS")) throw err;
    }
  }

  async secretPut(scope: string, key: string, value: string): Promise<void> {
    await this.request("POST", "/api/2.0/secrets/put", { scope, key, string_value: value });
  }

  // ---- Unity Catalog connections ----

  async connectionsList(): Promise<{ connections?: { name: string; connection_type: string; comment?: string; created_at?: number }[] }> {
    return this.request("GET", "/api/2.1/unity-catalog/connections");
  }

  async connectionCreate(body: {
    name: string;
    connection_type: string;
    comment?: string;
    options: Record<string, string>;
  }): Promise<{ name: string }> {
    return this.request("POST", "/api/2.1/unity-catalog/connections", body);
  }

  async connectionDelete(name: string): Promise<void> {
    await this.request("DELETE", `/api/2.1/unity-catalog/connections/${encodeURIComponent(name)}`);
  }

  // ---- Pipelines (Lakeflow: managed ingestion + declarative ETL) ----

  async pipelineCreate(body: Record<string, unknown>): Promise<{ pipeline_id: string }> {
    return this.request("POST", "/api/2.0/pipelines", body);
  }

  async pipelineUpdate(pipelineId: string, body: Record<string, unknown>): Promise<void> {
    await this.request("PUT", `/api/2.0/pipelines/${pipelineId}`, { ...body, id: pipelineId });
  }

  async pipelineList(nameFilter?: string): Promise<{ statuses?: { pipeline_id: string; name: string; state?: string }[] }> {
    const q = nameFilter ? `?filter=${encodeURIComponent(`name LIKE '${nameFilter}'`)}` : "";
    return this.request("GET", `/api/2.0/pipelines${q}`);
  }

  async pipelineStartUpdate(pipelineId: string, opts?: { full_refresh?: boolean }): Promise<{ update_id: string }> {
    return this.request("POST", `/api/2.0/pipelines/${pipelineId}/updates`, opts ?? {});
  }

  async pipelineGetUpdate(pipelineId: string, updateId: string): Promise<{ update?: { state: string } }> {
    return this.request("GET", `/api/2.0/pipelines/${pipelineId}/updates/${updateId}`);
  }

  async pipelineGet(pipelineId: string): Promise<{ state?: string; latest_updates?: { update_id: string; state: string }[]; name?: string }> {
    return this.request("GET", `/api/2.0/pipelines/${pipelineId}`);
  }

  /** Pipeline event log — DQ expectation metrics + errors live here. */
  async pipelineEvents(pipelineId: string, maxResults = 100): Promise<{ events?: { event_type?: string; level?: string; message?: string; details?: unknown; origin?: { flow_name?: string } }[] }> {
    return this.request("GET", `/api/2.0/pipelines/${pipelineId}/events?max_results=${maxResults}`);
  }

  // ---- Jobs management (workflow provisioning) ----

  async jobsList(name?: string): Promise<{ jobs?: { job_id: number; settings?: { name?: string } }[] }> {
    const q = name ? `?name=${encodeURIComponent(name)}` : "";
    return this.request("GET", `/api/2.2/jobs/list${q}`);
  }

  async jobCreate(settings: Record<string, unknown>): Promise<{ job_id: number }> {
    return this.request("POST", "/api/2.2/jobs/create", settings);
  }

  /** Overwrite all settings of an existing job (idempotent provisioning). */
  async jobReset(jobId: number, settings: Record<string, unknown>): Promise<void> {
    await this.request("POST", "/api/2.2/jobs/reset", { job_id: jobId, new_settings: settings });
  }

  /** Read one secret (app SP needs READ on the scope). Value is base64. */
  async secretGet(scope: string, key: string): Promise<string> {
    const r = await this.request<{ value?: string }>(
      "GET",
      `/api/2.0/secrets/get?scope=${encodeURIComponent(scope)}&key=${encodeURIComponent(key)}`,
    );
    return Buffer.from(r.value ?? "", "base64").toString("utf8");
  }
}
