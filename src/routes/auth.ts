import type { FastifyInstance, FastifyReply } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { RuntimeConfig } from "../config.js";
import { prisma } from "../db/prisma.js";
import { sendError, sendOk } from "../lib/http.js";
import { AUTH_COOKIE_NAME } from "../auth/auth-types.js";
import {
  getSessionMaxAgeSeconds,
  hashPassword,
  signAuthToken,
  toAuthUser,
  verifyPassword
} from "../auth/auth-service.js";

const signupSchema = z.object({
  displayName: z.string().trim().min(2).max(48),
  email: z.email().trim().toLowerCase(),
  password: z.string().min(8).max(128),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(24)
    .regex(/^[a-z0-9_]+$/)
});

const loginSchema = z.object({
  emailOrUsername: z.string().trim().min(3).max(120),
  password: z.string().min(1).max(128)
});

function setSessionCookie(reply: FastifyReply, token: string, config: RuntimeConfig) {
  reply.setCookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    maxAge: getSessionMaxAgeSeconds(),
    path: "/",
    sameSite: config.nodeEnv === "production" ? "none" : "lax",
    secure: config.nodeEnv === "production"
  });
}

function clearSessionCookie(reply: FastifyReply, config: RuntimeConfig) {
  reply.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    path: "/",
    sameSite: config.nodeEnv === "production" ? "none" : "lax",
    secure: config.nodeEnv === "production"
  });
}

function accountErrorCode(accountState: string) {
  if (accountState === "restricted") {
    return "ACCOUNT_RESTRICTED" as const;
  }

  if (accountState === "suspended") {
    return "ACCOUNT_SUSPENDED" as const;
  }

  if (accountState === "banned") {
    return "ACCOUNT_BANNED" as const;
  }

  return null;
}

export function registerAuthRoutes(app: FastifyInstance, config: RuntimeConfig) {
  app.post("/api/auth/signup", async (request, reply) => {
    const parsed = signupSchema.safeParse(request.body);

    if (!parsed.success) {
      request.log.warn({ issues: parsed.error.issues }, "Signup validation failed");
      return sendError(reply, 400, "VALIDATION_FAILED", "Check the signup fields.", parsed.error.issues);
    }

    try {
      const passwordHash = await hashPassword(parsed.data.password);
      const user = await prisma.user.create({
        data: {
          displayName: parsed.data.displayName,
          email: parsed.data.email,
          passwordHash,
          username: parsed.data.username
        }
      });
      const token = signAuthToken(user.id, config);

      setSessionCookie(reply, token, config);
      request.log.info({ userId: user.id }, "Signup completed");

      return sendOk(reply, { user: toAuthUser(user) }, 201);
    } catch (error) {
      request.log.warn({ error }, "Signup failed");

      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return sendError(reply, 409, "CONFLICT", "Email or username is already in use.");
      }

      return sendError(reply, 500, "INTERNAL_ERROR", "Signup failed.");
    }
  });

  app.post("/api/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);

    if (!parsed.success) {
      request.log.warn({ issues: parsed.error.issues }, "Login validation failed");
      return sendError(reply, 400, "VALIDATION_FAILED", "Check the login fields.", parsed.error.issues);
    }

    const lookup = parsed.data.emailOrUsername.toLowerCase();
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: lookup }, { username: lookup }]
      }
    });

    if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      request.log.warn({ lookup }, "Login failed");
      return sendError(reply, 401, "INVALID_CREDENTIALS", "Invalid email, username, or password.");
    }

    const stateError = accountErrorCode(user.accountState);

    if (stateError) {
      return sendError(reply, 403, stateError, "This account cannot currently log in.");
    }

    const token = signAuthToken(user.id, config);
    setSessionCookie(reply, token, config);
    request.log.info({ userId: user.id }, "Login completed");

    return sendOk(reply, { user: toAuthUser(user) });
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    clearSessionCookie(reply, config);
    return sendOk(reply, { loggedOut: true });
  });

  app.get("/api/auth/me", { preHandler: app.authenticate }, async (request, reply) => {
    return sendOk(reply, { user: request.authUser });
  });
}
