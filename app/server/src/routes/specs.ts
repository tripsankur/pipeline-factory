import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SpecLlmSchema, SpecSchema, type Spec } from "@pf/core";
import {
  CsvContractAdapter,
  DocxContractAdapter,
  SPEC_SYSTEM_PROMPT,
  buildSpecUserPrompt,
  type FmapiClient,
  type ParsedContract,
} from "@pf/adapters";
import type { RegistryClient } from "../lib/registry-client.js";
import { identityFrom } from "../lib/identity.js";
import type { AppConfig } from "../config.js";

const csvAdapter = new CsvContractAdapter();
const docxAdapter = new DocxContractAdapter();

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
  crosswalkTable: z.string().min(1),
});

const ApproveBody = z.object({
  /** reviewer may have edited transforms in the mapping screen */
  spec: SpecSchema,
});

export function registerSpecRoutes(
  app: FastifyInstance,
  registry: RegistryClient,
  fmapi: FmapiClient,
  cfg: AppConfig,
): void {
  /** Contract intake: multipart file -> parsed schema preview. */
  app.post("/api/contracts/parse", async (req, reply) => {
    const file = await (req as unknown as { file: () => Promise<{ filename: string; toBuffer: () => Promise<Buffer> } | undefined> }).file();
    if (!file) return reply.code(400).send({ error: "no file uploaded" });
    const buf = await file.toBuffer();
    const name = file.filename;
    const adapter = name.toLowerCase().endsWith(".docx") ? docxAdapter : csvAdapter;
    try {
      const contract = await adapter.parse(buf, name);
      return { contract };
    } catch (err) {
      return reply.code(422).send({ error: String(err) });
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
        crosswalkTable: body.crosswalkTable,
        specId,
      }),
      schema: SpecLlmSchema,
      schemaName: "mapping_spec",
    });
    // never trust the model with identity fields; evidence is server-owned
    const finalSpec: Spec = { ...spec, spec_id: specId, spec_version: 1, evidence: {} };
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
