import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { sendError, sendOk } from "../lib/http.js";
import { toAuthUser } from "../auth/auth-service.js";

const profileUpdateSchema = z.object({
  avatarUrl: z.url().nullable().optional(),
  displayName: z.string().trim().min(2).max(48).optional()
});

export function registerUserRoutes(app: FastifyInstance) {
  app.get("/api/users/me/profile", { preHandler: app.authenticate }, async (request, reply) => {
    return sendOk(reply, { user: request.authUser });
  });

  app.patch("/api/users/me/profile", { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = profileUpdateSchema.safeParse(request.body);

    if (!parsed.success) {
      request.log.warn({ issues: parsed.error.issues }, "Profile update validation failed");
      return sendError(reply, 400, "VALIDATION_FAILED", "Check the profile fields.", parsed.error.issues);
    }

    if (!request.authUser) {
      return sendError(reply, 401, "AUTH_REQUIRED", "Log in to continue.");
    }

    const user = await prisma.user.update({
      data: parsed.data,
      where: { id: request.authUser.id }
    });

    request.log.info({ userId: user.id }, "Profile updated");

    return sendOk(reply, { user: toAuthUser(user) });
  });
}
