import type { FastifyInstance, FastifyReply } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { RuntimeConfig } from "../config.js";
import { prisma } from "../db/prisma.js";
import { sendError, sendOk } from "../lib/http.js";
import { createRateLimiter, enforceRateLimit, getRateLimitIdentity } from "../lib/rate-limit.js";
import { AUTH_COOKIE_NAME } from "../auth/auth-types.js";
import {
  getSessionMaxAgeSeconds,
  hashPassword,
  signAuthToken,
  toAuthUser,
  verifyPassword
} from "../auth/auth-service.js";
import {
  createPasswordResetExpiresAt,
  createPasswordResetToken,
  createPasswordResetUrl,
  hashPasswordResetToken,
  sendPasswordResetEmail
} from "../auth/password-reset-service.js";

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

const passwordResetRequestSchema = z.object({
  email: z.email().trim().toLowerCase()
});

const passwordResetConfirmSchema = z.object({
  password: z.string().min(8).max(128),
  token: z.string().trim().min(24).max(256)
});

const signupRateLimiter = createRateLimiter({
  limit: 5,
  name: "auth.signup",
  windowMs: 10 * 60 * 1000
});
const loginRateLimiter = createRateLimiter({
  limit: 8,
  name: "auth.login",
  windowMs: 5 * 60 * 1000
});
const passwordResetRequestRateLimiter = createRateLimiter({
  limit: 4,
  name: "auth.password_reset.request",
  windowMs: 15 * 60 * 1000
});
const passwordResetConfirmRateLimiter = createRateLimiter({
  limit: 8,
  name: "auth.password_reset.confirm",
  windowMs: 15 * 60 * 1000
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

    if (
      enforceRateLimit(
        request,
        reply,
        signupRateLimiter,
        getRateLimitIdentity(request),
        "Too many signup attempts. Please wait a bit and try again."
      )
    ) {
      return reply;
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

    if (
      enforceRateLimit(
        request,
        reply,
        loginRateLimiter,
        `${getRateLimitIdentity(request)}:${lookup}`,
        "Too many login attempts. Please wait a bit and try again."
      )
    ) {
      return reply;
    }

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

  app.post("/api/auth/password-reset/request", async (request, reply) => {
    const parsed = passwordResetRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      request.log.warn({ issues: parsed.error.issues }, "Password reset request validation failed");
      return sendError(reply, 400, "VALIDATION_FAILED", "Enter a valid email address.", parsed.error.issues);
    }

    const safeResponse = {
      message: "If an account exists for that email, a password reset link will be sent."
    };

    if (
      enforceRateLimit(
        request,
        reply,
        passwordResetRequestRateLimiter,
        `${getRateLimitIdentity(request)}:${parsed.data.email}`,
        "Too many password reset requests. Please wait a bit and try again."
      )
    ) {
      return reply;
    }

    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email }
    });

    if (!user) {
      request.log.info({ email: parsed.data.email }, "Password reset requested for unknown email");
      return sendOk(reply, safeResponse);
    }

    const { token, tokenHash } = createPasswordResetToken();
    const expiresAt = createPasswordResetExpiresAt();

    await prisma.passwordResetToken.create({
      data: {
        expiresAt,
        tokenHash,
        userId: user.id
      }
    });

    const resetUrl = createPasswordResetUrl(config, token);

    try {
      await sendPasswordResetEmail(config, request.log, {
        email: user.email,
        resetUrl,
        username: user.username
      });
    } catch {
      return sendError(reply, 500, "INTERNAL_ERROR", "Password reset email could not be sent.");
    }

    request.log.info({ userId: user.id }, "Password reset requested");
    return sendOk(reply, safeResponse);
  });

  app.post("/api/auth/password-reset/confirm", async (request, reply) => {
    const parsed = passwordResetConfirmSchema.safeParse(request.body);

    if (!parsed.success) {
      request.log.warn({ issues: parsed.error.issues }, "Password reset confirm validation failed");
      return sendError(reply, 400, "VALIDATION_FAILED", "Check the reset fields.", parsed.error.issues);
    }

    if (
      enforceRateLimit(
        request,
        reply,
        passwordResetConfirmRateLimiter,
        getRateLimitIdentity(request),
        "Too many password reset attempts. Please wait a bit and try again."
      )
    ) {
      return reply;
    }

    const tokenHash = hashPasswordResetToken(parsed.data.token);
    const resetToken = await prisma.passwordResetToken.findUnique({
      include: { user: true },
      where: { tokenHash }
    });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= new Date()) {
      request.log.warn({ tokenFound: Boolean(resetToken) }, "Password reset token invalid");
      return sendError(reply, 400, "INVALID_RESET_TOKEN", "This reset link is invalid or expired.");
    }

    const stateError = accountErrorCode(resetToken.user.accountState);

    if (stateError) {
      return sendError(reply, 403, stateError, "This account cannot currently reset its password.");
    }

    const passwordHash = await hashPassword(parsed.data.password);
    await prisma.$transaction([
      prisma.user.update({
        data: { passwordHash },
        where: { id: resetToken.userId }
      }),
      prisma.passwordResetToken.update({
        data: { usedAt: new Date() },
        where: { id: resetToken.id }
      }),
      prisma.passwordResetToken.updateMany({
        data: { usedAt: new Date() },
        where: {
          id: { not: resetToken.id },
          usedAt: null,
          userId: resetToken.userId
        }
      })
    ]);

    request.log.info({ userId: resetToken.userId }, "Password reset completed");
    return sendOk(reply, { reset: true });
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    clearSessionCookie(reply, config);
    return sendOk(reply, { loggedOut: true });
  });

  app.get("/api/auth/me", { preHandler: app.authenticate }, async (request, reply) => {
    return sendOk(reply, { user: request.authUser });
  });
}
