import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { loadConfig, type RuntimeConfig } from "./config.js";
import { registerAuthPlugin } from "./auth/auth-plugin.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerCategoryRoutes } from "./routes/categories.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerModerationRoutes } from "./routes/moderation.js";
import { registerRoomRoutes } from "./routes/rooms.js";
import { registerUserRoutes } from "./routes/users.js";

type BuildServerOptions = {
  config?: RuntimeConfig;
};

export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const app = Fastify({
    logger: {
      level: config.logLevel
    }
  });

  await app.register(cors, {
    origin: config.corsOrigin,
    credentials: true
  });
  await app.register(cookie, {
    secret: config.sessionSecret
  });

  registerAuthPlugin(app, config);

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ error }, "Unhandled backend error");

    return reply.status(500).send({
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "The backend runtime hit an unexpected error."
      }
    });
  });

  app.setNotFoundHandler((request, reply) => {
    request.log.warn({ method: request.method, url: request.url }, "Route not found");

    return reply.status(404).send({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "The requested route does not exist."
      }
    });
  });

  registerHealthRoutes(app, config);
  registerAuthRoutes(app, config);
  registerUserRoutes(app);
  registerCategoryRoutes(app);
  registerRoomRoutes(app, config);
  registerModerationRoutes(app);
  registerAdminRoutes(app);

  return app;
}
