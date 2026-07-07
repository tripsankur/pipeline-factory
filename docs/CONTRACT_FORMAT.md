# Interface Contract v1 — the defined intake format

One contract file describes **one source system and all tables pulled from it** — matching
the ingestion standard of one `brnz_{source}_batch` per source. Upload as `.yaml` (or
`.json`) on the Contract intake screen; the factory validates it field-by-field and
returns exact error paths on violations. Template: `templates/interface_contract.template.yaml`.
Filled example: `examples/aldm.contract.yaml`. Machine schema: `packages/core/src/contract.ts`.

## Mandatory fields

| Section | Field | Rule |
|---|---|---|
| `contract` | `format_version` | literal `1` |
| | `id`, `name`, `version` | non-empty; bump `version` on every change |
| `source` | `system` | slug (`[a-z][a-z0-9_]*`) — becomes `brnz_{system}_batch` |
| | `kind` | `rdbms \| api \| file \| stream` |
| | `owner_team`, `owner_email` | non-empty; valid email |
| `connectivity` | `dev` **and** `prod` | both environments REQUIRED (uat etc. optional) |
| | per env: `host` | hostname or IP |
| | `port` | 1–65535 |
| | `protocol` | `jdbc \| https \| sftp \| kafka \| odbc \| other` |
| | `auth_method` | `oauth_m2m \| basic \| token \| kerberos \| certificate \| iam` |
| | `secret_scope` | Databricks secret scope holding credentials — **credentials never appear in the contract** |
| `ingestion` | `default_mode` | `snapshot \| incremental \| cdc` |
| | `batch_schedule` | quartz cron for the source's single batch |
| `tables[]` (≥1) | `name` | slug |
| | `primary_key` | ≥1 column, each must exist in `columns` (drives crosswalk + recon keys) |
| | `cursor_column` | REQUIRED when mode `incremental`; must exist in `columns` |
| | `columns[]` (≥1): `name`, `type` | `type` is the source-native type — mandatory, drives casts |

Optional per column: `nullable`, `description`, `pii` (surfaces in review, masked in
evidence samples), `sample`, `enum_values` (closed enumerations → value maps).
Optional per table: `description`, `mode` override, `expected_daily_rows` (sizing).
Optional `target` hints: `system`, `catalog`, `bronze_schema`, `silver_schema`.

## What the factory does with it

- **Validation first**: zod schema with cross-field checks (PK ⊆ columns, incremental ⇒
  cursor, dev+prod present). Uploads failing validation are rejected with field paths.
- **Multi-table intake**: each table becomes a spec candidate with prefilled bronze/silver
  names (`{catalog}.{bronze_schema}.{system}_{table}`), one-click Generate per table.
- **Authoritative facts**: table `mode` and `cursor_column` from the contract override
  whatever the LLM proposes; typed columns + enums + PII flags sharpen mapping confidence.
- **Audit**: a contract fingerprint (id, version, owner, environments) is stored in each
  generated spec's `evidence.contract` — every pipeline traces back to its contract.
- **Connectivity**: environment endpoints and secret-scope names surface on intake for
  review; ingestion jobs resolve credentials from the named scopes at run time
  (constraint #4 — no secrets in code, spec, or git).

## v1.1 — schema discovery + column selection

`format_version: 1.1` adds two backward-compatible fields (v1 contracts still parse;
everything defaults to v1 behavior):

- **`selected`** (per column, default `true`) — whether the column is ingested. Discovered
  contracts list ALL source fields; the reviewer prunes by setting `selected: false`.
  Validation: primary-key columns must stay selected; every table needs ≥1 selected column.
  Only selected columns flow into spec generation, `include_columns` of the managed
  ingestion pipeline, and the engine's `select_columns`.
- **`schema_source`** (per table, `declared` | `discovered`, default `declared`) — how the
  column list was produced. `discovered` means it came from the live source (Intake →
  **Discover source schema** pulls the true field list via
  `POST /api/connections/{name}/discover` and exports contract-ready YAML).

Why: hand-typed column subsets drift from reality (a real Salesforce Account has ~68
queryable fields, not the 6 someone remembered). Discovery makes the contract the single
source of truth that actually matches the source.
