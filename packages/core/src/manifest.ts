import { evidencePath, type RenderedFile } from "./renderer.js";
import type { Spec } from "./spec.js";

/**
 * factory.manifest.yml — the CI/CD integration contract (ADR-003, amended by
 * ADR-008). v2: artifacts are METADATA files; promotion = apply the metadata
 * (MERGE the dataflow row / deploy the thin resources yml) — never code.
 * Schema changes are public-API changes: bump `manifest_version`.
 */
export function buildManifest(spec: Spec, files: RenderedFile[]): string {
  const lines: string[] = [
    "# factory.manifest.yml — Pipeline Factory CI/CD contract (see docs/CICD_CONTRACT.md)",
    "manifest_version: 2",
    `generated_by: pipeline_factory`,
    `spec_id: ${spec.spec_id}`,
    `spec_version: ${spec.spec_version}`,
    `entity: ${spec.entity}`,
    "artifact_kind: metadata # ADR-008 — no generated code; engine lives in databricks-ingestion-framework",
    "artifacts:",
  ];
  for (const f of files) {
    lines.push(`  - path: ${f.path}`);
    lines.push(`    sha256: ${f.sha256}`);
  }
  lines.push(
    "spec_table: ctl.dataflow_spec # rows MERGEd by the factory; tombstoned, never deleted (ADR-010)",
    "commands:",
    "  verify: make verify",
    "  deploy: databricks bundle deploy -t <target>",
    "evidence:",
    `  location: ${evidencePath(spec)}`,
  );
  return lines.join("\n") + "\n";
}
