import { z } from "zod";

/**
 * The mapping spec — the ONLY artifact the LLM may produce (hard constraint #1).
 * Files are rendered deterministically from this; LLM-authored SQL lives inside
 * `transform` values, never in files.
 *
 * Derived from handoff v2 §6 (v1 pydantic models not available — see ADR-005).
 */

export const ConfidenceSchema = z.number().min(0).max(1);

export const ValueMapEntrySchema = z.object({
  from: z.string(),
  to: z.string(),
});

export const CompareSchema = z.object({
  /** include this column in reconciliation compare */
  enabled: z.boolean().default(true),
  /** SQL expression applied to both sides before compare (normalization) */
  normalize: z.string().nullable().default(null),
  /** numeric tolerance for float compares */
  tolerance: z.number().nullable().default(null),
});

export const ColumnMappingSchema = z.object({
  /** source column name, exactly as in the contract */
  name: z.string().min(1),
  /** target column name */
  target: z.string().min(1),
  /** target data type (Databricks SQL type) */
  type: z.string().min(1),
  /**
   * SQL expression producing the target value; references source columns.
   * `null` means straight passthrough of `name`.
   */
  transform: z.string().nullable().default(null),
  /** enumerated value translation, applied when present (LLMs emit null for "none") */
  value_map: z
    .array(ValueMapEntrySchema)
    .nullish()
    .transform((v) => v ?? []),
  /** LLM confidence in this mapping, 0..1 */
  confidence: ConfidenceSchema,
  /** LLM's reasoning for the mapping */
  rationale: z
    .string()
    .nullish()
    .transform((v) => v ?? ""),
  /** personally identifiable — from the contract; drives UC column tags */
  pii: z
    .boolean()
    .nullish()
    .transform((v) => v ?? false),
  /** reconciliation behavior for this column */
  compare: CompareSchema.nullish().transform(
    (v) => v ?? { enabled: true, normalize: null, tolerance: null },
  ),
});

export const ExpectationSchema = z.object({
  name: z.string().min(1),
  /** SQL boolean expression (DLT expectation body) */
  constraint: z.string().min(1),
  action: z.enum(["warn", "drop", "fail"]).default("warn"),
});

export const IngestionSchema = z.object({
  /** transport plugin key; only lakeflow_connect implemented in MVP */
  transport: z.enum(["lakeflow_connect", "kafka_cdc"]).default("lakeflow_connect"),
  source_object: z.string().min(1),
  /** ingestion mode */
  mode: z.enum(["snapshot", "incremental", "cdc"]).default("snapshot"),
  /** cursor / watermark column for incremental */
  cursor_column: z.string().nullable().default(null),
});

/** Business key of the entity: source key column -> target key column.
 *  Drives connector primary_keys (SCD upserts) and reconciliation joins. */
export const PrimaryKeySchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
});

export const EndpointSchema = z.object({
  system: z.string().min(1),
  /** three-part table name (catalog.schema.table) */
  entity: z.string().min(1),
});

export const SpecSchema = z.object({
  spec_id: z.string().min(1),
  spec_version: z.number().int().min(1),
  /** human-readable entity name, e.g. contract_account */
  entity: z.string().min(1),
  source: EndpointSchema,
  target: EndpointSchema,
  ingestion: IngestionSchema,
  primary_keys: z.array(PrimaryKeySchema).min(1),
  columns: z.array(ColumnMappingSchema).min(1),
  expectations: z
    .array(ExpectationSchema)
    .nullish()
    .transform((v) => v ?? []),
  /** free-form evidence notes accumulated through the lifecycle */
  evidence: z.record(z.string(), z.unknown()).default({}),
});

export type Spec = z.infer<typeof SpecSchema>;

/**
 * LLM-facing spec schema: identical minus `evidence` (a free-form record the
 * server owns — records/$refs are unsupported by FMAPI structured outputs).
 */
export const SpecLlmSchema = SpecSchema.omit({ evidence: true });
export type SpecLlm = z.infer<typeof SpecLlmSchema>;
export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;
export type Expectation = z.infer<typeof ExpectationSchema>;

/**
 * Spec delta — the ONLY artifact the fix loop may produce (hard constraint #2).
 * A partial overlay merged onto the current spec, plus an audit reason.
 */
export const SpecDeltaSchema = z.object({
  reason: z.string().min(1),
  /** columns to replace, matched by `name` (LLMs emit null for "none") */
  columns: z
    .array(ColumnMappingSchema)
    .nullish()
    .transform((v) => v ?? []),
  /** expectations to replace, matched by `name` */
  expectations: z
    .array(ExpectationSchema)
    .nullish()
    .transform((v) => v ?? []),
});

export type SpecDelta = z.infer<typeof SpecDeltaSchema>;

/** Apply a fix-loop delta onto a spec, bumping the version. Pure. */
export function applyDelta(spec: Spec, delta: SpecDelta): Spec {
  const columns = spec.columns.map((c) => {
    const patch = delta.columns.find((d) => d.name === c.name);
    return patch ?? c;
  });
  const existing = new Set(spec.expectations.map((e) => e.name));
  const expectations = [
    ...spec.expectations.map((e) => delta.expectations.find((d) => d.name === e.name) ?? e),
    ...delta.expectations.filter((d) => !existing.has(d.name)),
  ];
  return {
    ...spec,
    spec_version: spec.spec_version + 1,
    columns,
    expectations,
    evidence: {
      ...spec.evidence,
      [`fix_v${spec.spec_version + 1}`]: delta.reason,
    },
  };
}

/** Spec statuses through the lifecycle. */
export const SpecStatusSchema = z.enum([
  "draft",
  "generated",
  "approved",
  "building",
  "pr_open",
  "needs_human",
  "done",
]);
export type SpecStatus = z.infer<typeof SpecStatusSchema>;
