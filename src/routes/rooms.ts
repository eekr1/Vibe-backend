import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AUTH_COOKIE_NAME, type AuthUser } from "../auth/auth-types.js";
import { findAuthUserById, hashPassword, verifyAuthToken, verifyPassword } from "../auth/auth-service.js";
import type { RuntimeConfig } from "../config.js";
import { prisma } from "../db/prisma.js";
import { sendError, sendOk } from "../lib/http.js";
import { getMessageSafetyIssue, getRoomTitleSafetyIssue, normalizeSafetyText } from "../lib/input-safety.js";
import { createRateLimiter, enforceRateLimit, getRateLimitIdentity } from "../lib/rate-limit.js";
import { parseYouTubeSource } from "../media/youtube.js";
import { roomRealtimeBus } from "../rooms/room-realtime-bus.js";
import { toMessageResponse, toParticipantResponse, toRoomResponse } from "../rooms/room-presenter.js";

const roomInclude = {
  _count: {
    select: {
      participants: {
        where: {
          state: "active"
        }
      }
    }
  },
  category: true,
  host: true
} as const;

const participantInclude = {
  user: true
} as const;

const discoverQuerySchema = z.object({
  categoryId: z.string().trim().min(1).optional(),
  categorySlug: z.string().trim().min(1).optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(48).optional(),
  search: z.string().trim().max(80).optional(),
  sort: z.enum(["active", "newest", "nearly-full"]).optional()
});

const createRoomSchema = z
  .object({
    categoryId: z.string().trim().min(1),
    participantLimit: z.coerce.number().int().min(2).max(50),
    privatePassword: z.string().min(4).max(80).optional(),
    sourceUrl: z.string().trim().min(1).max(2048),
    title: z.string().trim().min(3).max(96),
    visibility: z.enum(["public", "private"])
  })
  .superRefine((input, context) => {
    if (input.visibility === "private" && !input.privatePassword) {
      context.addIssue({
        code: "custom",
        message: "Private rooms need a room password.",
        path: ["privatePassword"]
      });
    }
  });

const privateRoomAccessSchema = z.object({
  password: z.string().min(1)
});

const messageCreateSchema = z.object({
  body: z.string().trim().min(1).max(500)
});

const messageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional()
});

const roomParamsSchema = z.object({
  roomId: z.string().trim().min(1)
});

const roomCreateRateLimiter = createRateLimiter({
  limit: 6,
  name: "room.create",
  windowMs: 15 * 60 * 1000
});
const privatePasswordRateLimiter = createRateLimiter({
  limit: 8,
  name: "room.private_password",
  windowMs: 10 * 60 * 1000
});
const restMessageRateLimiter = createRateLimiter({
  limit: 8,
  name: "room.message.rest",
  windowMs: 10 * 1000
});

function slugify(title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return slug || "room";
}

function makeRoomSlug(title: string) {
  return `${slugify(title)}-${randomUUID().slice(0, 8)}`;
}

function decodeDiscoverCursor(cursor?: string) {
  if (!cursor) {
    return 0;
  }

  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const offset = Number(decoded.replace("offset:", ""));

    return Number.isInteger(offset) && offset >= 0 ? offset : 0;
  } catch {
    return 0;
  }
}

function encodeDiscoverCursor(offset: number) {
  return Buffer.from(`offset:${offset}`, "utf8").toString("base64url");
}

function getDiscoverOrderValue(room: RoomForResponse, sort: "active" | "newest" | "nearly-full") {
  if (sort === "active") {
    return room._count?.participants ?? 0;
  }

  if (sort === "nearly-full") {
    return (room._count?.participants ?? 0) / Math.max(room.participantLimit, 1);
  }

  return room.createdAt.getTime();
}

function sortDiscoverRooms(rooms: RoomForResponse[], sort: "active" | "newest" | "nearly-full") {
  return [...rooms].sort((left, right) => {
    const valueDifference = getDiscoverOrderValue(right, sort) - getDiscoverOrderValue(left, sort);

    if (valueDifference !== 0) {
      return valueDifference;
    }

    return right.createdAt.getTime() - left.createdAt.getTime();
  });
}

