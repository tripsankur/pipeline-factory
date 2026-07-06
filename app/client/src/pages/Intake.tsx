import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, type ParsedContract } from "../api";
import { Button, Card, Mono } from "../components/ui";

export default function Intake({ onSpecCreated }: { onSpecCreated: (specId: string) => void }) {
  const [contract, setContract] = useState<ParsedContract | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [form, setForm] = useState({
    sourceSystem: "aldm",
    targetSystem: "salesforce_comms",
    sourceEntity: "",
    targetEntity: "",
    crosswalkTable: "",
  });

  const parse = useMutation({
    mutationFn: (file: File) => api.parseContract(file),
    onSuccess: (r) => {
      setContract(r.contract);
      setForm((f) => ({
        ...f,
        sourceEntity: f.sourceEntity || `workspace.bronze.${r.contract.entity}`,
        targetEntity: f.targetEntity || `workspace.silver.${r.contract.entity}`,
        crosswalkTable: f.crosswalkTable || `workspace.silver.crosswalk_${r.contract.entity}`,
      }));
    },
  });

  const generate = useMutation({
    mutationFn: () => api.generateSpec({ contract: contract!, ...form }),
    onSuccess: (r) => onSpecCreated(r.spec.spec_id),
  });

  const onFile = (file: File | undefined) => {
    if (file) parse.mutate(file);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 860 }}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          onFile(e.dataTransfer.files[0]);
        }}
        style={{
          border: `1.5px dashed ${dragOver ? "var(--pf-acc)" : "var(--pf-bd2)"}`,
          borderRadius: 12,
          padding: "38px 24px",
          textAlign: "center",
          background: "var(--pf-surf)",
        }}
      >
        <p style={{ margin: "0 0 6px", fontWeight: 600 }}>Drop an interface contract</p>
        <p style={{ margin: "0 0 14px", color: "var(--pf-tmut)", fontSize: 10.8 }}>
          CSV schema or Word document · Confluence coming soon
        </p>
        <input
          type="file"
          accept=".csv,.docx"
          id="contract-file"
          style={{ display: "none" }}
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <Button kind="ghost" onClick={() => document.getElementById("contract-file")?.click()}>
          Browse files
        </Button>
        {parse.isPending && <p style={{ color: "var(--pf-tsec)" }}>Parsing…</p>}
        {parse.isError && <p style={{ color: "var(--pf-bad)" }}>{String(parse.error)}</p>}
      </div>

      {/* Confluence intake — visible, clickable, locked (coming-soon rule: never hidden) */}
      <Card style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, opacity: 0.75 }}>
        <input
          placeholder="https://confluence.example.com/pages/interface-contract…"
          disabled
          style={{
            flex: 1,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid var(--pf-bd2)",
            background: "var(--pf-input-bg)",
            color: "var(--pf-tmut)",
            fontFamily: "var(--pf-font-mono)",
            fontSize: 10.8,
          }}
        />
        <Button kind="ghost" onClick={() => api.featureClick("confluence_intake")}>
          Harvest from Confluence
        </Button>
        <span
          style={{
            fontSize: 9,
            padding: "2px 7px",
            borderRadius: 20,
            background: "var(--pf-chip)",
            border: "1px solid var(--pf-bd)",
            color: "var(--pf-tmut)",
          }}
        >
          soon
        </span>
      </Card>

      {contract && (
        <Card>
          <h3 style={{ margin: "0 0 4px", fontSize: 13.2 }}>
            Parsed schema: <Mono>{contract.entity}</Mono>
          </h3>
          <p style={{ margin: "0 0 12px", color: "var(--pf-tmut)", fontSize: 11.2 }}>
            {contract.columns.length} columns · {contract.sourceKind}
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.8 }}>
            <thead>
              <tr style={{ color: "var(--pf-tmut)", textAlign: "left" }}>
                <th style={{ padding: "6px 8px" }}>Column</th>
                <th style={{ padding: "6px 8px" }}>Type</th>
                <th style={{ padding: "6px 8px" }}>Description / sample</th>
              </tr>
            </thead>
            <tbody>
              {contract.columns.map((c) => (
                <tr key={c.name} style={{ borderTop: "1px solid var(--pf-bd)" }}>
                  <td style={{ padding: "6px 8px" }}>
                    <Mono>{c.name}</Mono>
                  </td>
                  <td style={{ padding: "6px 8px", color: "var(--pf-tsec)" }}>{c.type ?? "—"}</td>
                  <td style={{ padding: "6px 8px", color: "var(--pf-tsec)" }}>
                    {c.description ?? c.sample ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 18 }}>
            {(
              [
                ["sourceSystem", "Source system"],
                ["targetSystem", "Target system"],
                ["sourceEntity", "Source table (3-part)"],
                ["targetEntity", "Target table (3-part)"],
                ["crosswalkTable", "Crosswalk table (3-part)"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} style={{ fontSize: 11.2, color: "var(--pf-tsec)" }}>
                {label}
                <input
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--pf-bd2)",
                    background: "var(--pf-input-bg)",
                    color: "var(--pf-tpri)",
                    fontFamily: "var(--pf-font-mono)",
                    fontSize: 10.8,
                  }}
                />
              </label>
            ))}
          </div>

          <div style={{ marginTop: 18, display: "flex", gap: 10, alignItems: "center" }}>
            <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
              {generate.isPending ? "Generating mapping…" : "Generate mapping"}
            </Button>
            {generate.isError && (
              <span style={{ color: "var(--pf-bad)", fontSize: 10.8 }}>{String(generate.error)}</span>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
