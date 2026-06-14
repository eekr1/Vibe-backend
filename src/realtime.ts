import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { z } from "zod";
import { findAuthUserById, verifyAuthToken } from "./auth/auth-service.js";
import { AUTH_COOKIE_NAME, type AuthUser } from "./auth/auth-types.js";
import type { RuntimeConfig } from "./config.js";
import { prisma } from "./db/prisma.js";
import { roomRealtimeBus } from "./rooms/room-realtime-bus.js";
import { toMessageResponse, toParticipantResponse, toRoomResponse } from "./rooms/room-presenter.js";

type PlaybackState = {
  positionSeconds: number;
  sourceTime: string;
  status: "paused" | "playing";
  updatedAt: string;
};

type RoomSocketData = {
  authUser: AuthUser;
};

type SocketEventMap = Record<string, (...args: any[]) => void>;
type RoomSocket = Socket<SocketEventMap, SocketEventMap, SocketEventMap, RoomSocketData>;

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

const roomPayloadSchema = z.object({
  requestId: z.string().optional(),
  roomId: z.string().min(1)
});

const chatMessageSchema = z.object({
  body: z.string().trim().min(1).max(500),
  requestId: z.string().optional(),
  roomId: z.string().min(1)
});

const playbackSetSchema = z.object({
  positionSeconds: z.coerce.number().min(0),
  requestId: z.string().optional(),
  roomId: z.string().min(1),
  sourceTime: z.string().optional(),
  status: z.enum(["paused", "playing"])
});

const playbackByRoom = new Map<string, PlaybackState>();

function envelope<TPayload extends object>(payload: TPayload) {
  return {
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    ...payload
  };
}

function roomChannel(roomId: string) {
  return `room:${roomId}`;
}

function userChannel(userId: string) {
  return `user:${userId}`;
}

function parseCookies(cookieHeader?: string) {
  const cookies = new Map<string, string>();

  if (!cookieHeader) {
    return cookies;
  }

  for (const cookiePart of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = cookiePart.trim().split("=");
    const name = rawName?.trim();
    const value = rawValue.join("=");

    if (name) {
      cookies.set(name, decodeURIComponent(value));
    }
  }

  return cookies;
}

function emitRealtimeError(socket: RoomSocket, code: string, message: string, requestId?: string) {
  socket.emit("connection.error", envelope({ code, message, requestId }));
}

function acknowledge(
  callback: unknown,
  response:
    | { error: { code: string; message: string }; ok: false; requestId?: string }
    | { data?: unknown; ok: true; requestId?: string }
) {
  if (typeof callback === "function") {
    callback(response);
  }
}

