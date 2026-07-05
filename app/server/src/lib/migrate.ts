import { registryDdl, type RegistryConfig } from "@pf/core";
import type { DbxClient } from "@pf/dbx";

/**
 * Boot-time idempotent registry migration (hard constraint #6).
 *
 * The app SP typically has privileges on the pre-provisioned {catalog}.{schema}
 * but NOT `CREATE SCHEMA` on the catalog. `CREATE SCHEMA IF NOT EXISTS` checks
 * the privilege even when the schema exists, so a permission denial on that
 * first statement is tolerated as long as the schema is actually reachable.
 */
export async function migrateRegistry(
  dbx: DbxClient,
  warehouseId: string,
  cfg: RegistryConfig,
  runnerPrincipal = "",
): Promise<void> {
  const [schemaStmt, ...tableStmts] = registryDdl(cfg);
  try {
    await dbx.sql(schemaStmt!, warehouseId);
  } catch (err) {
    const rows = await dbx.sqlRows(
      `SELECT schema_name FROM \`${cfg.catalog}\`.information_schema.schemata WHERE schema_name = '${cfg.schema}'`,
      warehouseId,
    );
    if (rows.length === 0) {
      throw new Error(
        `Registry schema ${cfg.catalog}.${cfg.schema} does not exist and the app cannot create it. ` +
          `Provision it as an admin: CREATE SCHEMA ${cfg.catalog}.${cfg.schema}; ` +
          `GRANT ALL PRIVILEGES ON SCHEMA ${cfg.catalog}.${cfg.schema} TO <app-sp>. Underlying: ${String(err)}`,
      );
    }
  }
  for (const stmt of tableStmts) {
    await dbx.sql(stmt, warehouseId);
  }

  // Runner jobs execute as a different principal than the app SP. Grant that
  // principal read/write on the registry tables this SP owns (ADR-006). Grants
  // on tables the SP does NOT own fail harmlessly — those tables are already
  // accessible to their owner, which in dev is the runner principal itself.
  if (runnerPrincipal) {
    const tableNames = tableStmts
      .map((s) => /IF NOT EXISTS [^ ]*`([a-z_]+)`/.exec(s)?.[1])
      .filter((n): n is string => Boolean(n));
    for (const table of tableNames) {
      try {
        await dbx.sql(
          `GRANT SELECT, MODIFY ON TABLE \`${cfg.catalog}\`.\`${cfg.schema}\`.\`${table}\` TO \`${runnerPrincipal}\``,
          warehouseId,
        );
      } catch {
        // not the owner of this table — grant not needed from this principal
      }
    }
  }
}
