import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { sendError, sendOk } from "../lib/http.js";
import { toAuthUser } from "../auth/auth-service.js";

const avatarUrlSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue : null;
}, z.url().nullable().optional());

const profileUpdateSchema = z.object({
  avatarUrl: avatarUrlSchema,
  displayName: z.string().trim().min(2).max(48).optional()
});

function isRecordNotFound(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2025"
  );
}

export function registerUserRoutes(app: FastifyInstance) {
  app.get("/api/users/me/profile", { preHandler: app.authenticate }, async (request, reply) => {
    return sendOk(reply, { user: request.authUser });
  });

  app.patch("/api/users/me/profile", { preHandler: app.authenticate }, async (request, reply) => {
    request.log.info({ userId: request.authUser?.id }, "Profile update requested");

    const parsed = profileUpdateSchema.safeParse(request.body);

    if (!parsed.success) {
      request.log.warn(
        { issues: parsed.error.issues, userId: request.authUser?.id },
        "Profile update validation failed"
      );
      return sendError(reply, 400, "VALIDATION_FAILED", "Check the profile fields.", parsed.error.issues);
    }

    if (!request.authUser) {
      return sendError(reply, 401, "AUTH_REQUIRED", "Log in to continue.");
    }

    try {
      const user = await prisma.user.update({
        data: parsed.data,
        where: { id: request.authUser.id }
      });

      request.log.info({ userId: user.id }, "Profile updated");

      return sendOk(reply, { user: toAuthUser(user) });
    } catch (error) {
      request.log.error({ error, userId: request.authUser.id }, "Profile update failed");

      if (isRecordNotFound(error)) {
        return sendError(reply, 404, "NOT_FOUND", "User not found.");
      }

      throw error;
    }
  });
}
