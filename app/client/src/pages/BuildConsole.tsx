import { useEffect, useRef, useState } from "react";
import { streamBuild, type BuildEvent } from "../api";
import { Button, Card, Mono } from "../components/ui";

const STEP_DEFS: { id: string; label: string }[] = [
  { id: "render", label: "Render" },
  { id: "branch", label: "Branch" },
  { id: "spec_upsert", label: "Metadata" },
  { id: "provision", label: "Provision" },
  { id: "workflow_run", label: "Workflow" },
  { id: "dq", label: "Data quality" },
  { id: "recon", label: "Recon" },
  { id: "pr", label: "PR" },
];

interface StepState {
  status: "pending" | "running" | "done" | "deferred" | "failed";
  meta: string;
}

const initialSteps = (): Record<string, StepState> =>
  Object.fromEntries(STEP_DEFS.map((s) => [s.id, { status: "pending", meta: "" }]));

export default function BuildConsole({ specId }: { specId: string | null }) {
  const [steps, setSteps] = useState<Record<string, StepState>>(initialSteps);
  const [logs, setLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [fixes, setFixes] = useState<{ iteration: number; max: number; reason: string }[]>([]);
  const [result, setResult] = useState<{ pr?: { url: string; number: number }; error?: string } | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => () => cancelRef.current?.(), []);

  const start = () => {
    if (!specId || running) return;
    setSteps(initialSteps());
    setLogs([]);
    setFixes([]);
    setResult(null);
    setRunning(true);
    cancelRef.current = streamBuild(
      specId,
      (e: BuildEvent) => {
        if (e.type === "step" && e.step) {
          setSteps((s) => ({ ...s, [e.step!]: { status: e.status ?? "pending", meta: e.meta ?? "" } }));
        } else if (e.type === "log" && e.text) {
          setLogs((l) => [...l, e.text!]);
        } else if (e.type === "fix") {
          setFixes((f) => [
            ...f,
            { iteration: e.iteration ?? f.length + 1, max: e.maxIterations ?? 3, reason: e.meta ?? "" },
          ]);
        } else if (e.type === "done") {
          setResult({ pr: e.pr });
        } else if (e.type === "error") {
          setResult({ error: e.text ?? "build failed" });
        }
      },
      () => setRunning(false),
    );
  };

  if (!specId) {
    return <p style={{ color: "var(--pf-tsec)" }}>Approve a spec, then run its build here.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px" }}>
        <Mono>{specId}</Mono>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          {result?.pr && (
            <span style={{ fontSize: 10.8, color: "var(--pf-ok)" }}>
              PR{" "}
              {result.pr.url.startsWith("http") ? (
                <a href={result.pr.url} target="_blank" rel="noreferrer" style={{ color: "var(--pf-acc)" }}>
                  #{result.pr.number}
                </a>
              ) : (
                <Mono>{result.pr.url}</Mono>
              )}{" "}
              opened — merge is yours (human gate #2)
            </span>
          )}
          {result?.error && <span style={{ fontSize: 10.8, color: "var(--pf-bad)" }}>{result.error}</span>}
          <Button onClick={start} disabled={running}>
            {running ? "Building…" : "Run build"}
          </Button>
        </div>
      </Card>

      {/* stepper */}
      <Card style={{ padding: "18px 22px" }}>
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          {STEP_DEFS.map((def, i) => {
            const st = steps[def.id] ?? { status: "pending", meta: "" };
            const color =
              st.status === "done"
                ? "var(--pf-acc)"
                : st.status === "running"
                  ? "var(--pf-warn)"
                  : st.status === "failed"
                    ? "var(--pf-bad)"
                    : "var(--pf-bd2)";
            return (
              <div key={def.id} style={{ flex: 1, display: "flex", alignItems: "flex-start" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 84 }}>
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: "50%",
                      border: `2px solid ${color}`,
                      background: st.status === "done" ? "var(--pf-acc)" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: st.status === "done" ? "var(--pf-acc-tx)" : color,
                      fontSize: 12.1,
                      animation: st.status === "running" ? "pf_pulse 1.2s ease-in-out infinite" : undefined,
                    }}
                  >
                    {st.status === "done" ? "✓" : st.status === "running" ? "◌" : st.status === "deferred" ? "…" : "＋"}
                  </div>
                  <div
                    style={{
                      marginTop: 7,
                      fontSize: 11.2,
                      fontWeight: 600,
                      color: st.status === "pending" || st.status === "deferred" ? "var(--pf-tmut)" : "var(--pf-tpri)",
                    }}
                  >
                    {def.label}
                  </div>
                  <div style={{ fontSize: 9.8, color: "var(--pf-tmut)", textAlign: "center", maxWidth: 110 }}>
                    {st.meta}
                  </div>
                </div>
                {i < STEP_DEFS.length - 1 && (
                  <div
                    style={{
                      flex: 1,
                      height: 2,
                      marginTop: 13,
                      background: st.status === "done" ? "var(--pf-acc)" : "var(--pf-bd2)",
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* live log */}
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div
          style={{
            padding: "8px 14px",
            borderBottom: "1px solid var(--pf-bd)",
            fontSize: 10.8,
            color: "var(--pf-tmut)",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: running ? "var(--pf-run)" : "var(--pf-bd2)",
              animation: running ? "pf_blink 1.2s ease-in-out infinite" : undefined,
            }}
          />
          build log {running ? "· live" : ""}
        </div>
        <div
          style={{
            background: "var(--pf-log-bg)",
            padding: 14,
            minHeight: 180,
            maxHeight: 320,
            overflow: "auto",
            fontFamily: "var(--pf-font-mono)",
            fontSize: 11.2,
            lineHeight: 1.7,
            color: "var(--pf-tsec)",
          }}
        >
          {logs.length === 0 && <span style={{ color: "var(--pf-tmut)" }}>— no output yet —</span>}
          {logs.map((l, i) => (
            <div key={i} style={{ color: l.includes("✓") ? "var(--pf-ok)" : undefined }}>
              {l}
            </div>
          ))}
          {running && <span style={{ animation: "pf_blink 1s step-end infinite" }}>▌</span>}
          <div ref={logEndRef} />
        </div>
      </Card>

      {/* fix-loop card — attempt N of MAX + AI root cause, per design */}
      {fixes.length > 0 && (
        <Card style={{ borderColor: "var(--pf-warn)", padding: "14px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 12.1, color: "var(--pf-warn)" }}>
              Fix loop — attempt {fixes[fixes.length - 1]!.iteration} of {fixes[fixes.length - 1]!.max}
            </span>
            <span style={{ display: "flex", gap: 4 }}>
              {Array.from({ length: fixes[fixes.length - 1]!.max }, (_, i) => (
                <span
                  key={i}
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: i < fixes.length ? "var(--pf-warn)" : "var(--pf-bd2)",
                  }}
                />
              ))}
            </span>
          </div>
          {fixes.map((f) => (
            <div key={f.iteration} style={{ fontSize: 10.8, color: "var(--pf-tsec)", padding: "3px 0" }}>
              <span style={{ fontFamily: "var(--pf-font-mono)", color: "var(--pf-tmut)" }}>#{f.iteration}</span>{" "}
              {f.reason}
            </div>
          ))}
          <p style={{ fontSize: 10.8, color: "var(--pf-tmut)", margin: "8px 0 0" }}>
            The LLM edits the spec, never files — each fix re-renders, re-stages, re-runs (constraint #2).
          </p>
        </Card>
      )}

      {/* shown only when runner jobs are not wired (e.g. local dev without bundle jobs) */}
      {Object.values(steps).some((s) => s.status === "deferred") && (
        <Card style={{ borderColor: "var(--pf-warn)", background: "var(--pf-warn-soft)", padding: "12px 18px" }}>
          <span style={{ fontSize: 10.8, color: "var(--pf-tsec)" }}>
            <strong style={{ color: "var(--pf-warn)" }}>Steps deferred:</strong> the framework recon job
            was not found in this environment — deferred steps were skipped, never simulated.
          </span>
        </Card>
      )}
    </div>
  );
}
