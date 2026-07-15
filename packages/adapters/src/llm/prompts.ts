import type { ParsedContract } from "../contracts/types.js";

/**
 * Prompt files for contract -> spec generation. Written fresh for v2 (the v1
 * §7 prompt files were not available — ADR-005).
 */

export const SPEC_SYSTEM_PROMPT = `You are a data-migration mapping engine inside "Pipeline Factory".
You convert interface contracts into a structured mapping spec for an ingestion pipeline
(Amdocs aLDM-style source to Salesforce Communications Cloud-style target, or similar).

Rules you must follow:
- Output ONLY the JSON object matching the provided schema. No prose.
- Every column in the contract must appear exactly once in "columns".
- "transform" is a Databricks SQL expression over the source row (alias "src"), or null for passthrough.
  Backtick-quote every column reference like src.\`col_name\`. Never invent columns.
- "confidence" is your honest 0..1 estimate that the mapping is correct. Use < 0.8 whenever you guessed
  semantics (enumerations, units, formats) rather than derived them from the contract text.
- "rationale" is one sentence a human reviewer reads to approve or fix the row. Be specific.
- value_map: only for enumerated code translations explicitly supported by the contract.
- expectations: propose null checks for key columns and range/enum checks the contract implies.
  Each "constraint" MUST be a complete boolean SQL predicate over TARGET column names
  (e.g. "sf_account_id IS NOT NULL", "balance >= 0") — never a fragment like "IS NOT NULL"
  and never source column names. "name" is a slug describing the check, not a column.
- Names are literal: use catalog/schema/table/column names exactly as given; never normalize
  hyphens/underscores or case.`;

export interface SpecPromptInput {
  contract: ParsedContract;
  sourceSystem: string;
  targetSystem: string;
  sourceEntity: string;
  targetEntity: string;
  specId: string;
}

export function buildSpecUserPrompt(input: SpecPromptInput): string {
  const cols = input.contract.columns
    .map((c) => {
      const parts = [c.name];
      if (c.type) parts.push(`type=${c.type}`);
      if (c.nullable !== undefined) parts.push(`nullable=${c.nullable}`);
      if (c.description) parts.push(`desc=${c.description}`);
      if (c.sample) parts.push(`sample=${c.sample}`);
      return `- ${parts.join(" | ")}`;
    })
    .join("\n");

  return `Interface contract for entity "${input.contract.entity}" (source kind: ${input.contract.sourceKind}).

Columns:
${cols}
${input.contract.narrative ? `\nContract narrative:\n${input.contract.narrative}\n` : ""}
Build the mapping spec with:
- spec_id: "${input.specId}"
- spec_version: 1
- entity: "${input.contract.entity}"
- source: { system: "${input.sourceSystem}", entity: "${input.sourceEntity}" }
- target: { system: "${input.targetSystem}", entity: "${input.targetEntity}" }
- ingestion: choose mode from the contract (default snapshot); transport "lakeflow_connect";
  source_object: the contract entity name in the source system's naming convention.
- primary_keys: the business-key column(s) of the entity, each mapped source -> target form (drives SCD upserts and reconciliation).
- columns: one entry per contract column, mapped to snake_case target names fitting the target system.
- expectations: null checks on keys plus constraints the contract implies.`;
}

export const FIX_SYSTEM_PROMPT = `You are the bounded fix loop of "Pipeline Factory".
A pipeline build or reconciliation failed. You receive the current spec and the failure evidence.
Produce ONLY a spec delta JSON matching the provided schema:
- "reason": one sentence root cause.
- "columns": ONLY the column mappings that must change, complete replacement entries.
  Always an array — use [] when no column changes, never null.
- "expectations": ONLY expectations to change or add. Always an array, never null.
Never propose file edits — files are rendered from the spec. If the failure cannot be fixed by
changing the spec, return an empty columns/expectations delta with reason explaining why a human is needed.`;

export function buildFixUserPrompt(specJson: string, failureEvidence: string): string {
  return `Current spec:\n${specJson}\n\nFailure evidence:\n${failureEvidence}\n\nProduce the minimal spec delta that fixes the root cause.`;
}
