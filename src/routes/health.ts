import type { FastifyInstance } from "fastify";
import { toSafeConfig, type RuntimeConfig } from "../config.js";

export function registerHealthRoutes(app: FastifyInstance, config: RuntimeConfig) {
  app.get("/api/health", async () => {
    return {
      ok: true,
      data: {
        environment: config.nodeEnv,
        service: "vibehall-backend",
        status: "ok",
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.round(process.uptime())
      }
    };
  });

  app.get("/api/debug/config", async () => {
    return {
      ok: true,
      data: toSafeConfig(config)
    };
  });
}
