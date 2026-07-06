import OpenAI from "openai";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * FMAPI LLM adapter (handoff §3): Databricks Foundation Model APIs via the
 * OpenAI-compatible route. Endpoint name is config, never code. Structured
 * outputs enforced via json_schema response_format generated from zod.
 */

export interface FmapiConfig {
  host: string;
  endpoint: string;
  apiKeyProvider: () => Promise<string>;
}

export interface LlmCallMeta {
  purpose: string;
  endpoint: string;
  requestChars: number;
  responseChars: number;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number;
  status: "ok" | "error";
  /** exact prompt/response text (truncated to 32KB) — prompt transparency */
  requestText: string | null;
  responseText: string | null;
}

export type LlmCallLogger = (meta: LlmCallMeta) => Promise<void> | void;

/**
 * FMAPI structured outputs reject JSON-Schema validation keywords (e.g.
 * "string types do not support minLength"). Strip them — zod re-validates the
 * real constraints at parse time, the wire schema only guides generation.
 */
const UNSUPPORTED_KEYWORDS = [
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "multipleOf",
  "default",
] as const;

export function sanitizeJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeJsonSchema);
  if (node !== null && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if ((UNSUPPORTED_KEYWORDS as readonly string[]).includes(k)) continue;
      out[k] = sanitizeJsonSchema(v);
    }
    return out;
  }
  return node;
}

export class FmapiClient {
  constructor(
    private readonly cfg: FmapiConfig,
    private readonly log: LlmCallLogger = () => {},
  ) {}

  private async client(): Promise<OpenAI> {
    return new OpenAI({
      baseURL: `${this.cfg.host}/serving-endpoints`,
      apiKey: await this.cfg.apiKeyProvider(),
    });
  }

  /**
   * Chat with a zod-enforced structured output. Returns the parsed, validated
   * object. Throws on schema violation — callers treat that as an LLM error.
   */
  async structured<S extends z.ZodTypeAny>(opts: {
    purpose: string;
    system: string;
    user: string;
    schema: S;
    schemaName: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<z.infer<S>> {
    const started = Date.now();
    const client = await this.client();
    const jsonSchema = sanitizeJsonSchema(
      zodToJsonSchema(opts.schema, { target: "openAi", $refStrategy: "none" }),
    );
    let responseText = "";
    let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
    try {
      const res = await client.chat.completions.create({
        model: this.cfg.endpoint,
        temperature: opts.temperature ?? 0,
        max_tokens: opts.maxTokens ?? 8192,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: opts.schemaName, schema: jsonSchema as Record<string, unknown>, strict: true },
        },
      });
      responseText = res.choices[0]?.message?.content ?? "";
      usage = res.usage;
      const parsed = opts.schema.parse(JSON.parse(responseText));
      await this.log(this.meta(opts, responseText, usage, started, "ok"));
      return parsed;
    } catch (err) {
      await this.log(this.meta(opts, responseText, usage, started, "error"));
      throw err;
    }
  }

  private meta(
    opts: { purpose: string; system: string; user: string },
    responseText: string,
    usage: { prompt_tokens?: number; completion_tokens?: number } | undefined,
    started: number,
    status: "ok" | "error",
  ): LlmCallMeta {
    const CAP = 32 * 1024;
    return {
      purpose: opts.purpose,
      endpoint: this.cfg.endpoint,
      requestChars: opts.system.length + opts.user.length,
      responseChars: responseText.length,
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: usage?.completion_tokens ?? null,
      latencyMs: Date.now() - started,
      status,
      requestText: `[system]\n${opts.system}\n\n[user]\n${opts.user}`.slice(0, CAP),
      responseText: responseText.slice(0, CAP) || null,
    };
  }
}
