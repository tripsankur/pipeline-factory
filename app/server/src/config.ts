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
  PF_TARGET: z.string().default("dev"),
  MAX_FIX_ITERATIONS: z.coerce.number().int().min(1).default(3),
  /** local-dev identity stub when Apps forwarded headers are absent */
  PF_DEV_USER_EMAIL: z.string().default(""),
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
