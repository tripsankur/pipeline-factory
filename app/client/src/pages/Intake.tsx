import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, type ParsedContract, type ParseResponse } from "../api";
import { Button, Card, Mono } from "../components/ui";
import { useToast } from "../components/Toast";

export default function Intake({ onSpecCreated }: { onSpecCreated: (specId: string) => void }) {
  const [contract, setContract] = useState<ParsedContract | null>(null);
  const [structured, setStructured] = useState<Extract<ParseResponse, { kind: "structured" }> | null>(null);
  const [generated, setGenerated] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState(false);
  const toast = useToast();
  const [form, setForm] = useState({
    sourceSystem: "aldm",
    targetSystem: "salesforce_comms",
    sourceEntity: "",
    targetEntity: "",
  });

  const parse = useMutation({
    mutationFn: (file: File) => api.parseContract(file),
    onSuccess: (r) => {
      if (r.kind === "structured") {
        setStructured(r);
        setContract(null);
        return;
      }
      setStructured(null);
      setContract(r.contract);
      setForm((f) => ({
        ...f,
        sourceEntity: f.sourceEntity || `workspace.bronze.${r.contract.entity}`,
        targetEntity: f.targetEntity || `workspace.silver.${r.contract.entity}`,
      }));
    },
  });

  const generate = useMutation({
    mutationFn: () => api.generateSpec({ contract: contract!, ...form }),
    onSuccess: (r) => onSpecCreated(r.spec.spec_id),
  });

  const generateTable = useMutation({
    mutationFn: (table: string) => {
      const t = structured!.tables.find((x) => x.table === table)!;
      return api.generateSpec({
        contract: { entity: t.entity, columns: t.columns, narrative: t.narrative, sourceKind: t.sourceKind },
        sourceSystem: t.suggested.sourceSystem,
        targetSystem: t.suggested.targetSystem,
        sourceEntity: t.suggested.sourceEntity,
        targetEntity: t.suggested.targetEntity,
        mode: t.mode,
        cursorColumn: t.cursorColumn,
        audit: structured!.audit,
      });
    },
    onSuccess: (r, table) => {
      setGenerated((g) => ({ ...g, [table]: r.spec.spec_id }));
      toast(`Spec generated for ${table}: ${r.spec.spec_id}`);
    },
    onError: (e) => toast(String(e).slice(0, 160), "bad"),
  });

  const [connectionName, setConnectionName] = useState("sfdc_sample");
  const ingest = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/ingestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connection_name: connectionName,
          source_system: structured!.contract_info.source_system,
          tables: structured!.tables.map((t) => ({ source_object: t.sourceObject })),
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<{ pipeline_id: string; name: string }>;
    },
    onSuccess: (r) => toast(`Ingestion batch ${r.name} created + started (pipeline ${r.pipeline_id.slice(0, 8)}…)`),
    onError: (e) => toast(String(e).slice(0, 240), "bad"),
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
          Interface Contract v1 (.yaml, whole source) · CSV schema · Word doc · Confluence coming soon
        </p>
        <input
          type="file"
          accept=".csv,.docx,.yaml,.yml,.json"
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

      {structured && (
        <Card>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
            <h3 style={{ margin: 0, fontSize: 12.8 }}>{structured.contract_info.name}</h3>
            <Mono>{structured.contract_info.contract_id}</Mono>
            <span style={{ fontSize: 10.4, color: "var(--pf-tmut)" }}>
              v{structured.contract_info.contract_version} · owner {structured.contract_info.owner} · batch cron{" "}
              {structured.contract_info.batch_schedule}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, margin: "10px 0 14px" }}>
            {Object.entries(structured.contract_info.connectivity).map(([env, desc]) => (
              <div key={env} style={{ display: "flex", gap: 8, fontSize: 10.8, alignItems: "baseline" }}>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.8,
                    padding: "2px 8px",
                    borderRadius: 20,
                    minWidth: 34,
                    textAlign: "center",
                    color: env === "prod" ? "var(--pf-bad)" : "var(--pf-acc)",
                    background: env === "prod" ? "var(--pf-bad-soft)" : "var(--pf-acc-soft)",
                  }}
                >
                  {env}
                </span>
                <Mono>{desc}</Mono>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "0 0 12px" }}>
            <span style={{ fontSize: 10.8, color: "var(--pf-tsec)" }}>UC connection</span>
            <input
              value={connectionName}
              onChange={(e) => setConnectionName(e.target.value)}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid var(--pf-bd2)",
                background: "var(--pf-input-bg)",
                color: "var(--pf-tpri)",
                fontFamily: "var(--pf-font-mono)",
                fontSize: 11.2,
                width: 180,
              }}
            />
            <Button onClick={() => ingest.mutate()} disabled={ingest.isPending || !connectionName}>
              {ingest.isPending ? "Creating batch…" : `Create ingestion batch (${structured.tables.length} tables)`}
            </Button>
            <span style={{ fontSize: 10.4, color: "var(--pf-tmut)" }}>
              one Lakeflow pipeline pulls the whole source → bronze
            </span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.8 }}>
            <thead>
              <tr style={{ color: "var(--pf-tmut)", textAlign: "left" }}>
                <th style={{ padding: "6px 8px" }}>Table</th>
                <th style={{ padding: "6px 8px" }}>PK</th>
                <th style={{ padding: "6px 8px" }}>Mode</th>
                <th style={{ padding: "6px 8px" }}>Columns</th>
                <th style={{ padding: "6px 8px" }}>Bronze destination</th>
                <th style={{ padding: "6px 8px" }}></th>
              </tr>
            </thead>
            <tbody>
              {structured.tables.map((t) => (
                <tr key={t.table} style={{ borderTop: "1px solid var(--pf-bd)" }}>
                  <td style={{ padding: "7px 8px", fontWeight: 600 }}>{t.table}</td>
                  <td style={{ padding: "7px 8px" }}>
                    <Mono>{t.primaryKey.join(", ")}</Mono>
                  </td>
                  <td style={{ padding: "7px 8px" }}>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        padding: "2px 7px",
                        borderRadius: 20,
                        color: t.mode === "cdc" ? "var(--pf-run)" : "var(--pf-tsec)",
                        background: "var(--pf-chip)",
                      }}
                    >
                      {t.mode === "cdc" ? "nrt" : t.mode}
                    </span>
                  </td>
                  <td style={{ padding: "7px 8px", color: "var(--pf-tsec)" }}>{t.columns.length}</td>
                  <td style={{ padding: "7px 8px" }}>
                    <Mono>{t.suggested.sourceEntity}</Mono>
                  </td>
                  <td style={{ padding: "5px 8px", textAlign: "right" }}>
                    {generated[t.table] ? (
                      <Button kind="ghost" onClick={() => onSpecCreated(generated[t.table]!)}>
                        Review {generated[t.table]}
                      </Button>
                    ) : (
                      <Button
                        onClick={() => generateTable.mutate(t.table)}
                        disabled={generateTable.isPending}
                      >
                        {generateTable.isPending && generateTable.variables === t.table
                          ? "Generating…"
                          : "Generate mapping"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

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

          <PromptPanel contract={contract} form={form} />
        </Card>
      )}

      <DiscoverPanel />
    </div>
  );
}