function toDiscoverRoomCard(room: RoomForResponse) {
  const activeParticipantCount = room._count?.participants ?? 0;

  return {
    ...toRoomResponse(room),
    card: {
      capacityLabel: `${activeParticipantCount}/${room.participantLimit}`,
      isNearlyFull: activeParticipantCount >= Math.max(room.participantLimit - 1, 1),
      searchText: `${room.title} ${room.host.displayName} ${room.category.name}`,
      thumbnailAlt: `${room.title} YouTube thumbnail`
    }
  };
}

async function findRoomForResponse(roomId: string) {
  return prisma.room.findFirst({
    include: roomInclude,
    where: {
      id: roomId,
      state: {
        not: "deleted"
      }
    }
  });
}

async function endRoom(roomId: string) {
  const endedAt = new Date();

  return prisma.$transaction(async (transaction) => {
    await transaction.roomParticipant.updateMany({
      data: {
        leftAt: endedAt,
        state: "left"
      },
      where: {
        roomId,
        state: "active"
      }
    });

    return transaction.room.update({
      data: {
        endedAt,
        state: "ended"
      },
      include: roomInclude,
      where: { id: roomId }
    });
  });
}

type RoomForResponse = NonNullable<Awaited<ReturnType<typeof findRoomForResponse>>>;

async function findParticipant(roomId: string, userId: string) {
  return prisma.roomParticipant.findUnique({
    include: participantInclude,
    where: {
      roomId_userId: {
        roomId,
        userId
      }
    }
  });
}

async function activateParticipant(room: RoomForResponse, userId: string) {
  const existingParticipant = await findParticipant(room.id, userId);

  if (existingParticipant?.state === "active") {
    return {
      participant: existingParticipant,
      status: "joined" as const
    };
  }

  if (existingParticipant?.state === "banned") {
    return {
      participant: existingParticipant,
      status: "denied" as const
    };
  }

  const role = room.hostUserId === userId ? "host" : "participant";

  if (role !== "host" && (room._count?.participants ?? 0) >= room.participantLimit) {
    return {
      participant: null,
      status: "full" as const
    };
  }

  const participant = await prisma.roomParticipant.upsert({
    create: {
      role,
      roomId: room.id,
      state: "active",
      userId
    },
    include: participantInclude,
    update: {
      joinedAt: new Date(),
      leftAt: null,
      role,
      state: "active"
    },
    where: {
      roomId_userId: {
        roomId: room.id,
        userId
      }
    }
  });

  return {
    participant,
    status: "joined" as const
  };
}

async function findActiveParticipant(roomId: string, userId: string) {
  const participant = await findParticipant(roomId, userId);

  return participant?.state === "active" ? participant : null;
}

async function resolveOptionalAuthUser(request: FastifyRequest, config: RuntimeConfig) {
  const token = request.cookies[AUTH_COOKIE_NAME];

  if (!token) {
    return null;
  }

  try {
    const payload = verifyAuthToken(token, config);
    return findAuthUserById(payload.sub);
  } catch (error) {
    request.log.warn({ error }, "Optional room access auth token validation failed");
    return null;
  }
}

function sendAccessStatus(
  reply: Parameters<typeof sendOk>[0],
  input: {
    denialReason: null | string;
    requiresAuth: boolean;
    requiresPassword: boolean;
    room: NonNullable<Awaited<ReturnType<typeof findRoomForResponse>>>;
    status: "allowed" | "denied" | "password_required";
  }
) {
  return sendOk(reply, {
    denialReason: input.denialReason,
    requiresAuth: input.requiresAuth,
    requiresPassword: input.requiresPassword,
    room: toRoomResponse(input.room),
    status: input.status
  });
}

function getAccountDenialReason(authUser: AuthUser | null) {
  if (!authUser) {
    return "AUTH_REQUIRED";
  }

  if (authUser.accountState === "restricted") {
    return "ACCOUNT_RESTRICTED";
  }

  if (authUser.accountState === "suspended") {
    return "ACCOUNT_SUSPENDED";
  }

  if (authUser.accountState === "banned") {
    return "ACCOUNT_BANNED";
  }

  return null;
}

