# The Pipeline Factory CI/CD Contract

**This document is the product's public interface.** Pipeline Factory is CI/CD-agnostic: it
never talks to your CI system beyond opening a pull request. Your CI integrates by reading
one file and running two commands.

## What the factory pushes

Every factory build pushes a feature branch named `feat/<entity>-ingestion-v<spec_version>`
containing:

```
factory.manifest.yml                  <- the contract file (repo root of the branch)
pipelines/<entity>/
  lakeflow_connect.yml                <- ingestion pipeline config
  silver_stitch.sql                   <- crosswalk-join stitching
  adapter_view.sql                    <- legacy-shaped adapter view
  expectations.yml                    <- DQ expectations
  recon_job.py                        <- reconciliation job
  bundle_resource.yml                 <- Databricks Asset Bundle resource include
  tests/test_pipeline.py              <- rendered smoke tests
  EVIDENCE.md                         <- human-readable build evidence (same text as PR body)
```

Every file carries `generated_by: pipeline_factory`, `spec_id`, `spec_version` headers.
**Never hand-edit these files** — changes belong in the spec; the factory re-renders.

## factory.manifest.yml (manifest_version: 1)

```yaml
manifest_version: 1
generated_by: pipeline_factory
spec_id: spec-94139bfa
spec_version: 1
entity: contract_account
artifacts:
  - path: pipelines/contract_account/lakeflow_connect.yml
    sha256: <checksum>
  # ... every artifact, with checksum
commands:
  verify: make verify
  deploy: databricks bundle deploy -t <target>
evidence:
  location: pipelines/contract_account/EVIDENCE.md
```

## What your CI must do

1. **On PR**: parse `factory.manifest.yml`; verify each artifact's sha256 matches (tamper
   check); run `commands.verify`.
2. **After merge** (promotion — yours entirely): run `commands.deploy` with your target.
   The factory itself never deploys beyond the `dev` target; prod promotion is your CI's
   job and your approval flow.

That is the whole integration. GitHub Actions reference: `.github/workflows/ci.yml` in this
repo. Azure DevOps / GitLab: implement the same two steps against the same manifest.

## Guarantees

- `manifest_version` bumps on any schema change (with deprecation notice).
- Checksums are SHA-256 over exact file bytes (LF endings, single trailing newline).
- The factory opens PRs but never merges them (human gate #2).
