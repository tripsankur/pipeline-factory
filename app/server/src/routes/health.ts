import type { FastifyInstance } from "fastify";

export interface HealthInfo {
  store: "postgres" | "warehouse";
  pgHostPresent: boolean;
  pgError: string | null;
}

export function registerHealthRoutes(app: FastifyInstance, info?: () => HealthInfo): void {
  app.get("/api/health", async () => ({
    status: "ok",
    app: "pipeline-factory",
    ts: new Date().toISOString(),
    ...(info ? info() : {}),
  }));
}
