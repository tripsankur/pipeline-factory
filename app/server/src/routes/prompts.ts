import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  FIX_SYSTEM_PROMPT,
  SPEC_SYSTEM_PROMPT,
  buildSpecUserPrompt,
  type ParsedContract,
} from "@pf/adapters";
import type { RegistryStore } from "../lib/store/types.js";

/**
 * Prompt transparency (ask #7): the exact prompts the app's LLM receives are
 * user-visible — the live system prompts, a composed user-prompt preview for a
 * parsed contract, and the actual prompt/response text of past calls.
 */

const PreviewBody = z.object({
  contract: z.object({
    entity: z.string(),
    columns: z.array(z.record(z.string(), z.unknown())),
    narrative: z.string().default(""),
    sourceKind: z.enum(["csv", "docx", "confluence"]).default("csv"),
  }),
  sourceSystem: z.string().min(1),
  targetSystem: z.string().min(1),
  sourceEntity: z.string().min(1),
  targetEntity: z.string().min(1),
  crosswalkTable: z.string().min(1),
});

export function registerPromptRoutes(app: FastifyInstance, registry: RegistryStore): void {
  /** Live system prompts — rendered straight from the code the server runs. */
  app.get("/api/prompts", async () => ({
    prompts: [
      {
        id: "spec_system",
        title: "Spec generation — system prompt",
        purpose: "contract_to_spec",
        content: SPEC_SYSTEM_PROMPT,
      },
      {
        id: "fix_system",
        title: "Fix loop — system prompt",
        purpose: "fix_loop_delta",
        content: FIX_SYSTEM_PROMPT,
      },
    ],
  }));

  /** Composed user prompt for a parsed contract — what generation WILL send. */
  app.post("/api/prompts/preview", async (req, reply) => {
    const body = PreviewBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid body", detail: body.error.issues });
    const user = buildSpecUserPrompt({
      contract: body.data.contract as unknown as ParsedContract,
      sourceSystem: body.data.sourceSystem,
      targetSystem: body.data.targetSystem,
      sourceEntity: body.data.sourceEntity,
      targetEntity: body.data.targetEntity,
      crosswalkTable: body.data.crosswalkTable,
      specId: "spec-<generated-at-submit>",
    });
    return { system: SPEC_SYSTEM_PROMPT, user };
  });

  /** Actual prompt/response text of past LLM calls for a spec (pg store keeps
   *  full text; warehouse fallback returns metadata only). */
  app.get("/api/specs/:id/llm-calls", async (req) => {
    const { id } = req.params as { id: string };
    return { calls: await registry.listLlmCalls(id) };
  });
}
