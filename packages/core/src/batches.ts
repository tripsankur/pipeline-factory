import type { Spec } from "./spec.js";

/**
 * Ingestion batches — industry-standard grouping and naming for the bronze layer.
 *
 * Rules:
 * - ONE batch per source system: every table pulled from a source rides the same
 *   scheduled batch (`brnz_{source}_batch`). CDC-mode entities ride the source's
 *   near-real-time flow group instead (`brnz_{source}_nrt`).
 * - Flow naming: `{layer}_{source}_{entity}_{mode}` — e.g. brnz_aldm_contract_account_batch.
 * - Modes: snapshot | incremental → `batch` (scheduled bulk); cdc → `nrt`.
 */

export type IngestMode = "batch" | "nrt";

export function ingestMode(spec: Spec): IngestMode {
  return spec.ingestion.mode === "cdc" ? "nrt" : "batch";
}

export function batchId(sourceSystem: string, mode: IngestMode): string {
  return `brnz_${slug(sourceSystem)}_${mode}`;
}

export function flowName(spec: Spec): string {
  return `brnz_${slug(spec.source.system)}_${slug(spec.entity)}_${ingestMode(spec)}`;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export interface BatchFlow {
  flow: string;
  entity: string;
  spec_id: string;
  spec_version: number;
  source_object: string;
  destination: string;
  ingestion_mode: Spec["ingestion"]["mode"];
  cursor_column: string | null;
}

export interface IngestionBatch {
  batch_id: string;
  source_system: string;
  /** batch = scheduled bulk; nrt = near-real-time (cdc/streaming) */
  mode: IngestMode;
  transport: string;
  flows: BatchFlow[];
}

/** Group specs into per-source ingestion batches (one batch per source per mode). */
export function deriveBatches(specs: Spec[]): IngestionBatch[] {
  const map = new Map<string, IngestionBatch>();
  for (const spec of specs) {
    const mode = ingestMode(spec);
    const id = batchId(spec.source.system, mode);
    let batch = map.get(id);
    if (!batch) {
      batch = {
        batch_id: id,
        source_system: spec.source.system,
        mode,
        transport: spec.ingestion.transport,
        flows: [],
      };
      map.set(id, batch);
    }
    batch.flows.push({
      flow: flowName(spec),
      entity: spec.entity,
      spec_id: spec.spec_id,
      spec_version: spec.spec_version,
      source_object: spec.ingestion.source_object,
      destination: spec.source.entity,
      ingestion_mode: spec.ingestion.mode,
      cursor_column: spec.ingestion.cursor_column,
    });
  }
  for (const b of map.values()) {
    b.flows.sort((x, y) => x.entity.localeCompare(y.entity));
  }
  return [...map.values()].sort((x, y) => x.batch_id.localeCompare(y.batch_id));
}
