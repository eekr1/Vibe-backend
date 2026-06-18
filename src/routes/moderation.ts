import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { sendError, sendOk } from "../lib/http.js";
import { createRateLimiter, enforceRateLimit } from "../lib/rate-limit.js";
import { toModerationActionResponse, toReportResponse } from "../moderation/moderation-presenter.js";
import { roomRealtimeBus } from "../rooms/room-realtime-bus.js";

const roomParamsSchema = z.object({
  roomId: z.string().trim().min(1)
});

const moderationActionSchema = z.object({
  actionType: z.enum(["kick", "ban"]),
  reason: z.string().trim().max(280).optional(),
  targetUserId: z.string().trim().min(1)
});

const reportCreateSchema = z.object({
  details: z.string().trim().max(1000).optional(),
  reason: z.enum([
    "harassment",
    "hate_speech",
    "spam",
    "inappropriate_room_title",
    "abusive_behavior",
    "harmful_content",
    "impersonation",
    "other"
  ]),
  roomId: z.string().trim().min(1).optional(),
  targetId: z.string().trim().min(1),
  targetType: z.enum(["room", "user", "message"])
});

const reportCreateRateLimiter = createRateLimiter({
  limit: 10,
  name: "report.create",
  windowMs: 10 * 60 * 1000
});

async function findRoom(roomId: string) {
  return prisma.room.findFirst({
    where: {
      id: roomId,
      state: {
        not: "deleted"
      }
    }
  });
}

export function registerModerationRoutes(app: FastifyInstance) {
  app.post("/api/rooms/:roomId/moderation/actions", { preHandler: app.authenticate }, async (request, reply) => {
    const parsedParams = roomParamsSchema.safeParse(request.params);
    const parsedBody = moderationActionSchema.safeParse(request.body);

    if (!parsedParams.success) {
      return sendError(reply, 400, "VALIDATION_FAILED", "Invalid room id.", parsedParams.error.issues);
    }

    if (!parsedBody.success) {
      request.log.warn({ issues: parsedBody.error.issues }, "Moderation action validation failed");
      return sendError(reply, 400, "VALIDATION_FAILED", "Check the moderation action fields.", parsedBody.error.issues);
    }

    if (!request.authUser) {
      return sendError(reply, 401, "AUTH_REQUIRED", "Log in to continue.");
    }

    const room = await findRoom(parsedParams.data.roomId);

    if (!room) {
      return sendError(reply, 404, "NOT_FOUND", "Room not found.");
    }

    if (room.state !== "live") {
      return sendError(reply, 409, "ROOM_NOT_LIVE", "Moderation actions require a live room.");
    }

    if (room.hostUserId !== request.authUser.id) {
      return sendError(reply, 403, "HOST_REQUIRED", "Only the room host can moderate participants.");
    }

    if (parsedBody.data.targetUserId === request.authUser.id) {
      return sendError(reply, 400, "MODERATION_TARGET_INVALID", "The host cannot moderate themselves.");
    }

    const targetParticipant = await prisma.roomParticipant.findUnique({
      include: {
        user: true
      },
      where: {
        roomId_userId: {
          roomId: room.id,
          userId: parsedBody.data.targetUserId
        }
      }
    });

    if (!targetParticipant || targetParticipant.role === "host") {
      return sendError(reply, 400, "MODERATION_TARGET_INVALID", "Choose a valid room participant.");
    }

    if (parsedBody.data.actionType === "kick" && targetParticipant.state !== "active") {
      return sendError(reply, 409, "MODERATION_TARGET_INVALID", "Only active participants can be kicked.");
    }

    const now = new Date();
    const reason = parsedBody.data.reason?.trim() || null;
    const nextParticipantState = parsedBody.data.actionType === "ban" ? "banned" : "kicked";

    const action = await prisma.$transaction(async (transaction) => {
      await transaction.roomParticipant.update({
        data: {
          leftAt: now,
          state: nextParticipantState
        },
        where: {
          roomId_userId: {
            roomId: room.id,
            userId: parsedBody.data.targetUserId
          }
        }
      });

      return transaction.moderationAction.create({
        data: {
          actionType: parsedBody.data.actionType,
          actorUserId: request.authUser!.id,
          reason,
          roomId: room.id,
          targetUserId: parsedBody.data.targetUserId
        },
        include: {
          actor: true,
          target: true
        }
      });
    });
    const actionResponse = toModerationActionResponse(action);

    request.log.info(
      {
        actionId: action.id,
        actionType: action.actionType,
        roomId: room.id,
        targetUserId: parsedBody.data.targetUserId
      },
      "Room moderation action applied"
    );

    roomRealtimeBus.emitEvent("moderation.action.applied", {
      action: actionResponse,
      actionType: action.actionType,
      actorUserId: request.authUser.id,
      createdAt: action.createdAt.toISOString(),
      reason,
      roomId: room.id,
      targetUserId: parsedBody.data.targetUserId
    });

    return sendOk(reply, { action: actionResponse });
  });

  app.post("/api/reports", { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = reportCreateSchema.safeParse(request.body);

    if (!parsed.success) {
      request.log.warn({ issues: parsed.error.issues }, "Report creation validation failed");
      return sendError(reply, 400, "VALIDATION_FAILED", "Check the report fields.", parsed.error.issues);
    }

    if (!request.authUser) {
      return sendError(reply, 401, "AUTH_REQUIRED", "Log in to continue.");
    }

    if (
      enforceRateLimit(
        request,
        reply,
        reportCreateRateLimiter,
        request.authUser.id,
        "Too many reports submitted too quickly. Please wait a bit before sending another report."
      )
    ) {
      return reply;
    }

    let roomId: string | null = parsed.data.roomId ?? null;
    let targetUserId: string | null = null;
    let messageId: string | null = null;

    if (parsed.data.targetType === "room") {
      const room = await findRoom(parsed.data.targetId);

      if (!room) {
        return sendError(reply, 400, "REPORT_TARGET_INVALID", "Choose a valid room to report.");
      }

      roomId = room.id;
    }

    if (parsed.data.targetType === "user") {
      const user = await prisma.user.findUnique({
        where: { id: parsed.data.targetId }
      });

      if (!user) {
        return sendError(reply, 400, "REPORT_TARGET_INVALID", "Choose a valid user to report.");
      }

      if (roomId) {
        const room = await findRoom(roomId);

        if (!room) {
          return sendError(reply, 400, "REPORT_TARGET_INVALID", "Choose a valid room context.");
        }
      }

      targetUserId = user.id;
    }

    if (parsed.data.targetType === "message") {
      const message = await prisma.message.findUnique({
        where: { id: parsed.data.targetId }
      });

      if (!message) {
        return sendError(reply, 400, "REPORT_TARGET_INVALID", "Choose a valid message to report.");
      }

      messageId = message.id;
      roomId = message.roomId;
      targetUserId = message.userId;
    }

    const report = await prisma.report.create({
      data: {
        details: parsed.data.details?.trim() || null,
        messageId,
        reason: parsed.data.reason,
        reporterUserId: request.authUser.id,
        roomId,
        targetId: parsed.data.targetId,
        targetType: parsed.data.targetType,
        targetUserId
      },
      include: {
        reporter: true,
        targetUser: true
      }
    });

    request.log.info(
      {
        reportId: report.id,
        roomId: report.roomId,
        targetId: report.targetId,
        targetType: report.targetType
      },
      "Safety report created"
    );

    return sendOk(reply, { report: toReportResponse(report) }, 201);
  });
}
