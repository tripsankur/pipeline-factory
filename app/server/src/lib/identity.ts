import type { FastifyRequest } from "fastify";

/**
 * Approver identity from Databricks Apps forwarded headers (handoff §7 screen 3).
 * Local dev: PF_DEV_USER_EMAIL stub.
 */
export interface UserIdentity {
  email: string;
  source: "forwarded-headers" | "dev-stub" | "anonymous";
}

export function identityFrom(req: FastifyRequest, devFallback: string): UserIdentity {
  const email =
    (req.headers["x-forwarded-email"] as string | undefined) ??
    (req.headers["x-forwarded-preferred-username"] as string | undefined);
  if (email) return { email, source: "forwarded-headers" };
  if (devFallback) return { email: devFallback, source: "dev-stub" };
  return { email: "unknown@local", source: "anonymous" };
}
