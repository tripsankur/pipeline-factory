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
  const specQuery = useQuery({
    queryKey: ["spec", specId],
    queryFn: () => api.getSpec(specId!),
    enabled: specId !== null,
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

  if (!specId) {
    return <p style={{ color: "var(--pf-tsec)" }}>Select a spec from the Fleet dashboard, or generate one via Contract intake.</p>;
  }
  if (specQuery.isLoading || !draft) return <p style={{ color: "var(--pf-tsec)" }}>Loading spec…</p>;
  if (specQuery.isError) return <p style={{ color: "var(--pf-bad)" }}>{String(specQuery.error)}</p>;

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
