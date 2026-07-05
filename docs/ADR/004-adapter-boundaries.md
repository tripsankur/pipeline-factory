# ADR-004: Adapter pattern at every integration boundary

**Status:** Accepted · 2026-07-05

## Context
The Galileo migration is customer #1, not the design ceiling. CI/CD systems, transports,
contract sources, and LLM endpoints all vary per customer (constraint #8).

## Decision
Four adapter boundaries in `packages/adapters`: `cicd` (CicdAdapter — branch/PR mechanics
only), `transport` (ingestion artifact selection), `contracts` (contract parsing), `llm`
(FMAPI client; endpoint name is config). `packages/core` imports only the interfaces.
Unimplemented adapters ship as typed skeletons behind coming-soon feature flags — visible
in the UI, never hidden, click-tracked in `ctl.feature_events`.

## Consequences
- Core logic is testable with mock adapters (`cicd/mock.ts` used until GitHub PAT lands).
- Vendor SDKs (octokit, mammoth, papaparse, openai) appear only inside `packages/adapters`.
