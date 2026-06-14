import type { FastifyInstance } from "fastify";
import { toSafeConfig, type RuntimeConfig } from "../config.js";

export function registerHealthRoutes(app: FastifyInstance, config: RuntimeConfig) {
  function getHealthPayload() {
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
  }

  function getReadyPayload() {
    return {
      ok: true,
      data: {
        environment: config.nodeEnv,
        service: "vibehall-backend",
        status: "ready",
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.round(process.uptime())
      }
    };
  }

  app.get("/api/health", async () => getHealthPayload());
  app.get("/health", async () => getHealthPayload());
  app.get("/api/ready", async () => getReadyPayload());
  app.get("/ready", async () => getReadyPayload());

  app.get("/api/debug/config", async () => {
    return {
      ok: true,
      data: toSafeConfig(config)
    };
  });
}
