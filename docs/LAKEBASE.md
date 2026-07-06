# Lakebase operational store (ADR-007)

The app's operational state (specs, versions, build runs, LLM calls, contracts)
lives in **Lakebase Postgres** — autoscaling project `pipeline-factory`, schema
`pipeline_factory`, database `databricks_postgres`. Delta `workspace.ctl` remains
the data plane (dataflow_spec, staged_artifacts, recon_*). Recon results sync
back into Postgres as read-only **synced tables** for the dashboard.

## Provisioning (one-time, admin)

```bash
# 1. project (auto-creates production branch + primary endpoint, scale-to-zero)
databricks postgres create-project pipeline-factory \
  --json '{"spec": {"display_name": "Pipeline Factory operational store"}}'

# 2. attach to the app — the bundle declares the resource (databricks.yml):
#    resources.apps.pipeline_factory.resources: name=postgres, postgres.branch/database,
#    permission CAN_CONNECT_AND_CREATE
databricks bundle deploy -t dev && databricks bundle run pipeline_factory
# DEPLOY FIRST: the app SP must create (and therefore own) the pipeline_factory pg schema.

# 3. synced tables for the recon dashboard
bash scripts/create-synced-tables.sh
```

## How the server connects

`@databricks/lakebase` `createLakebasePool()` — reads the injected `PGHOST`,
`PGDATABASE`, `LAKEBASE_ENDPOINT` env vars and refreshes the OAuth pg password
automatically (1 h tokens). See `app/server/src/lib/store/pg-store.ts`.

- `PF_PG_ENABLED=true` (default) + `PGHOST` present → PgStore; boot runs the pg
  DDL migration and a one-time backfill from the warehouse registry.
- Otherwise → WarehouseStore fallback; every route stays functional.

## Synced tables (read-only in pg)

| pg (schema `recon`) | source Delta | PKs | mode |
|---|---|---|---|
| recon_runs | workspace.ctl.recon_runs | recon_id | TRIGGERED |
| recon_entity_result | workspace.ctl.recon_entity_result | recon_id, entity | TRIGGERED |
| recon_record_diff | workspace.ctl.recon_record_diff | recon_id, entity, key_value, column_name | TRIGGERED |

TRIGGERED mode requires CDF on the sources (set in `registryDdl`). Refresh runs
on the managed sync pipeline; the recon dashboard reads pg (`recon.*` tables)
with a warehouse fallback.

After the app SP exists and synced tables are ONLINE, grant it read (run as the
project owner via `databricks psql --project pipeline-factory`):

```sql
GRANT USAGE ON SCHEMA recon TO "38ec922f-43ac-4263-b795-4f3c508b97f8";
GRANT SELECT ON ALL TABLES IN SCHEMA recon TO "38ec922f-43ac-4263-b795-4f3c508b97f8";
ALTER DEFAULT PRIVILEGES IN SCHEMA recon GRANT SELECT ON TABLES TO "38ec922f-43ac-4263-b795-4f3c508b97f8";
```

## Gotchas

- Scale-to-zero wake ≈ seconds — the pool retries; first request after idle is slower.
- Synced tables are read-only in pg (writes break the sync pipeline).
- `new_pipeline_spec.storage_catalog` must be a REGULAR UC catalog (`workspace`),
  never the Lakebase catalog (`pf_lakebase`).
- Tokens expire hourly — handled by @databricks/lakebase; do not cache pg passwords.