async function findRoom(roomId: string) {
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

async function findActiveParticipant(roomId: string, userId: string) {
  return prisma.roomParticipant.findFirst({
    include: participantInclude,
    where: {
      roomId,
      state: "active",
      userId
    }
  });
}

async function listActiveParticipants(roomId: string) {
  return prisma.roomParticipant.findMany({
    include: participantInclude,
    orderBy: { joinedAt: "asc" },
    where: {
      roomId,
      state: "active"
    }
  });
}

function getPlayback(roomId: string): PlaybackState {
  const existingPlayback = playbackByRoom.get(roomId);

  if (existingPlayback) {
    return existingPlayback;
  }

  const playback = {
    positionSeconds: 0,
    sourceTime: new Date().toISOString(),
    status: "paused" as const,
    updatedAt: new Date().toISOString()
  };
  playbackByRoom.set(roomId, playback);
  return playback;
}

async function emitPresence(io: SocketIOServer, roomId: string) {
  const participants = await listActiveParticipants(roomId);

  io.of("/realtime").to(roomChannel(roomId)).emit(
    "room.presence.updated",
    envelope({
      activeParticipantCount: participants.length,
      participants: participants.map(toParticipantResponse),
      roomId
    })
  );
}

async function buildRoomSnapshot(roomId: string, userId: string) {
  const room = await findRoom(roomId);

  if (!room || room.state !== "live") {
    return null;
  }

  const participant = await findActiveParticipant(roomId, userId);

  if (!participant) {
    return null;
  }

  const participants = await listActiveParticipants(roomId);

  return {
    currentUserRole: participant.role,
    participants: participants.map(toParticipantResponse),
    playback: getPlayback(roomId),
    room: toRoomResponse(room)
  };
}

async function authenticateSocket(socket: RoomSocket, config: RuntimeConfig) {
  const cookies = parseCookies(socket.handshake.headers.cookie);
  const token = cookies.get(AUTH_COOKIE_NAME);

  if (!token) {
    throw new Error("SOCKET_AUTH_REQUIRED");
  }

  const payload = verifyAuthToken(token, config);
  const user = await findAuthUserById(payload.sub);

  if (!user) {
    throw new Error("SESSION_EXPIRED");
  }

  if (user.accountState !== "active") {
    throw new Error("ACCOUNT_NOT_ACTIVE");
  }

  socket.data.authUser = user;
}

export function attachRealtimeServer(server: HttpServer, config: RuntimeConfig): SocketIOServer {
  const io = new SocketIOServer(server, {
    cors: {
      origin: config.corsOrigin,
      credentials: true
    },
    path: "/socket.io"
  });

  const realtime = io.of("/realtime");

  realtime.use(async (socket, next) => {
    try {
      await authenticateSocket(socket as RoomSocket, config);
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error("SOCKET_AUTH_REQUIRED"));
    }
  });

  realtime.on("connection", (socket) => {
    const roomSocket = socket as RoomSocket;
    const subscribedRooms = new Set<string>();

    void roomSocket.join(userChannel(roomSocket.data.authUser.id));

    roomSocket.emit(
      "connection.ready",
      envelope({
        connectedAt: new Date().toISOString(),
        socketId: roomSocket.id,
        user: roomSocket.data.authUser
      })
    );

    roomSocket.on("room.subscribe", async (payload: unknown, callback: unknown) => {
      const parsed = roomPayloadSchema.safeParse(payload);

      if (!parsed.success) {
        emitRealtimeError(roomSocket, "VALIDATION_FAILED", "Invalid room subscription payload.");
        acknowledge(callback, {
          error: { code: "VALIDATION_FAILED", message: "Invalid room subscription payload." },
          ok: false
        });
        return;
      }

      const snapshot = await buildRoomSnapshot(parsed.data.roomId, roomSocket.data.authUser.id);

      if (!snapshot) {
        roomSocket.emit(
          "access.feedback",
          envelope({
            code: "ROOM_ACCESS_DENIED",
            message: "Join the room before subscribing to realtime events.",
            requestId: parsed.data.requestId,
            roomId: parsed.data.roomId
          })
        );
        acknowledge(callback, {
          error: { code: "ROOM_ACCESS_DENIED", message: "Join the room before subscribing." },
          ok: false,
          requestId: parsed.data.requestId
        });
        return;
      }

      await roomSocket.join(roomChannel(parsed.data.roomId));
      subscribedRooms.add(parsed.data.roomId);

      roomSocket.emit(
        "room.subscription.ready",
        envelope({
          requestId: parsed.data.requestId,
          roomId: parsed.data.roomId
        })
      );
      roomSocket.emit("room.state.snapshot", envelope(snapshot));
      await emitPresence(io, parsed.data.roomId);

      acknowledge(callback, {
        data: snapshot,
        ok: true,
        requestId: parsed.data.requestId
      });
    });

    roomSocket.on("room.unsubscribe", async (payload: unknown, callback: unknown) => {
      const parsed = roomPayloadSchema.safeParse(payload);

      if (!parsed.success) {
        acknowledge(callback, {
          error: { code: "VALIDATION_FAILED", message: "Invalid room unsubscribe payload." },
          ok: false
        });
        return;
      }

      await roomSocket.leave(roomChannel(parsed.data.roomId));
      subscribedRooms.delete(parsed.data.roomId);
      roomSocket.emit(
        "room.subscription.closed",
        envelope({
          requestId: parsed.data.requestId,
          roomId: parsed.data.roomId
        })
      );

      acknowledge(callback, {
        ok: true,
        requestId: parsed.data.requestId
      });
    });

    roomSocket.on("chat.message.send", async (payload: unknown, callback: unknown) => {
      const parsed = chatMessageSchema.safeParse(payload);

      if (!parsed.success) {
        acknowledge(callback, {
          error: { code: "VALIDATION_FAILED", message: "Invalid chat message payload." },
          ok: false
        });
        return;
      }

      const room = await findRoom(parsed.data.roomId);
      const participant = await findActiveParticipant(parsed.data.roomId, roomSocket.data.authUser.id);

      if (!room || room.state !== "live" || !participant) {
        roomSocket.emit(
          "access.feedback",
          envelope({
            code: "FORBIDDEN",
            message: "Join a live room before sending chat.",
            requestId: parsed.data.requestId,
            roomId: parsed.data.roomId
          })
        );
        acknowledge(callback, {
          error: { code: "FORBIDDEN", message: "Join a live room before sending chat." },
          ok: false,
          requestId: parsed.data.requestId
        });
        return;
      }

      const message = await prisma.message.create({
        data: {
          body: parsed.data.body,
          roomId: parsed.data.roomId,
          userId: roomSocket.data.authUser.id
        },
        include: {
          user: true
        }
      });
      const messageResponse = toMessageResponse(message);

      realtime.to(roomChannel(parsed.data.roomId)).emit(
        "chat.message.created",
        envelope({
          message: messageResponse,
          requestId: parsed.data.requestId,
          roomId: parsed.data.roomId
        })
      );

      acknowledge(callback, {
        data: { message: messageResponse },
        ok: true,
        requestId: parsed.data.requestId
      });
    });

    roomSocket.on("playback.state.set", async (payload: unknown, callback: unknown) => {
      const parsed = playbackSetSchema.safeParse(payload);

      if (!parsed.success) {
        console.warn("[realtime] Playback state rejected by validation", {
          issues: parsed.error.issues,
          userId: roomSocket.data.authUser.id
        });
        acknowledge(callback, {
          error: { code: "VALIDATION_FAILED", message: "Invalid playback payload." },
          ok: false
        });
        return;
      }

      const room = await findRoom(parsed.data.roomId);
      const participant = await findActiveParticipant(parsed.data.roomId, roomSocket.data.authUser.id);

      if (!room || room.state !== "live") {
        console.warn("[realtime] Playback state rejected because room is not live", {
          roomId: parsed.data.roomId,
          userId: roomSocket.data.authUser.id
        });
        acknowledge(callback, {
          error: { code: "ROOM_NOT_LIVE", message: "Playback cannot change because the room is not live." },
          ok: false,
          requestId: parsed.data.requestId
        });
        return;
      }

      if (!participant || participant.role !== "host") {
        console.warn("[realtime] Playback state rejected because user is not host", {
          roomId: parsed.data.roomId,
          userId: roomSocket.data.authUser.id
        });
        roomSocket.emit(
          "access.feedback",
          envelope({
            code: "HOST_REQUIRED",
            message: "Only the host can control shared playback.",
            requestId: parsed.data.requestId,
            roomId: parsed.data.roomId
          })
        );
        acknowledge(callback, {
          error: { code: "HOST_REQUIRED", message: "Only the host can control shared playback." },
          ok: false,
          requestId: parsed.data.requestId
        });
        return;
      }

      const playback = {
        positionSeconds: parsed.data.positionSeconds,
        sourceTime: parsed.data.sourceTime ?? new Date().toISOString(),
        status: parsed.data.status,
        updatedAt: new Date().toISOString()
      };
      playbackByRoom.set(parsed.data.roomId, playback);

      console.info("[realtime] Playback state updated", {
        positionSeconds: playback.positionSeconds,
        roomId: parsed.data.roomId,
        status: playback.status,
        updatedByUserId: roomSocket.data.authUser.id
      });

      realtime.to(roomChannel(parsed.data.roomId)).emit(
        "playback.state.updated",
        envelope({
          playback,
          requestId: parsed.data.requestId,
          roomId: parsed.data.roomId,
          updatedByUserId: roomSocket.data.authUser.id
        })
      );

      acknowledge(callback, {
        data: { playback },
        ok: true,
        requestId: parsed.data.requestId
      });
    });

    roomSocket.on("disconnect", () => {
      subscribedRooms.clear();
    });
  });

  roomRealtimeBus.onEvent("participant.joined", async ({ roomId, userId }) => {
    const participant = await findActiveParticipant(roomId, userId);

    if (participant) {
      realtime.to(roomChannel(roomId)).emit(
        "room.user.joined",
        envelope({
          joinedAt: participant.joinedAt.toISOString(),
          roomId,
          user: toParticipantResponse(participant).user
        })
      );
    }

    await emitPresence(io, roomId);
  });

  roomRealtimeBus.onEvent("participant.left", async ({ leftAt, roomId, userId }) => {
    realtime.to(roomChannel(roomId)).emit(
      "room.user.left",
      envelope({
        leftAt,
        roomId,
        userId
      })
    );
    await emitPresence(io, roomId);
  });

  roomRealtimeBus.onEvent("message.created", ({ message, roomId }) => {
    realtime.to(roomChannel(roomId)).emit(
      "chat.message.created",
      envelope({
        message,
        roomId
      })
    );
  });

  roomRealtimeBus.onEvent(
    "moderation.action.applied",
    async ({ action, actionType, actorUserId, createdAt, reason, roomId, targetUserId }) => {
      realtime.to(roomChannel(roomId)).emit(
        "moderation.action.applied",
        envelope({
          action,
          actorUserId,
          createdAt,
          reason,
          roomId,
          targetUserId
        })
      );
      realtime.to(userChannel(targetUserId)).emit(
        "room.access.revoked",
        envelope({
          actionType,
          reason: actionType === "ban" ? "user_banned" : "user_kicked",
          roomId
        })
      );

      const targetSockets = await realtime.in(userChannel(targetUserId)).fetchSockets();

      await Promise.all(targetSockets.map((targetSocket) => targetSocket.leave(roomChannel(roomId))));

      realtime.to(roomChannel(roomId)).emit(
        "room.user.left",
        envelope({
          leftAt: createdAt,
          roomId,
          userId: targetUserId
        })
      );
      await emitPresence(io, roomId);
    }
  );

  roomRealtimeBus.onEvent("room.ended", ({ endedAt, endedByUserId, reason, roomId }) => {
    playbackByRoom.delete(roomId);
    realtime.to(roomChannel(roomId)).emit(
      "room.ended",
      envelope({
        endedAt,
        endedByUserId,
        reason,
        roomId
      })
    );
  });

  return io;
}
