import { registryDdl, type RegistryConfig } from "@pf/core";
import type { DbxClient } from "@pf/dbx";

/** Boot-time idempotent registry migration (hard constraint #6). */
export async function migrateRegistry(
  dbx: DbxClient,
  warehouseId: string,
  cfg: RegistryConfig,
): Promise<void> {
  for (const stmt of registryDdl(cfg)) {
    await dbx.sql(stmt, warehouseId);
  }
}
