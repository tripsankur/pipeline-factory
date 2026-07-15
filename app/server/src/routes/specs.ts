import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SpecLlmSchema, SpecSchema, type Spec } from "@pf/core";
import {
  CsvContractAdapter,
  DocxContractAdapter,
  StructuredContractAdapter,
  SPEC_SYSTEM_PROMPT,
  buildSpecUserPrompt,
  type FmapiClient,
  type ParsedContract,
} from "@pf/adapters";
import { contractAudit } from "@pf/core";
import type { RegistryStore } from "../lib/store/types.js";
import { identityFrom } from "../lib/identity.js";
import type { AppConfig } from "../config.js";

const csvAdapter = new CsvContractAdapter();
const docxAdapter = new DocxContractAdapter();
const structuredAdapter = new StructuredContractAdapter();

const GenerateBody = z.object({
  contract: z.object({
    entity: z.string(),
    columns: z.array(
      z.object({
        name: z.string(),
        type: z.string().optional(),
        nullable: z.boolean().optional(),
        description: z.string().optional(),
        sample: z.string().optional(),
      }),
    ),
    narrative: z.string(),
    sourceKind: z.enum(["csv", "docx", "confluence"]),
  }),
  sourceSystem: z.string().min(1),
  targetSystem: z.string().min(1),
  sourceEntity: z.string().min(1),
  targetEntity: z.string().min(1),
  /** structured-contract extras: authoritative over LLM output where present */
  mode: z.enum(["snapshot", "incremental", "cdc"]).optional(),
  cursorColumn: z.string().nullish(),
  audit: z.record(z.string(), z.unknown()).optional(),
});

const ApproveBody = z.object({
  /** reviewer may have edited transforms in the mapping screen */
  spec: SpecSchema,
});

export function registerSpecRoutes(
  app: FastifyInstance,
  registry: RegistryStore,
  fmapi: FmapiClient,
  cfg: AppConfig,
): void {
  /**
   * Contract intake: multipart file -> parsed schema preview.
   * Structured Interface Contract v1 (.yaml/.json) yields the whole source
   * (validated, multi-table); CSV/DOCX remain the free-form single-entity path.
   */
  app.post("/api/contracts/parse", async (req, reply) => {
    const file = await (req as unknown as { file: () => Promise<{ filename: string; toBuffer: () => Promise<Buffer> } | undefined> }).file();
    if (!file) return reply.code(400).send({ error: "no file uploaded" });
    const buf = await file.toBuffer();
    const name = file.filename.toLowerCase();
    try {
      if (name.endsWith(".yaml") || name.endsWith(".yml") || name.endsWith(".json")) {
        const result = structuredAdapter.parse(buf, name);
        return {
          kind: "structured",
          contract_info: {
            ...contractAudit(result.contract),
            name: result.contract.contract.name,
            batch_schedule: result.contract.ingestion.batch_schedule,
            connectivity: Object.fromEntries(
              Object.entries(result.contract.connectivity).map(([env, e]) => [
                env,
                `${e.protocol}://${e.host}:${e.port} (auth: ${e.auth_method}, secrets: ${e.secret_scope})`,
              ]),
            ),
          },
          tables: result.tables,
          audit: contractAudit(result.contract),
        };
      }
      const adapter = name.endsWith(".docx") ? docxAdapter : csvAdapter;
      const contract = await adapter.parse(buf, file.filename);
      return { kind: "freeform", contract };
    } catch (err) {
      // zod issues carry field paths — return them verbatim for the uploader
      return reply.code(422).send({ error: String(err).slice(0, 4000) });
    }
  });

  /** LLM spec generation (W1). LLM output = spec only, validated by zod (constraint #1). */
  app.post("/api/specs/generate", async (req, reply) => {
    const body = GenerateBody.parse(req.body);
    const specId = `spec-${randomUUID().slice(0, 8)}`;
    const user = identityFrom(req, cfg.PF_DEV_USER_EMAIL);
    const spec = await fmapi.structured({
      purpose: "contract_to_spec",
      system: SPEC_SYSTEM_PROMPT,
      user: buildSpecUserPrompt({
        contract: body.contract as ParsedContract,
        sourceSystem: body.sourceSystem,
        targetSystem: body.targetSystem,
        sourceEntity: body.sourceEntity,
        targetEntity: body.targetEntity,
        specId,
      }),
      schema: SpecLlmSchema,
      schemaName: "mapping_spec",
    });
    // never trust the model with identity fields; evidence is server-owned.
    // Contract-declared ingestion facts override LLM guesses.
    const finalSpec: Spec = {
      ...spec,
      spec_id: specId,
      spec_version: 1,
      ingestion: {
        ...spec.ingestion,
        ...(body.mode ? { mode: body.mode } : {}),
        ...(body.cursorColumn !== undefined ? { cursor_column: body.cursorColumn ?? null } : {}),
      },
      evidence: body.audit ? { contract: body.audit } : {},
    };
    await registry.insertSpec(finalSpec, user.email);
    return reply.code(201).send({ spec: finalSpec });
  });

  app.get("/api/specs", async () => ({ specs: await registry.listSpecs() }));

  app.get("/api/specs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const spec = await registry.getSpec(id);
    if (!spec) return reply.code(404).send({ error: "spec not found" });
    const versions = await registry.listVersions(id);
    return { spec, versions };
  });

  /** Approval — human gate #1 (constraint #7). Persists reviewer edits as a new version. */
  app.post("/api/specs/:id/approve", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { spec } = ApproveBody.parse(req.body);
    if (spec.spec_id !== id) return reply.code(400).send({ error: "spec_id mismatch" });
    const user = identityFrom(req, cfg.PF_DEV_USER_EMAIL);
    const current = await registry.getSpec(id);
    if (!current) return reply.code(404).send({ error: "spec not found" });
    if (JSON.stringify(current) !== JSON.stringify(spec)) {
      const edited: Spec = { ...spec, spec_version: current.spec_version + 1 };
      await registry.insertVersion(edited, "reviewer edits at approval", user.email);
      await registry.setStatus(id, "approved", user.email);
      return { spec: edited, approved_by: user.email };
    }
    await registry.setStatus(id, "approved", user.email);
    return { spec, approved_by: user.email };
  });

  /** Coming-soon click tracking -> ctl.feature_events (roadmap signal). */
  app.post("/api/features/:id/click", async (req) => {
    const { id } = req.params as { id: string };
    const user = identityFrom(req, cfg.PF_DEV_USER_EMAIL);
    await registry.logFeatureEvent(id, user.email);
    return { logged: true };
  });
}
