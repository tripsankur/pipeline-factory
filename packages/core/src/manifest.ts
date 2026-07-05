import type { RenderedFile } from "./renderer.js";
import type { Spec } from "./spec.js";

/**
 * factory.manifest.yml — the CI/CD integration contract (ADR-003, handoff §4).
 * Any CI system integrates by reading this file and running the two commands.
 * Schema changes are public-API changes: bump `manifest_version`.
 */
export function buildManifest(spec: Spec, files: RenderedFile[]): string {
  const lines: string[] = [
    "# factory.manifest.yml — Pipeline Factory CI/CD contract (see docs/CICD_CONTRACT.md)",
    "manifest_version: 1",
    `generated_by: pipeline_factory`,
    `spec_id: ${spec.spec_id}`,
    `spec_version: ${spec.spec_version}`,
    `entity: ${spec.entity}`,
    "artifacts:",
  ];
  for (const f of files) {
    lines.push(`  - path: ${f.path}`);
    lines.push(`    sha256: ${f.sha256}`);
  }
  lines.push(
    "commands:",
    "  verify: make verify",
    "  deploy: databricks bundle deploy -t <target>",
    "evidence:",
    `  location: pipelines/${spec.entity}/EVIDENCE.md`,
  );
  return lines.join("\n") + "\n";
}
