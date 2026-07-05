# ADR-003: factory.manifest.yml is the CI/CD integration contract

**Status:** Accepted · 2026-07-05

## Context
Customers run different CI systems (GitHub Actions, Azure DevOps, GitLab, Jenkins). The
product must not care (handoff §4) — promotion beyond the PR belongs to customer CI.

## Decision
Every feature branch carries a `factory.manifest.yml` declaring: spec id/version, artifact
inventory with paths + checksums, the verify command (`make verify`), the deploy command
(`databricks bundle deploy -t <target>`), and the evidence location. Any CI integrates by
reading the manifest and running the two commands. `docs/CICD_CONTRACT.md` documents this
as the product's public interface; `.github/workflows/ci.yml` is merely the *reference*
implementation.

## Consequences
- Supporting a new CI system requires zero product changes.
- The manifest schema is public API — changes require versioning and deprecation.
