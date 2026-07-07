import type { Spec, SpecStatus } from "@pf/core";
import type { LlmCallMeta } from "@pf/adapters";
import type { BuildRunRow, FleetRow, LlmCallRow, RegistryStore, SpecRow, VersionRow } from "./types.js";

/**
 * Per-call resilience (ADR-007 hardening): the Lakebase endpoint can be
 * suspended/disabled OUT-OF-BAND (observed: trial workspace disabled the
 * endpoint; every pg-backed route 500'd even though the warehouse fallback
 * existed — it was only selected at boot). This decorator tries Postgres per
 * call and falls back to the warehouse store on connection-class failures,
 * so a pg outage degrades to slower reads instead of a broken app.
 */

const CONNECTION_ERRORS = [
  "endpoint has been disabled",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "Connection terminated",
  "connection is closed",
  "password authentication failed",
  "the database system is starting up",
];

function isConnectionError(err: unknown): boolean {
  const s = String(err);
  return CONNECTION_ERRORS.some((m) => s.includes(m));
}

export class ResilientStore implements RegistryStore {
  constructor(
    private readonly primary: RegistryStore,
    private readonly fallback: RegistryStore,
    private readonly onFallback: (method: string, err: unknown) => void = () => {},
  ) {}

  get kind(): "postgres" | "warehouse" {
    return this.primary.kind;
  }

  private async call<T>(method: string, fn: (s: RegistryStore) => Promise<T>): Promise<T> {
    try {
      return await fn(this.primary);
    } catch (err) {
      if (!isConnectionError(err)) throw err;
      this.onFallback(method, err);
      return fn(this.fallback);
    }
  }

  insertSpec(spec: Spec, createdBy: string): Promise<void> {
    return this.call("insertSpec", (s) => s.insertSpec(spec, createdBy));
  }
  insertVersion(spec: Spec, reason: string, createdBy: string): Promise<void> {
    return this.call("insertVersion", (s) => s.insertVersion(spec, reason, createdBy));
  }
  setStatus(specId: string, status: SpecStatus, approvedBy?: string): Promise<void> {
    return this.call("setStatus", (s) => s.setStatus(specId, status, approvedBy));
  }
  listSpecs(): Promise<SpecRow[]> {
    return this.call("listSpecs", (s) => s.listSpecs());
  }
  getSpec(specId: string, version?: number): Promise<Spec | null> {
    return this.call("getSpec", (s) => s.getSpec(specId, version));
  }
  getRegistryRow(specId: string): Promise<{ status: string; approved_by: string | null } | null> {
    return this.call("getRegistryRow", (s) => s.getRegistryRow(specId));
  }
  listVersions(specId: string): Promise<VersionRow[]> {
    return this.call("listVersions", (s) => s.listVersions(specId));
  }
  listSpecJson(): Promise<string[]> {
    return this.call("listSpecJson", (s) => s.listSpecJson());
  }
  fleet(): Promise<FleetRow[]> {
    return this.call("fleet", (s) => s.fleet());
  }
  listBuilds(specId: string, limit?: number): Promise<BuildRunRow[]> {
    return this.call("listBuilds", (s) => s.listBuilds(specId, limit));
  }
  insertBuildRun(run: { runId: string; specId: string; specVersion: number; branch: string; detail: string }): Promise<void> {
    return this.call("insertBuildRun", (s) => s.insertBuildRun(run));
  }
  failBuildRun(runId: string, fixIterations: number, detail: string): Promise<void> {
    return this.call("failBuildRun", (s) => s.failBuildRun(runId, fixIterations, detail));
  }
  completeBuildRun(runId: string, fixIterations: number, prUrl: string): Promise<void> {
    return this.call("completeBuildRun", (s) => s.completeBuildRun(runId, fixIterations, prUrl));
  }
  failRunningBuildRun(runId: string, detail: string): Promise<void> {
    return this.call("failRunningBuildRun", (s) => s.failRunningBuildRun(runId, detail));
  }
  logLlmCall(meta: LlmCallMeta, specId: string | null): Promise<void> {
    return this.call("logLlmCall", (s) => s.logLlmCall(meta, specId));
  }
  listLlmCalls(specId: string): Promise<LlmCallRow[]> {
    return this.call("listLlmCalls", (s) => s.listLlmCalls(specId));
  }
  logFeatureEvent(feature: string, userEmail: string): Promise<void> {
    return this.call("logFeatureEvent", (s) => s.logFeatureEvent(feature, userEmail));
  }
}
