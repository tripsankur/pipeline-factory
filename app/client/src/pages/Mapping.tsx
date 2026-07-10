import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ColumnMapping, type Spec } from "../api";
import { Button, Card, ConfidenceBadge, Mono } from "../components/ui";
import { useToast } from "../components/Toast";

export default function Mapping({
  specId,
  onApproved,
}: {
  specId: string | null;
  onApproved: (specId: string) => void;
}) {
  const qc = useQueryClient();
  // the page owns its selection: seeded by the prop (Fleet/Intake push one in),
  // but always switchable from the full spec list below
  const [selected, setSelected] = useState<string | null>(specId);
  useEffect(() => {
    if (specId) setSelected(specId);
  }, [specId]);

  const list = useQuery({ queryKey: ["specs"], queryFn: api.listSpecs, refetchInterval: 30_000 });
  const specQuery = useQuery({
    queryKey: ["spec", selected],
    queryFn: () => api.getSpec(selected!),
    enabled: selected !== null,
  });

  const [draft, setDraft] = useState<Spec | null>(null);
  const [drawer, setDrawer] = useState<ColumnMapping | null>(null);
  const [ack, setAck] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (specQuery.data) setDraft(specQuery.data.spec);
  }, [specQuery.data]);

  const toast = useToast();
  const approve = useMutation({
    mutationFn: () => api.approveSpec(draft!.spec_id, draft!),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["fleet"] });
      setModalOpen(false);
      toast(`Spec ${draft!.spec_id} v${r.spec.spec_version} approved by ${r.approved_by}`);
      onApproved(draft!.spec_id);
    },
    onError: (e) => toast(String(e).slice(0, 160), "bad"),
  });

  const specList = (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--pf-bd)", display: "flex", gap: 8, alignItems: "baseline" }}>
        <strong style={{ fontSize: "var(--fs-h3)" }}>Specs</strong>
        <span style={{ fontSize: "var(--fs-micro)", color: "var(--pf-tmut)" }}>
          pick one to review — “generated” specs await approval
        </span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-table)" }}>
        <tbody>
          {(list.data?.specs ?? []).map((s) => (
            <tr
              key={s.spec_id}
              className="pf-row"
              onClick={() => setSelected(s.spec_id)}
              style={{
                cursor: "pointer",
                background: s.spec_id === selected ? "var(--pf-acc-soft)" : undefined,
              }}
            >
              <td style={{ padding: "7px 14px", fontWeight: 600 }}>{s.entity}</td>
              <td style={{ padding: "7px 14px" }}>
                <Mono>{s.spec_id}</Mono>
                <span style={{ color: "var(--pf-tmut)", marginLeft: 6 }}>v{s.current_version}</span>
              </td>
              <td style={{ padding: "7px 14px" }}>
                <span
                  style={{
                    color:
                      s.status === "generated"
                        ? "var(--pf-warn)"
                        : s.status === "needs_human"
                          ? "var(--pf-bad)"
                          : "var(--pf-tsec)",
                  }}
                >
                  {s.status}
                </span>
              </td>
              <td style={{ padding: "7px 14px", color: "var(--pf-tmut)", fontSize: "var(--fs-micro)" }}>
                {s.updated_at?.slice(0, 19)}
              </td>
            </tr>
          ))}
          {list.data && list.data.specs.length === 0 && (
            <tr>
              <td style={{ padding: 14, color: "var(--pf-tmut)" }}>
                No specs yet — generate one via Contract intake.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );

  if (!selected) {
    return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{specList}</div>;
  }
  if (specQuery.isLoading || !draft) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {specList}
        <p style={{ color: "var(--pf-tsec)" }}>Loading spec…</p>
      </div>
    );
  }
  if (specQuery.isError) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {specList}
        <p style={{ color: "var(--pf-bad)" }}>{String(specQuery.error)}</p>
      </div>
    );
  }

  const lowConfidence = draft.columns.filter((c) => c.confidence < 0.8).length;
  const tiers = {
    bad: draft.columns.filter((c) => c.confidence < 0.75).length,
    warn: draft.columns.filter((c) => c.confidence >= 0.75 && c.confidence < 0.9).length,
    ok: draft.columns.filter((c) => c.confidence >= 0.9).length,
  };

  const editTransform = (name: string, transform: string) => {
    setDraft((d) =>
      d
        ? {
            ...d,
            columns: d.columns.map((c) =>
              c.name === name ? { ...c, transform: transform.trim() === "" ? null : transform } : c,
            ),
          }
        : d,
    );
  };

  return (
    <div style={{ paddingBottom: 90 }}>
      <details style={{ marginBottom: 12 }}>
        <summary style={{ cursor: "pointer", fontSize: "var(--fs-small)", color: "var(--pf-acc)" }}>
          Switch spec ({list.data?.specs.length ?? 0} total)
        </summary>
        <div style={{ marginTop: 8 }}>{specList}</div>
      </details>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 14.5 }}>
          <Mono>{draft.entity}</Mono> · v{draft.spec_version}
        </h2>
        <span style={{ fontSize: 11.2, color: "var(--pf-tmut)" }}>
          {draft.source.entity} → {draft.target.entity}
        </span>
        {lowConfidence > 0 && (
          <span style={{ fontSize: 11.2, color: "var(--pf-warn)" }}>
            {lowConfidence} low-confidence mapping{lowConfidence > 1 ? "s" : ""} need review
          </span>
        )}
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {(
            [
              ["bad", tiers.bad, "< 75%"],
              ["warn", tiers.warn, "75–89%"],
              ["ok", tiers.ok, "≥ 90%"],
            ] as const
          ).map(([tier, count, label]) => (
            <span
              key={tier}
              style={{
                fontSize: 10.4,
                fontFamily: "var(--pf-font-mono)",
                padding: "3px 9px",
                borderRadius: 20,
                border: "1px solid var(--pf-bd)",
                color: `var(--pf-${tier})`,
                background: `var(--pf-${tier}-soft)`,
              }}
            >
              {count} {label}
            </span>
          ))}
        </span>
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.8 }}>
          <thead>
            <tr style={{ color: "var(--pf-tmut)", textAlign: "left", background: "var(--pf-surf2)" }}>
              <th style={{ padding: "10px 14px" }}>Source</th>
              <th style={{ padding: "10px 14px" }}>Target</th>
              <th style={{ padding: "10px 14px" }}>Type</th>
              <th style={{ padding: "10px 14px", width: "38%" }}>Transform (SQL, editable)</th>
              <th style={{ padding: "10px 14px" }}>Confidence</th>
              <th style={{ padding: "10px 14px" }}></th>
            </tr>
          </thead>
          <tbody>
            {draft.columns.map((c) => (
              <tr
                key={c.name}
                style={{
                  borderTop: "1px solid var(--pf-bd)",
                  background: c.confidence < 0.8 ? "var(--pf-warn-soft)" : "transparent",
                }}
              >
                <td style={{ padding: "8px 14px" }}>
                  <Mono>{c.name}</Mono>
                </td>
                <td style={{ padding: "8px 14px" }}>
                  <Mono>{c.target}</Mono>
                </td>
                <td style={{ padding: "8px 14px", color: "var(--pf-tsec)" }}>{c.type}</td>
                <td style={{ padding: "4px 8px" }}>
                  <input
                    value={c.transform ?? ""}
                    placeholder="passthrough"
                    onChange={(e) => editTransform(c.name, e.target.value)}
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      borderRadius: 6,
                      border: "1px solid var(--pf-bd)",
                      background: "var(--pf-code-bg)",
                      color: "var(--pf-tpri)",
                      fontFamily: "var(--pf-font-mono)",
                      fontSize: 11.2,
                    }}
                  />
                </td>
                <td style={{ padding: "8px 14px" }}>
                  <ConfidenceBadge value={c.confidence} />
                </td>
                <td style={{ padding: "8px 14px" }}>
                  <button
                    onClick={() => setDrawer(c)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--pf-acc)",
                      cursor: "pointer",
                      fontSize: 11.2,
                    }}
                  >
                    why?
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {drawer && (
        <Card
          style={{
            position: "fixed",
            right: 24,
            top: 80,
            width: 380,
            zIndex: 20,
            boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
            animation: "pf_slidein 0.18s ease-out",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <Mono>{drawer.target}</Mono>
            <button
              onClick={() => setDrawer(null)}
              style={{ background: "none", border: "none", color: "var(--pf-tmut)", cursor: "pointer" }}
            >
              ✕
            </button>
          </div>
          <p style={{ fontSize: 11.2, color: "var(--pf-acc)", margin: "0 0 10px" }}>← {drawer.name}</p>
          <p style={{ fontSize: 12.1, color: "var(--pf-tsec)", lineHeight: 1.6 }}>{drawer.rationale}</p>
          {drawer.value_map.length > 0 && (
            <>
              <p style={{ fontSize: 10.4, color: "var(--pf-tmut)", textTransform: "uppercase", letterSpacing: 1 }}>
                Value map
              </p>
              {drawer.value_map.map((v) => (
                <div key={v.from} style={{ fontSize: 11.2, fontFamily: "var(--pf-font-mono)", color: "var(--pf-tsec)" }}>
                  {v.from} → {v.to}
                </div>
              ))}
            </>
          )}
        </Card>
      )}

      {/* sticky approve bar — human gate #1 */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 250,
          right: 0,
          background: "var(--pf-surf)",
          borderTop: "1px solid var(--pf-bd)",
          padding: "14px 28px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          zIndex: 10,
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10.8, color: "var(--pf-tsec)" }}>
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          I reviewed every low-confidence mapping and edited transforms where needed
        </label>
        <div style={{ marginLeft: "auto" }}>
          <Button disabled={!ack} onClick={() => setModalOpen(true)}>
            Approve spec v{draft.spec_version}
          </Button>
        </div>
      </div>

      {modalOpen && (
        <div
          onClick={() => setModalOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 40,
          }}
        >
          <Card style={{ width: 440 }} >
            <div onClick={(e) => e.stopPropagation()}>
              <h3 style={{ marginTop: 0 }}>Approve mapping spec?</h3>
              <p style={{ fontSize: 12.1, color: "var(--pf-tsec)", lineHeight: 1.6 }}>
                Approval freezes <Mono>{draft.spec_id}</Mono> v{draft.spec_version} as the render
                input. Artifacts are generated deterministically from this spec — the build never
                edits files directly.
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
                <Button kind="ghost" onClick={() => setModalOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
                  {approve.isPending ? "Approving…" : "Confirm approval"}
                </Button>
              </div>
              {approve.isError && (
                <p style={{ color: "var(--pf-bad)", fontSize: 10.8 }}>{String(approve.error)}</p>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