export function registerRoomRoutes(app: FastifyInstance, config: RuntimeConfig) {
  app.get("/api/discover/rooms", async (request, reply) => {
    const parsed = discoverQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      request.log.warn({ issues: parsed.error.issues }, "Discover query validation failed");
      return sendError(reply, 400, "VALIDATION_FAILED", "Check the discover filters.", parsed.error.issues);
    }

    const limit = parsed.data.limit ?? 24;
    const offset = decodeDiscoverCursor(parsed.data.cursor);
    const sort = parsed.data.sort ?? "newest";
    const where: Prisma.RoomWhereInput = {
      state: "live",
      visibility: "public"
    };

    if (parsed.data.categoryId || parsed.data.categorySlug) {
      where.category = {
        ...(parsed.data.categoryId ? { id: parsed.data.categoryId } : {}),
        ...(parsed.data.categorySlug ? { slug: parsed.data.categorySlug } : {})
      };
    }

    if (parsed.data.search) {
      where.OR = [
        {
          title: {
            contains: parsed.data.search,
            mode: "insensitive"
          }
        },
        {
          host: {
            displayName: {
              contains: parsed.data.search,
              mode: "insensitive"
            }
          }
        },
        {
          host: {
            username: {
              contains: parsed.data.search,
              mode: "insensitive"
            }
          }
        },
        {
          category: {
            name: {
              contains: parsed.data.search,
              mode: "insensitive"
            }
          }
        }
      ];
    }

    const rooms = await prisma.room.findMany({
      include: roomInclude,
      orderBy: { createdAt: "desc" },
      take: 160,
      where
    });
    const sortedRooms = sortDiscoverRooms(rooms, sort);
    const visibleRooms = sortedRooms.slice(offset, offset + limit);
    const nextOffset = offset + visibleRooms.length;
    const nextCursor = nextOffset < sortedRooms.length ? encodeDiscoverCursor(nextOffset) : null;

    request.log.info(
      {
        categoryId: parsed.data.categoryId,
        categorySlug: parsed.data.categorySlug,
        resultCount: visibleRooms.length,
        search: parsed.data.search,
        sort
      },
      "Discover rooms queried"
    );

    return sendOk(reply, {
      filters: {
        categoryId: parsed.data.categoryId ?? null,
        categorySlug: parsed.data.categorySlug ?? null,
        search: parsed.data.search ?? "",
        sort
      },
      nextCursor,
      rooms: visibleRooms.map(toDiscoverRoomCard)
    });
  });

  app.post("/api/rooms", { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = createRoomSchema.safeParse(request.body);

    if (!parsed.success) {
      request.log.warn({ issues: parsed.error.issues }, "Room creation validation failed");
      return sendError(reply, 400, "VALIDATION_FAILED", "Check the room fields.", parsed.error.issues);
    }

    if (!request.authUser) {
      return sendError(reply, 401, "AUTH_REQUIRED", "Log in to continue.");
    }

    const authUser = request.authUser;
    const title = normalizeSafetyText(parsed.data.title);
    const titleSafetyIssue = getRoomTitleSafetyIssue(title);

    if (titleSafetyIssue) {
      return sendError(reply, 400, "VALIDATION_FAILED", titleSafetyIssue);
    }

    if (
      enforceRateLimit(
        request,
        reply,
        roomCreateRateLimiter,
        authUser.id,
        "Too many rooms created too quickly. Please wait a bit before launching another room."
      )
    ) {
      return reply;
    }

    const mediaSource = parseYouTubeSource(parsed.data.sourceUrl);

    if (!mediaSource) {
      return sendError(
        reply,
        400,
        "VALIDATION_FAILED",
        "Use a valid YouTube video, shorts, live, embed, or youtu.be link."
      );
    }

    const category = await prisma.category.findFirst({
      where: {
        id: parsed.data.categoryId,
        isActive: true
      }
    });

    if (!category) {
      return sendError(reply, 404, "NOT_FOUND", "Choose an active room category.");
    }

    const privatePasswordHash =
      parsed.data.visibility === "private" && parsed.data.privatePassword
        ? await hashPassword(parsed.data.privatePassword)
        : null;

    const room = await prisma.$transaction(async (transaction) => {
      const createdRoom = await transaction.room.create({
        data: {
          categoryId: category.id,
          hostUserId: authUser.id,
          participantLimit: parsed.data.participantLimit,
          privatePasswordHash,
          slug: makeRoomSlug(title),
          sourceProvider: mediaSource.provider,
          sourceThumbnailUrl: mediaSource.thumbnailUrl,
          sourceUrl: mediaSource.normalizedUrl,
          sourceVideoId: mediaSource.videoId,
          title,
          visibility: parsed.data.visibility
        }
      });

      await transaction.roomParticipant.create({
        data: {
          role: "host",
          roomId: createdRoom.id,
          userId: authUser.id
        }
      });

      return transaction.room.findUniqueOrThrow({
        include: roomInclude,
        where: { id: createdRoom.id }
      });
    });

    request.log.info(
      {
        hostUserId: authUser.id,
        roomId: room.id,
        visibility: room.visibility
      },
      "Room created and moved live"
    );

    return sendOk(reply, { room: toRoomResponse(room) }, 201);
  });

  app.get("/api/rooms/:roomId", { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = roomParamsSchema.safeParse(request.params);

    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_FAILED", "Invalid room id.", parsed.error.issues);
    }

    const room = await findRoomForResponse(parsed.data.roomId);

    if (!room) {
      return sendError(reply, 404, "NOT_FOUND", "Room not found.");
    }

    return sendOk(reply, { room: toRoomResponse(room) });
  });

  app.post("/api/rooms/:roomId/access/check", async (request, reply) => {
    const parsed = roomParamsSchema.safeParse(request.params);

    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_FAILED", "Invalid room id.", parsed.error.issues);
    }

    const room = await findRoomForResponse(parsed.data.roomId);

    if (!room) {
      return sendError(reply, 404, "NOT_FOUND", "Room not found.");
    }

    if (room.state === "ended") {
      return sendAccessStatus(reply, {
        denialReason: "ROOM_NOT_LIVE",
        requiresAuth: false,
        requiresPassword: false,
        room,
        status: "denied"
      });
    }

    const authUser = await resolveOptionalAuthUser(request, config);
    const accountDenialReason = getAccountDenialReason(authUser);

    if (accountDenialReason) {
      return sendAccessStatus(reply, {
        denialReason: accountDenialReason,
        requiresAuth: !authUser,
        requiresPassword: false,
        room,
        status: "denied"
      });
    }

    const existingParticipant = authUser ? await findParticipant(room.id, authUser.id) : null;

    if (existingParticipant?.state === "banned") {
      return sendAccessStatus(reply, {
        denialReason: "ROOM_USER_BANNED",
        requiresAuth: false,
        requiresPassword: false,
        room,
        status: "denied"
      });
    }

    const activeParticipant = existingParticipant?.state === "active" ? existingParticipant : null;
    const activeParticipantCount = room._count?.participants ?? 0;

    if (!activeParticipant && authUser?.id !== room.hostUserId && activeParticipantCount >= room.participantLimit) {
      return sendAccessStatus(reply, {
        denialReason: "ROOM_FULL",
        requiresAuth: false,
        requiresPassword: false,
        room,
        status: "denied"
      });
    }

    if (authUser?.id === room.hostUserId) {
      return sendAccessStatus(reply, {
        denialReason: null,
        requiresAuth: false,
        requiresPassword: false,
        room,
        status: "allowed"
      });
    }

    if (room.visibility === "private") {
      return sendAccessStatus(reply, {
        denialReason: "ROOM_PRIVATE_PASSWORD_REQUIRED",
        requiresAuth: false,
        requiresPassword: true,
        room,
        status: "password_required"
      });
    }

    return sendAccessStatus(reply, {
      denialReason: null,
      requiresAuth: false,
      requiresPassword: false,
      room,
      status: "allowed"
    });
  });

  app.post("/api/rooms/:roomId/join", { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = roomParamsSchema.safeParse(request.params);

    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_FAILED", "Invalid room id.", parsed.error.issues);
    }

    if (!request.authUser) {
      return sendError(reply, 401, "AUTH_REQUIRED", "Log in to continue.");
    }

    const room = await findRoomForResponse(parsed.data.roomId);

    if (!room) {
      return sendError(reply, 404, "NOT_FOUND", "Room not found.");
    }

    if (room.state === "ended") {
      request.log.warn({ roomId: room.id, userId: request.authUser.id }, "Join blocked because room ended");
      return sendError(reply, 403, "ROOM_ENDED", "This room has ended.");
    }

    if (room.visibility === "private" && room.hostUserId !== request.authUser.id) {
      request.log.warn({ roomId: room.id, userId: request.authUser.id }, "Join blocked by private password gate");
      return sendError(reply, 403, "ROOM_PASSWORD_REQUIRED", "Enter the room password to join.");
    }

    const joinResult = await activateParticipant(room, request.authUser.id);

    if (joinResult.status === "full") {
      request.log.warn({ roomId: room.id, userId: request.authUser.id }, "Join blocked because room is full");
      return sendError(reply, 409, "ROOM_FULL", "This room is full.");
    }

    if (joinResult.status === "denied" || !joinResult.participant) {
      request.log.warn({ roomId: room.id, userId: request.authUser.id }, "Join blocked by participant state");
      if (joinResult.participant?.state === "banned") {
        return sendError(reply, 403, "ROOM_USER_BANNED", "You are banned from rejoining this room.");
      }

      return sendError(reply, 403, "ROOM_ACCESS_DENIED", "You cannot join this room.");
    }

    const refreshedRoom = await findRoomForResponse(room.id);

    request.log.info(
      { participantId: joinResult.participant.id, roomId: room.id, userId: request.authUser.id },
      "Room join succeeded"
    );
    roomRealtimeBus.emitEvent("participant.joined", {
      roomId: room.id,
      userId: request.authUser.id
    });

    return sendOk(reply, {
      participant: toParticipantResponse(joinResult.participant),
      room: refreshedRoom ? toRoomResponse(refreshedRoom) : toRoomResponse(room)
    });
  });

  app.post(
    "/api/rooms/:roomId/access/private-password",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsedParams = roomParamsSchema.safeParse(request.params);
      const parsedBody = privateRoomAccessSchema.safeParse(request.body);

      if (!parsedParams.success) {
        return sendError(reply, 400, "VALIDATION_FAILED", "Invalid room id.", parsedParams.error.issues);
      }

      if (!parsedBody.success) {
        return sendError(reply, 400, "VALIDATION_FAILED", "Enter the room password.", parsedBody.error.issues);
      }

      if (!request.authUser) {
        return sendError(reply, 401, "AUTH_REQUIRED", "Log in to continue.");
      }

      if (
        enforceRateLimit(
          request,
          reply,
          privatePasswordRateLimiter,
          `${request.authUser.id}:${parsedParams.data.roomId}`,
          "Too many private room password attempts. Please wait a bit and try again."
        )
      ) {
        return reply;
      }

      const room = await findRoomForResponse(parsedParams.data.roomId);

      if (!room) {
        return sendError(reply, 404, "NOT_FOUND", "Room not found.");
      }

      if (room.state === "ended") {
        return sendError(reply, 403, "ROOM_ENDED", "This room has ended.");
      }

      if (room.visibility === "public") {
        const joinResult = await activateParticipant(room, request.authUser.id);

        if (joinResult.status === "full") {
          return sendError(reply, 409, "ROOM_FULL", "This room is full.");
        }

        if (joinResult.status === "denied" || !joinResult.participant) {
          if (joinResult.participant?.state === "banned") {
            return sendError(reply, 403, "ROOM_USER_BANNED", "You are banned from rejoining this room.");
          }

          return sendError(reply, 403, "ROOM_ACCESS_DENIED", "You cannot join this room.");
        }

        const refreshedRoom = await findRoomForResponse(room.id);
        roomRealtimeBus.emitEvent("participant.joined", {
          roomId: room.id,
          userId: request.authUser.id
        });

        return sendOk(reply, {
          allowed: true,
          participant: toParticipantResponse(joinResult.participant),
          room: refreshedRoom ? toRoomResponse(refreshedRoom) : toRoomResponse(room)
        });
      }

      if (!room.privatePasswordHash) {
        return sendError(reply, 409, "INVALID_ROOM_STATE", "This private room is missing its password.");
      }

      const passwordMatches = await verifyPassword(parsedBody.data.password, room.privatePasswordHash);

      if (!passwordMatches) {
        return sendError(reply, 403, "ROOM_ACCESS_DENIED", "Room password is incorrect.");
      }

      const joinResult = await activateParticipant(room, request.authUser.id);

      if (joinResult.status === "full") {
        request.log.warn({ roomId: room.id, userId: request.authUser.id }, "Private join blocked because room is full");
        return sendError(reply, 409, "ROOM_FULL", "This room is full.");
      }

      if (joinResult.status === "denied" || !joinResult.participant) {
        request.log.warn({ roomId: room.id, userId: request.authUser.id }, "Private join blocked by participant state");
        if (joinResult.participant?.state === "banned") {
          return sendError(reply, 403, "ROOM_USER_BANNED", "You are banned from rejoining this room.");
        }

        return sendError(reply, 403, "ROOM_ACCESS_DENIED", "You cannot join this room.");
      }

      const refreshedRoom = await findRoomForResponse(room.id);

      request.log.info(
        { participantId: joinResult.participant.id, roomId: room.id, userId: request.authUser.id },
        "Private room password accepted and participant joined"
      );
      roomRealtimeBus.emitEvent("participant.joined", {
        roomId: room.id,
        userId: request.authUser.id
      });

      return sendOk(reply, {
        allowed: true,
        participant: toParticipantResponse(joinResult.participant),
        room: refreshedRoom ? toRoomResponse(refreshedRoom) : toRoomResponse(room)
      });
    }
  );

  app.get("/api/rooms/:roomId/messages", { preHandler: app.authenticate }, async (request, reply) => {
    const parsedParams = roomParamsSchema.safeParse(request.params);
    const parsedQuery = messageQuerySchema.safeParse(request.query);

    if (!parsedParams.success) {
      return sendError(reply, 400, "VALIDATION_FAILED", "Invalid room id.", parsedParams.error.issues);
    }

    if (!parsedQuery.success) {
      return sendError(reply, 400, "VALIDATION_FAILED", "Invalid message query.", parsedQuery.error.issues);
    }

    if (!request.authUser) {
      return sendError(reply, 401, "AUTH_REQUIRED", "Log in to continue.");
    }

    const room = await findRoomForResponse(parsedParams.data.roomId);

    if (!room) {
      return sendError(reply, 404, "NOT_FOUND", "Room not found.");
    }

    if (room.state === "ended") {
      return sendError(reply, 403, "ROOM_ENDED", "This room has ended.");
    }

    const participant = await findActiveParticipant(room.id, request.authUser.id);

    if (!participant) {
      return sendError(reply, 403, "FORBIDDEN", "Join the room before reading chat.");
    }

    const messages = await prisma.message.findMany({
      include: {
        user: true
      },
      orderBy: { createdAt: "asc" },
      take: parsedQuery.data.limit ?? 50,
      where: {
        createdAt: {
          gte: participant.joinedAt
        },
        roomId: room.id,
        state: "visible"
      }
    });

    return sendOk(reply, {
      messages: messages.map(toMessageResponse),
      participant: toParticipantResponse(participant)
    });
  });

  app.post("/api/rooms/:roomId/messages", { preHandler: app.authenticate }, async (request, reply) => {
    const parsedParams = roomParamsSchema.safeParse(request.params);
    const parsedBody = messageCreateSchema.safeParse(request.body);

    if (!parsedParams.success) {
      return sendError(reply, 400, "VALIDATION_FAILED", "Invalid room id.", parsedParams.error.issues);
    }

    if (!parsedBody.success) {
      return sendError(reply, 400, "VALIDATION_FAILED", "Check the message body.", parsedBody.error.issues);
    }

    if (!request.authUser) {
      return sendError(reply, 401, "AUTH_REQUIRED", "Log in to continue.");
    }

    const body = normalizeSafetyText(parsedBody.data.body);
    const messageSafetyIssue = getMessageSafetyIssue(body);

    if (messageSafetyIssue) {
      return sendError(reply, 400, "VALIDATION_FAILED", messageSafetyIssue);
    }

    if (
      enforceRateLimit(
        request,
        reply,
        restMessageRateLimiter,
        `${request.authUser.id}:${parsedParams.data.roomId}`,
        "You are sending messages too quickly. Slow down for a moment."
      )
    ) {
      return reply;
    }

    const room = await findRoomForResponse(parsedParams.data.roomId);

    if (!room) {
      return sendError(reply, 404, "NOT_FOUND", "Room not found.");
    }

    if (room.state === "ended") {
      return sendError(reply, 403, "ROOM_ENDED", "This room has ended.");
    }

    const participant = await findActiveParticipant(room.id, request.authUser.id);

    if (!participant) {
      return sendError(reply, 403, "FORBIDDEN", "Join the room before sending chat.");
    }

    const message = await prisma.message.create({
      data: {
        body,
        roomId: room.id,
        userId: request.authUser.id
      },
      include: {
        user: true
      }
    });

    request.log.info(
      { messageId: message.id, roomId: room.id, userId: request.authUser.id },
      "Room message persisted"
    );
    roomRealtimeBus.emitEvent("message.created", {
      message: toMessageResponse(message),
      roomId: room.id
    });

    return sendOk(reply, { message: toMessageResponse(message) }, 201);
  });

  app.post("/api/rooms/:roomId/close", { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = roomParamsSchema.safeParse(request.params);

    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_FAILED", "Invalid room id.", parsed.error.issues);
    }

    if (!request.authUser) {
      return sendError(reply, 401, "AUTH_REQUIRED", "Log in to continue.");
    }

    const room = await findRoomForResponse(parsed.data.roomId);

    if (!room) {
      return sendError(reply, 404, "NOT_FOUND", "Room not found.");
    }

    if (room.hostUserId !== request.authUser.id) {
      return sendError(reply, 403, "ROOM_ACCESS_DENIED", "Only the host can close this room.");
    }

    if (room.state === "ended") {
      return sendError(reply, 409, "INVALID_ROOM_STATE", "This room has already ended.");
    }

    const endedRoom = await endRoom(room.id);

    request.log.info({ hostUserId: request.authUser.id, roomId: room.id }, "Room closed by host");
    roomRealtimeBus.emitEvent("room.ended", {
      endedAt: endedRoom.endedAt?.toISOString() ?? new Date().toISOString(),
      endedByUserId: request.authUser.id,
      reason: "host_closed",
      roomId: room.id
    });

    return sendOk(reply, { room: toRoomResponse(endedRoom) });
  });

  app.post("/api/rooms/:roomId/leave", { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = roomParamsSchema.safeParse(request.params);

    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_FAILED", "Invalid room id.", parsed.error.issues);
    }

    if (!request.authUser) {
      return sendError(reply, 401, "AUTH_REQUIRED", "Log in to continue.");
    }

    const room = await findRoomForResponse(parsed.data.roomId);

    if (!room) {
      return sendError(reply, 404, "NOT_FOUND", "Room not found.");
    }

    if (room.state === "ended") {
      return sendOk(reply, {
        endedByHost: false,
        participant: null,
        room: toRoomResponse(room)
      });
    }

    if (room.hostUserId !== request.authUser.id) {
      await prisma.roomParticipant.updateMany({
        data: {
          leftAt: new Date(),
          state: "left"
        },
        where: {
          roomId: room.id,
          state: "active",
          userId: request.authUser.id
        }
      });

      const participant = await findParticipant(room.id, request.authUser.id);
      const refreshedRoom = await findRoomForResponse(room.id);

      request.log.info({ roomId: room.id, userId: request.authUser.id }, "Room participant left");
      roomRealtimeBus.emitEvent("participant.left", {
        leftAt: participant?.leftAt?.toISOString() ?? new Date().toISOString(),
        roomId: room.id,
        userId: request.authUser.id
      });

      return sendOk(reply, {
        endedByHost: false,
        participant: participant ? toParticipantResponse(participant) : null,
        room: refreshedRoom ? toRoomResponse(refreshedRoom) : toRoomResponse(room)
      });
    }

    const endedRoom = await endRoom(room.id);

    request.log.info({ hostUserId: request.authUser.id, roomId: room.id }, "Room ended because host left");
    roomRealtimeBus.emitEvent("room.ended", {
      endedAt: endedRoom.endedAt?.toISOString() ?? new Date().toISOString(),
      endedByUserId: request.authUser.id,
      reason: "host_left",
      roomId: room.id
    });

    return sendOk(reply, {
      endedByHost: true,
      participant: null,
      room: toRoomResponse(endedRoom)
    });
  });
}
