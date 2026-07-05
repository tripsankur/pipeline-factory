import type { Spec } from "./spec.js";
import type { RenderedFile } from "./renderer.js";

/**
 * PR evidence markdown — identical content goes into the PR body and
 * pipelines/<entity>/EVIDENCE.md (handoff §7 screen 5).
 */
export interface EvidenceInput {
  spec: Spec;
  files: RenderedFile[];
  approvedBy: string | null;
  buildRunId: string | null;
  fixIterations: { iteration: number; reason: string }[];
  recon: {
    keyMatchRate: number | null;
    rowMatchRate: number | null;
    attrMatchRate: number | null;
  } | null;
}

export function buildEvidenceMarkdown(input: EvidenceInput): string {
  const { spec } = input;
  const low = spec.columns.filter((c) => c.confidence < 0.8);
  const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(2)}%`);

  const sections = [
    `# Pipeline Factory evidence — ${spec.entity}`,
    "",
    `- **spec**: \`${spec.spec_id}\` v${spec.spec_version}`,
    `- **source**: \`${spec.source.entity}\` (${spec.source.system})`,
    `- **target**: \`${spec.target.entity}\` (${spec.target.system})`,
    `- **approved by**: ${input.approvedBy ?? "n/a"}`,
    `- **build run**: ${input.buildRunId ?? "n/a"}`,
    "",
    "## Mapping summary",
    "",
    "| source | target | transform | confidence |",
    "|---|---|---|---|",
    ...spec.columns.map(
      (c) =>
        `| \`${c.name}\` | \`${c.target}\` | ${c.transform ? `\`${c.transform.replaceAll("|", "\\|")}\`` : "passthrough"} | ${(c.confidence * 100).toFixed(0)}% |`,
    ),
    "",
    low.length > 0
      ? `**${low.length} mapping(s) below 80% confidence** were human-reviewed at approval.`
      : "All mappings at or above 80% confidence.",
    "",
    "## Expectations",
    "",
    ...(spec.expectations.length > 0
      ? spec.expectations.map((e) => `- \`${e.name}\`: \`${e.constraint}\` → ${e.action}`)
      : ["_none defined_"]),
    "",
    "## Reconciliation",
    "",
    input.recon
      ? [
          `- key match: **${pct(input.recon.keyMatchRate)}**`,
          `- row match: **${pct(input.recon.rowMatchRate)}**`,
          `- attribute match: **${pct(input.recon.attrMatchRate)}**`,
        ].join("\n")
      : "_not yet run — recon executes in the dev target after this PR's branch deploys_",
    "",
    "## Fix-loop timeline",
    "",
    ...(input.fixIterations.length > 0
      ? input.fixIterations.map((f) => `${f.iteration}. ${f.reason}`)
      : ["_no fixes required_"]),
    "",
    "## Artifacts",
    "",
    ...input.files.map((f) => `- \`${f.path}\` (\`${f.sha256.slice(0, 12)}\`)`),
    "",
    "---",
    `_generated_by: pipeline_factory · spec_id: ${spec.spec_id} · spec_version: ${spec.spec_version}_`,
  ];
  return sections.join("\n") + "\n";
}
