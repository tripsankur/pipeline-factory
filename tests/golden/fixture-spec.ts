import { SpecSchema, type Spec } from "@pf/core";

/** Frozen fixture spec. Changing it (or any template) changes golden files —
 * that is a breaking change requiring explicit approval (ADR-001). */
export const goldenSpec: Spec = SpecSchema.parse({
  spec_id: "spec-golden-001",
  spec_version: 1,
  entity: "contract_account",
  source: { system: "aldm", entity: "workspace.bronze.aldm_contract_account" },
  target: { system: "salesforce_comms", entity: "workspace.silver.contract_account" },
  ingestion: {
    transport: "lakeflow_connect",
    source_object: "CONTRACT_ACCOUNT",
    mode: "incremental",
    cursor_column: "updated_ts",
  },
  crosswalk: {
    keys: [{ source: "account_id", target: "sf_account_id" }],
    table: "workspace.silver.crosswalk_account",
  },
  columns: [
    {
      name: "account_id",
      target: "sf_account_id",
      type: "STRING",
      confidence: 0.98,
      rationale: "exact key match via crosswalk",
    },
    {
      name: "status_cd",
      target: "status",
      type: "STRING",
      transform: "CASE WHEN src.`status_cd` = 'A' THEN 'Active' ELSE 'Inactive' END",
      value_map: [
        { from: "A", to: "Active" },
        { from: "I", to: "Inactive" },
      ],
      confidence: 0.72,
      rationale: "status enumeration from contract notes",
      compare: { enabled: true, normalize: "UPPER(value)", tolerance: null },
    },
    {
      name: "balance_amt",
      target: "balance",
      type: "DECIMAL(18,2)",
      transform: "CAST(src.`balance_amt` AS DECIMAL(18,2))",
      confidence: 0.9,
      rationale: "numeric cast, source is stringly-typed",
      compare: { enabled: true, normalize: null, tolerance: 0.01 },
    },
  ],
  expectations: [
    { name: "account_id_not_null", constraint: "sf_account_id IS NOT NULL", action: "fail" },
    { name: "balance_non_negative", constraint: "balance >= 0", action: "warn" },
  ],
  evidence: {},
});