/** Prompt transparency (ask #7): show EXACTLY what the app's LLM will be asked. */
function PromptPanel({
  contract,
  form,
}: {
  contract: ParsedContract;
  form: { sourceSystem: string; targetSystem: string; sourceEntity: string; targetEntity: string };
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<{ system: string; user: string } | null>(null);
  const load = async () => {
    setOpen(!open);
    if (!preview) {
      const r = await fetch("/api/prompts/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contract, ...form }),
      });
      if (r.ok) setPreview((await r.json()) as { system: string; user: string });
    }
  };
  return (
    <div style={{ marginTop: 14, borderTop: "1px solid var(--pf-bd)", paddingTop: 10 }}>
      <button
        className="pf-btn"
        onClick={load}
        style={{ background: "none", border: "none", color: "var(--pf-acc)", cursor: "pointer", padding: 0, fontSize: "var(--fs-small)" }}
      >
        {open ? "▾" : "▸"} What the LLM will be asked (exact prompt)
      </button>
      {open && preview && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          {(["system", "user"] as const).map((k) => (
            <div key={k}>
              <div style={{ fontSize: "var(--fs-micro)", color: "var(--pf-tmut)", textTransform: "uppercase" }}>{k} prompt</div>
              <pre
                style={{
                  margin: "4px 0 0",
                  padding: 10,
                  background: "var(--pf-code-bg)",
                  border: "1px solid var(--pf-bd)",
                  borderRadius: "var(--rad)",
                  fontSize: "var(--fs-mono)",
                  fontFamily: "var(--pf-font-mono)",
                  whiteSpace: "pre-wrap",
                  maxHeight: 260,
                  overflow: "auto",
                }}
              >
                {preview[k]}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface DiscoveredField {
  name: string;
  type: string;
  nullable: boolean;
  pii_hint: boolean;
  calculated: boolean;
  compound: boolean;
}

/** Schema discovery (ask #10 / contract v1.1): pull the TRUE column list from
 *  the source, prune, and export contract-ready YAML. */
function DiscoverPanel() {
  const toast = useToast();
  const [conn, setConn] = useState("sfdc_sample");
  const [objectsText, setObjectsText] = useState("Account, Contact");
  const [result, setResult] = useState<{ name: string; fields: DiscoveredField[] }[] | null>(null);
  const [selected, setSelected] = useState<Record<string, Record<string, boolean>>>({});
  const [busy, setBusy] = useState(false);

  const discover = async () => {
    setBusy(true);
    try {
      const objects = objectsText.split(",").map((s) => s.trim()).filter(Boolean);
      const r = await fetch(`/api/connections/${encodeURIComponent(conn)}/discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objects }),
      });
      if (!r.ok) throw new Error((await r.text()).slice(0, 240));
      const data = (await r.json()) as { objects: { name: string; fields: DiscoveredField[] }[] };
      setResult(data.objects);
      const sel: Record<string, Record<string, boolean>> = {};
      for (const o of data.objects) {
        sel[o.name] = Object.fromEntries(o.fields.map((f) => [f.name, !f.compound && !f.calculated]));
      }
      setSelected(sel);
      toast(`discovered ${data.objects.map((o) => `${o.name}: ${o.fields.length} fields`).join(" · ")}`);
    } catch (e) {
      toast(String(e).slice(0, 200), "bad");
    } finally {
      setBusy(false);
    }
  };

  const yamlFor = (o: { name: string; fields: DiscoveredField[] }): string => {
    const lines = [`# discovered from ${conn} — contract v1.1 (schema_source: discovered)`, `columns:`];
    for (const f of o.fields) {
      const on = selected[o.name]?.[f.name] ?? false;
      lines.push(
        `  - { name: ${f.name}, type: ${f.type}, nullable: ${f.nullable}${f.pii_hint ? ", pii: true" : ""}${on ? "" : ", selected: false"} }`,
      );
    }
    return lines.join("\n");
  };

  const download = (o: { name: string; fields: DiscoveredField[] }) => {
    const blob = new Blob([yamlFor(o)], { type: "text/yaml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${o.name.toLowerCase()}.columns.yaml`;
    a.click();
  };

  return (
    <Card style={{ padding: 16 }}>
      <h3 style={{ margin: "0 0 4px", fontSize: "var(--fs-h3)" }}>Discover source schema</h3>
      <p style={{ margin: "0 0 10px", fontSize: "var(--fs-small)", color: "var(--pf-tsec)" }}>
        Pull the true field list from the source so the Interface Contract matches reality (contract v1.1,
        <Mono> schema_source: discovered</Mono>). Prune columns here, then paste the YAML into the contract.
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={conn}
          onChange={(e) => setConn(e.target.value)}
          placeholder="connection name"
          style={{ padding: "6px 10px", borderRadius: "var(--rad)", border: "1px solid var(--pf-bd2)", background: "var(--pf-input-bg)", color: "var(--pf-tpri)", fontFamily: "var(--pf-font-mono)", fontSize: "var(--fs-mono)" }}
        />
        <input
          value={objectsText}
          onChange={(e) => setObjectsText(e.target.value)}
          placeholder="Account, Contact"
          style={{ flex: 1, minWidth: 200, padding: "6px 10px", borderRadius: "var(--rad)", border: "1px solid var(--pf-bd2)", background: "var(--pf-input-bg)", color: "var(--pf-tpri)", fontFamily: "var(--pf-font-mono)", fontSize: "var(--fs-mono)" }}
        />
        <Button onClick={discover} disabled={busy}>
          {busy ? "Discovering…" : "Discover schema"}
        </Button>
      </div>
      {result?.map((o) => {
        const count = Object.values(selected[o.name] ?? {}).filter(Boolean).length;
        return (
          <div key={o.name} style={{ marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ fontSize: "var(--fs-h3)" }}>
                {o.name} <span style={{ color: "var(--pf-tsec)", fontWeight: 400 }}>— {o.fields.length} fields, {count} selected</span>
              </strong>
              <Button onClick={() => download(o)}>Download contract YAML</Button>
            </div>
            <div style={{ maxHeight: 220, overflow: "auto", marginTop: 6, border: "1px solid var(--pf-bd)", borderRadius: "var(--rad)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-small)" }}>
                <tbody>
                  {o.fields.map((f) => (
                    <tr key={f.name} className="pf-row">
                      <td style={{ padding: "3px 8px", width: 30 }}>
                        <input
                          type="checkbox"
                          checked={selected[o.name]?.[f.name] ?? false}
                          disabled={f.compound || f.calculated}
                          onChange={(e) =>
                            setSelected((s) => ({ ...s, [o.name]: { ...s[o.name], [f.name]: e.target.checked } }))
                          }
                        />
                      </td>
                      <td style={{ padding: "3px 8px" }}>
                        <Mono>{f.name}</Mono>
                      </td>
                      <td style={{ padding: "3px 8px", color: "var(--pf-tsec)" }}>{f.type}</td>
                      <td style={{ padding: "3px 8px", color: "var(--pf-tmut)", fontSize: "var(--fs-micro)" }}>
                        {[f.pii_hint ? "PII?" : "", f.calculated ? "calculated (excluded)" : "", f.compound ? "compound (excluded)" : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </Card>
  );
}
