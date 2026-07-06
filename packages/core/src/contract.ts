import { z } from "zod";

/**
 * Interface Contract v1 — the defined intake format for Pipeline Factory.
 *
 * A contract describes ONE source system and ALL tables to pull from it
 * (matching the one-batch-per-source ingestion standard). Mandatory sections:
 * identity, ownership, connectivity for dev AND prod, and fully-typed table
 * schemas with primary keys. Free-form CSV/DOCX intake still works, but a
 * structured contract removes guesswork from the LLM and the build.
 */

export const CONTRACT_FORMAT_VERSION = 1;

const slugField = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9_]*$/, "lowercase letters, digits, underscores; must start with a letter");

export const ContractEnvironmentSchema = z.object({
  /** hostname or IP of the source endpoint in this environment */
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  protocol: z.enum(["jdbc", "https", "sftp", "kafka", "odbc", "other"]),
  /** how the factory authenticates; credentials themselves NEVER appear here (constraint #4) */
  auth_method: z.enum(["oauth_m2m", "basic", "token", "kerberos", "certificate", "iam"]),
  /** Databricks secret scope holding the credentials for this environment */
  secret_scope: z.string().min(1),
  /** e.g. database name, base path, topic prefix */
  namespace: z.string().default(""),
  notes: z.string().default(""),
});

export const ContractColumnSchema = z.object({
  name: z.string().min(1),
  /** source-native type — MANDATORY (drives target typing and casts) */
  type: z.string().min(1),
  nullable: z.boolean().default(true),
  description: z.string().default(""),
  /** personally identifiable — surfaces in review and masks in evidence samples */
  pii: z.boolean().default(false),
  /** representative value, helps mapping confidence */
  sample: z.string().nullish().transform((v) => v ?? null),
  /** closed enumeration when applicable, e.g. ["A","I"] */
  enum_values: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
});

export const ContractTableSchema = z.object({
  name: slugField,
  /** source-native object/table name when it differs from the slug (e.g. Salesforce "Account") */
  source_object: z.string().optional(),
  description: z.string().default(""),
  /** MANDATORY: at least one primary-key column (drives crosswalk + recon keys) */
  primary_key: z.array(z.string().min(1)).min(1),
  /** override the contract default; snapshot|incremental ride the batch, cdc rides nrt */
  mode: z.enum(["snapshot", "incremental", "cdc"]).optional(),
  /** required when mode = incremental */
  cursor_column: z.string().nullish().transform((v) => v ?? null),
  expected_daily_rows: z.number().int().min(0).nullish().transform((v) => v ?? null),
  columns: z.array(ContractColumnSchema).min(1),
});

export const InterfaceContractSchema = z
  .object({
    contract: z.object({
      format_version: z.literal(CONTRACT_FORMAT_VERSION),
      id: z.string().min(1),
      name: z.string().min(1),
      version: z.number().int().min(1),
    }),
    source: z.object({
      system: slugField,
      kind: z.enum(["rdbms", "api", "file", "stream"]),
      owner_team: z.string().min(1),
      owner_email: z.string().email(),
    }),
    /** dev and prod are MANDATORY; others (uat, staging…) optional */
    connectivity: z
      .record(z.string(), ContractEnvironmentSchema)
      .refine((envs) => "dev" in envs && "prod" in envs, {
        message: "connectivity must define both 'dev' and 'prod' environments",
      }),
    ingestion: z.object({
      /** default mode for tables that don't override */
      default_mode: z.enum(["snapshot", "incremental", "cdc"]).default("snapshot"),
      /** cron schedule for the source's batch (quartz) — required for batch sources */
      batch_schedule: z.string().default("0 0 2 * * ?"),
      file_format: z.string().default(""),
    }),
    target: z
      .object({
        system: z.string().default(""),
        catalog: z.string().default("workspace"),
        bronze_schema: z.string().default("bronze"),
        silver_schema: z.string().default("silver"),
      })
      .default({ system: "", catalog: "workspace", bronze_schema: "bronze", silver_schema: "silver" }),
    tables: z.array(ContractTableSchema).min(1),
  })
  .superRefine((c, ctx) => {
    for (const [i, t] of c.tables.entries()) {
      const colNames = new Set(t.columns.map((col) => col.name));
      for (const pk of t.primary_key) {
        if (!colNames.has(pk)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["tables", i, "primary_key"],
            message: `primary_key column '${pk}' is not defined in table '${t.name}' columns`,
          });
        }
      }
      const mode = t.mode ?? c.ingestion.default_mode;
      if (mode === "incremental" && !t.cursor_column) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tables", i, "cursor_column"],
          message: `table '${t.name}' is incremental and must declare cursor_column`,
        });
      }
      if (t.cursor_column && !colNames.has(t.cursor_column)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tables", i, "cursor_column"],
          message: `cursor_column '${t.cursor_column}' is not defined in table '${t.name}' columns`,
        });
      }
    }
  });

export type InterfaceContract = z.infer<typeof InterfaceContractSchema>;
export type ContractTable = z.infer<typeof ContractTableSchema>;

/** Compact contract fingerprint stored in spec.evidence for audit. */
export function contractAudit(c: InterfaceContract): Record<string, unknown> {
  return {
    contract_id: c.contract.id,
    contract_version: c.contract.version,
    source_system: c.source.system,
    owner: c.source.owner_email,
    environments: Object.keys(c.connectivity),
  };
}
