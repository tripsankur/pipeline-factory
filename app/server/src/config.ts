import { z } from "zod";

/** All runtime configuration in one validated place. Nothing secret lives in code. */
const EnvSchema = z.object({
  DATABRICKS_APP_PORT: z.coerce.number().default(8000),
  DATABRICKS_HOST: z.string().min(1),
  DATABRICKS_WAREHOUSE_ID: z.string().min(1),
  // NOTE: Claude FMAPI endpoints exist in this workspace but are rate-limited to 0
  // (trial workspace). Swap back via env when enabled — endpoint is config, not code.
  PF_LLM_ENDPOINT: z.string().default("databricks-llama-4-maverick"),
  PF_CATALOG: z.string().default("workspace"),
  PF_SCHEMA: z.string().default("ctl"),
  PF_GITHUB_REPO: z.string().default(""),
  /** Databricks secret scope for source credentials (constraint #4) */
  PF_SECRET_SCOPE: z.string().default("pipeline_factory"),
  /** job id of the Salesforce REST ingestion runner (injected via app resource) */
  PF_JOB_SFDC_INGEST: z.string().default(""),
  PF_TARGET: z.string().default("dev"),
  MAX_FIX_ITERATIONS: z.coerce.number().int().min(1).default(3),
  /** workspace path of the deployed framework engine files (ADR-008/009) */
  PF_FRAMEWORK_ENGINE_PATH: z
    .string()
    .default("/Workspace/Users/ankurtripathi.cs@gmail.com/.bundle/ingestion-framework/dev/files/engine"),
  /** framework recon job name suffix (resolved to a job id at first use) */
  PF_FRAMEWORK_RECON_JOB_NAME: z.string().default("pf-framework-recon"),
  /** engine version floor written into every dataflow_spec row */
  PF_FRAMEWORK_MIN_VERSION: z.string().default("1.0.0"),
  /** DEPRECATED (superseded by framework jobs; removed in Phase 7) */
  PF_JOB_PIPELINE_RUNNER: z.string().default(""),
  PF_JOB_RECON_RUNNER: z.string().default(""),
  /**
   * Principal the runner jobs execute as (bundle deployer in dev mode). When set,
   * the boot migration grants it SELECT+MODIFY on the registry tables the app SP
   * owns — runners must read staged artifacts and write results (ADR-006).
   */
  PF_RUNNER_PRINCIPAL: z.string().default(""),
  /** recon thresholds — below either triggers the fix loop */
  PF_RECON_MIN_KEY: z.coerce.number().min(0).max(1).default(0.98),
  PF_RECON_MIN_ATTR: z.coerce.number().min(0).max(1).default(0.98),
  /** local-dev identity stub when Apps forwarded headers are absent */
  PF_DEV_USER_EMAIL: z.string().default(""),
  /** Lakebase operational store (ADR-007): "true" + injected PGHOST → PgStore,
   *  anything else → warehouse fallback */
  PF_PG_ENABLED: z.string().default("true"),
  PGHOST: z.string().default(""),
});

export type AppConfig = z.infer<typeof EnvSchema> & {
  registry: { catalog: string; schema: string };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  // Hard constraint #3: the app never deploys to prod. No config may name it.
  if (parsed.PF_TARGET !== "dev") {
    throw new Error(
      `PF_TARGET must be "dev" — the app never deploys beyond dev (got "${parsed.PF_TARGET}"). Prod promotion belongs to CI.`,
    );
  }
  return {
    ...parsed,
    registry: { catalog: parsed.PF_CATALOG, schema: parsed.PF_SCHEMA },
  };
}
