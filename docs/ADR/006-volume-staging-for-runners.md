# ADR-006: Runners read artifacts from a Delta staging table, not a git checkout

**Status:** Accepted · 2026-07-05 (amended same day: Delta table instead of UC volume)

## Context
The handoff's `deploy_runner` checks out the feature branch and runs
`bundle deploy -t dev`. That requires the runner to reach the artifacts repo
(`databricks-brnz-ingestion`) — blocked until a GitHub PAT lands in the secret scope, and
impossible with the mock CI/CD adapter (branches live in the app container's tmpdir).

A UC **volume** was tried first and failed on ownership: the app SP creates the volume and
owns it, while runner jobs run as the bundle deployer — cross-principal volume access
needs an explicit `GRANT READ VOLUME`, an RBAC change we avoid. Registry **tables** in
`ctl` have no such problem: both principals already read/write them (verified).

## Decision
The build's `deploy_dev` step stages rendered artifacts plus `spec.json` as rows in
`{catalog}.{schema}.staged_artifacts` (spec_id, spec_version, path, content, sha256).
`pipeline_runner` selects and executes the staged SQL verbatim (constraint #1: it never
edits artifacts) and evaluates expectations; `recon_runner` reads the staged spec's
crosswalk + compare config. Both write results to `ctl.*`.

`deploy_runner` (git checkout + real `bundle deploy`) is added when the PAT lands; the
step id `deploy_dev` and the console UI stay unchanged — only the implementation swaps.

## Consequences
- The full build → run → test → recon loop works today with zero external dependencies
  and zero extra grants.
- Staged rows carry the same sha256 as the committed files — provenance cannot diverge.
- Staging is replace-per-version (DELETE + INSERT), and the table doubles as an audit
  trail of exactly what each runner executed.
