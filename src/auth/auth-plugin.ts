import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RuntimeConfig } from "../config.js";
import { sendError } from "../lib/http.js";
import { AUTH_COOKIE_NAME, type AuthUser } from "./auth-types.js";
import { findAuthUserById, verifyAuthToken } from "./auth-service.js";

declare module "fastify" {
  interface FastifyRequest {
    authUser: AuthUser | null;
  }

  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export function registerAuthPlugin(app: FastifyInstance, config: RuntimeConfig) {
  app.decorateRequest("authUser", null);

  app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies[AUTH_COOKIE_NAME];

    if (!token) {
      sendError(reply, 401, "AUTH_REQUIRED", "Log in to continue.");
      return;
    }

    try {
      const payload = verifyAuthToken(token, config);
      const user = await findAuthUserById(payload.sub);

      if (!user) {
        sendError(reply, 401, "AUTH_REQUIRED", "Log in to continue.");
        return;
      }

      if (user.accountState === "restricted") {
        sendError(reply, 403, "ACCOUNT_RESTRICTED", "This account is currently restricted.");
        return;
      }

      if (user.accountState === "suspended") {
        sendError(reply, 403, "ACCOUNT_SUSPENDED", "This account is currently suspended.");
        return;
      }

      if (user.accountState === "banned") {
        sendError(reply, 403, "ACCOUNT_BANNED", "This account is banned.");
        return;
      }

      request.authUser = user;
    } catch (error) {
      request.log.warn({ error }, "Auth token validation failed");
      sendError(reply, 401, "AUTH_REQUIRED", "Log in to continue.");
    }
  });
}
