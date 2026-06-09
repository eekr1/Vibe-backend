import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { sendError, sendOk } from "../lib/http.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().max(120).optional()
});

const userListQuerySchema = listQuerySchema.extend({
  accountState: z.enum(["active", "restricted", "suspended", "banned"]).optional(),
  role: z.enum(["member", "admin"]).optional()
});

const roomListQuerySchema = listQuerySchema.extend({
  state: z.enum(["live", "ended", "deleted"]).optional(),
  visibility: z.enum(["public", "private"]).optional()
});

const reportListQuerySchema = listQuerySchema.extend({
  status: z.enum(["open", "reviewed", "action_taken", "dismissed", "escalated"]).optional(),
  targetType: z.enum(["room", "user", "message"]).optional()
});

const moderationListQuerySchema = listQuerySchema.extend({
  actionType: z.enum(["kick", "ban"]).optional()
});

const userParamsSchema = z.object({
  userId: z.string().trim().min(1)
});

const roomParamsSchema = z.object({
  roomId: z.string().trim().min(1)
});

const reportParamsSchema = z.object({
  reportId: z.string().trim().min(1)
});

const categoryParamsSchema = z.object({
  categoryId: z.string().trim().min(1)
});

const userRestrictionSchema = z.object({
  accountState: z.enum(["active", "restricted", "suspended", "banned"])
});

const reportReviewSchema = z.object({
  status: z.enum(["reviewed", "action_taken", "dismissed", "escalated"])
});

const categoryCreateSchema = z.object({
  isActive: z.boolean().optional(),
  name: z.string().trim().min(2).max(64),
  slug: z.string().trim().min(2).max(80).optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional()
});

const categoryUpdateSchema = z.object({
  isActive: z.boolean().optional(),
  name: z.string().trim().min(2).max(64).optional(),
  slug: z.string().trim().min(2).max(80).optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional()
});

function compactSearch(search?: string) {
  return search?.trim() || undefined;
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || "category";
}

function isUniqueConflict(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2002"
  );
}

function isRecordNotFound(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2025"
  );
}

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!request.authUser) {
    return sendError(reply, 401, "AUTH_REQUIRED", "Log in to continue.");
  }

  if (request.authUser.role !== "admin") {
    request.log.warn({ userId: request.authUser.id }, "Admin access denied");
    return sendError(reply, 403, "ADMIN_REQUIRED", "Admin access is required.");
  }
}

function userSummary(user: { avatarUrl: string | null; displayName: string; id: string; username: string }) {
  return {
    avatarUrl: user.avatarUrl,
    displayName: user.displayName,
    id: user.id,
    username: user.username
  };
}

function toAdminCategory(category: {
  createdAt: Date;
  id: string;
  isActive: boolean;
  name: string;
  slug: string;
  sortOrder: number;
  updatedAt: Date;
  _count?: { rooms: number };
}) {
  return {
    createdAt: category.createdAt.toISOString(),
    id: category.id,
    isActive: category.isActive,
    name: category.name,
    roomCount: category._count?.rooms ?? 0,
    slug: category.slug,
    sortOrder: category.sortOrder,
    updatedAt: category.updatedAt.toISOString()
  };
}

function toAdminUser(user: {
  accountState: string;
  avatarUrl: string | null;
  createdAt: Date;
  displayName: string;
  email: string;
  id: string;
  role: string;
  updatedAt: Date;
  username: string;
  _count?: {
    hostedRooms?: number;
    messages?: number;
    moderationActionsAuthored?: number;
    moderationActionsReceived?: number;
    participants?: number;
    reportsMade?: number;
    reportsTargetingUser?: number;
  };
}) {
  return {
    accountState: user.accountState,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt.toISOString(),
    displayName: user.displayName,
    email: user.email,
    id: user.id,
    role: user.role,
    stats: {
      hostedRooms: user._count?.hostedRooms ?? 0,
      messages: user._count?.messages ?? 0,
      moderationActionsAuthored: user._count?.moderationActionsAuthored ?? 0,
      moderationActionsReceived: user._count?.moderationActionsReceived ?? 0,
      participations: user._count?.participants ?? 0,
      reportsMade: user._count?.reportsMade ?? 0,
      reportsReceived: user._count?.reportsTargetingUser ?? 0
    },
    updatedAt: user.updatedAt.toISOString(),
    username: user.username
  };
}

function toAdminRoom(room: {
  category: { id: string; name: string; slug: string };
  createdAt: Date;
  endedAt: Date | null;
  host: { avatarUrl: string | null; displayName: string; id: string; username: string };
  id: string;
  participantLimit: number;
  slug: string;
  sourceProvider: string;
  sourceUrl: string;
  sourceVideoId: string;
  state: string;
  title: string;
  updatedAt: Date;
  visibility: string;
  _count?: {
    messages?: number;
    moderationActions?: number;
    participants?: number;
    reports?: number;
  };
}) {
  return {
    category: {
      id: room.category.id,
      name: room.category.name,
      slug: room.category.slug
    },
    createdAt: room.createdAt.toISOString(),
    endedAt: room.endedAt ? room.endedAt.toISOString() : null,
    host: userSummary(room.host),
    id: room.id,
    participantLimit: room.participantLimit,
    slug: room.slug,
    source: {
      provider: room.sourceProvider,
      url: room.sourceUrl,
      videoId: room.sourceVideoId
    },
    state: room.state,
    stats: {
      messages: room._count?.messages ?? 0,
      moderationActions: room._count?.moderationActions ?? 0,
      participants: room._count?.participants ?? 0,
      reports: room._count?.reports ?? 0
    },
    title: room.title,
    updatedAt: room.updatedAt.toISOString(),
    visibility: room.visibility
  };
}

function toAdminReport(report: {
  createdAt: Date;
  details: string | null;
  id: string;
  message?: { body: string; createdAt: Date; id: string; state: string } | null;
  messageId: string | null;
  reason: string;
  reporter: { avatarUrl: string | null; displayName: string; id: string; username: string };
  reviewedAt: Date | null;
  room?: { id: string; state: string; title: string } | null;
  roomId: string | null;
  status: string;
  targetId: string;
  targetType: string;
  targetUser?: { avatarUrl: string | null; displayName: string; id: string; username: string } | null;
  updatedAt: Date;
}) {
  return {
    createdAt: report.createdAt.toISOString(),
    details: report.details,
    id: report.id,
    message: report.message
      ? {
          body: report.message.body,
          createdAt: report.message.createdAt.toISOString(),
          id: report.message.id,
          state: report.message.state
        }
      : null,
    messageId: report.messageId,
    reason: report.reason,
    reporter: userSummary(report.reporter),
    reviewedAt: report.reviewedAt ? report.reviewedAt.toISOString() : null,
    room: report.room
      ? {
          id: report.room.id,
          state: report.room.state,
          title: report.room.title
        }
      : null,
    roomId: report.roomId,
    status: report.status,
    targetId: report.targetId,
    targetType: report.targetType,
    targetUser: report.targetUser ? userSummary(report.targetUser) : null,
    updatedAt: report.updatedAt.toISOString()
  };
}

function toAdminModerationAction(action: {
  actionType: string;
  actor: { avatarUrl: string | null; displayName: string; id: string; username: string };
  createdAt: Date;
  id: string;
  reason: string | null;
  room: { id: string; state: string; title: string };
  roomId: string;
  target: { avatarUrl: string | null; displayName: string; id: string; username: string };
  targetUserId: string;
}) {
  return {
    actionType: action.actionType,
    actor: userSummary(action.actor),
    createdAt: action.createdAt.toISOString(),
    id: action.id,
    reason: action.reason,
    room: {
      id: action.room.id,
      state: action.room.state,
      title: action.room.title
    },
    roomId: action.roomId,
    target: userSummary(action.target),
    targetUserId: action.targetUserId
  };
}

export function registerAdminRoutes(app: FastifyInstance) {
  const adminOnly = { preHandler: [app.authenticate, requireAdmin] };

  app.get("/api/admin/overview", adminOnly, async (request, reply) => {
    const [
      totalUsers,
      activeUsers,
      restrictedUsers,
      suspendedUsers,
      bannedUsers,
      adminUsers,
      totalRooms,
      liveRooms,
      endedRooms,
      totalReports,
      openReports,
      totalModerationActions,
      activeCategories,
      recentReports,
      recentModerationActions,
      recentRooms
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { accountState: "active" } }),
      prisma.user.count({ where: { accountState: "restricted" } }),
      prisma.user.count({ where: { accountState: "suspended" } }),
      prisma.user.count({ where: { accountState: "banned" } }),
      prisma.user.count({ where: { role: "admin" } }),
      prisma.room.count(),
      prisma.room.count({ where: { state: "live" } }),
      prisma.room.count({ where: { state: "ended" } }),
      prisma.report.count(),
      prisma.report.count({ where: { status: "open" } }),
      prisma.moderationAction.count(),
      prisma.category.count({ where: { isActive: true } }),
      prisma.report.findMany({
        include: {
          reporter: true,
          room: true,
          targetUser: true
        },
        orderBy: { createdAt: "desc" },
        take: 5
      }),
      prisma.moderationAction.findMany({
        include: {
          actor: true,
          room: true,
          target: true
        },
        orderBy: { createdAt: "desc" },
        take: 5
      }),
      prisma.room.findMany({
        include: {
          _count: {
            select: {
              messages: true,
              moderationActions: true,
              participants: true,
              reports: true
            }
          },
          category: true,
          host: true
        },
        orderBy: { createdAt: "desc" },
        take: 5
      })
    ]);

    request.log.info({ adminUserId: request.authUser?.id }, "Admin overview loaded");

    return sendOk(reply, {
      generatedAt: new Date().toISOString(),
      overview: {
        categories: {
          active: activeCategories
        },
        moderation: {
          totalActions: totalModerationActions
        },
        reports: {
          open: openReports,
          total: totalReports
        },
        rooms: {
          ended: endedRooms,
          live: liveRooms,
          total: totalRooms
        },
        users: {
          active: activeUsers,
          admins: adminUsers,
          banned: bannedUsers,
          restricted: restrictedUsers,
          suspended: suspendedUsers,
          total: totalUsers
        }
      },
      recent: {
        moderationActions: recentModerationActions.map(toAdminModerationAction),
        reports: recentReports.map(toAdminReport),
        rooms: recentRooms.map(toAdminRoom)
      }
    });
  });

  app.get("/api/admin/users", adminOnly, async (request, reply) => {
    const parsed = userListQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_FAILED", "Invalid user list filters.", parsed.error.issues);
    }

    const search = compactSearch(parsed.data.search);
    const users = await prisma.user.findMany({
      include: {
        _count: {
          select: {
            hostedRooms: true,
            messages: true,
            moderationActionsAuthored: true,
            moderationActionsReceived: true,
            participants: true,
            reportsMade: true,
            reportsTargetingUser: true
          }
        }
      },
      orderBy: { createdAt: "desc" },
      take: parsed.data.limit ?? 50,
      where: {
        ...(parsed.data.accountState ? { accountState: parsed.data.accountState } : {}),
        ...(parsed.data.role ? { role: parsed.data.role } : {}),
        ...(search
          ? {
              OR: [
                { displayName: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
                { username: { contains: search, mode: "insensitive" } }
              ]
            }
          : {})
      }
    });

    request.log.info({ count: users.length, filters: parsed.data }, "Admin users listed");

    return sendOk(reply, {
      filters: {
        accountState: parsed.data.accountState ?? null,
        role: parsed.data.role ?? null,
        search: search ?? ""
      },
      users: users.map(toAdminUser)
    });
  });

  app.get("/api/admin/users/:userId", adminOnly, async (request, reply) => {
    const parsed = userParamsSchema.safeParse(request.params);

    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_FAILED", "Invalid user id.", parsed.error.issues);
    }

    const user = await prisma.user.findUnique({
      include: {
        _count: {
          select: {
            hostedRooms: true,
            messages: true,
            moderationActionsAuthored: true,
            moderationActionsReceived: true,
            participants: true,
            reportsMade: true,
            reportsTargetingUser: true
          }
        },
        hostedRooms: {
          include: {
            _count: {
              select: {
                messages: true,
                moderationActions: true,
                participants: true,
                reports: true
              }
            },
            category: true,
            host: true
          },
          orderBy: { createdAt: "desc" },
          take: 8
        },
        moderationActionsReceived: {
          include: {
            actor: true,
            room: true,
            target: true
          },
          orderBy: { createdAt: "desc" },
          take: 8
        },
        reportsMade: {
          include: {
            reporter: true,
            room: true,
            targetUser: true
          },
          orderBy: { createdAt: "desc" },
          take: 8
        },
        reportsTargetingUser: {
          include: {
            reporter: true,
            room: true,
            targetUser: true
          },
          orderBy: { createdAt: "desc" },
          take: 8
        }
      },
      where: { id: parsed.data.userId }
    });

    if (!user) {
      return sendError(reply, 404, "NOT_FOUND", "User not found.");
    }

    request.log.info({ inspectedUserId: user.id }, "Admin user detail loaded");

    return sendOk(reply, {
      history: {
        hostedRooms: user.hostedRooms.map(toAdminRoom),
        moderationActionsReceived: user.moderationActionsReceived.map(toAdminModerationAction),
        reportsMade: user.reportsMade.map(toAdminReport),
        reportsReceived: user.reportsTargetingUser.map(toAdminReport)
      },
      user: toAdminUser(user)
    });
  });

  app.patch("/api/admin/users/:userId/restriction", adminOnly, async (request, reply) => {
    const parsedParams = userParamsSchema.safeParse(request.params);
    const parsedBody = userRestrictionSchema.safeParse(request.body);

    if (!parsedParams.success) {
      return sendError(reply, 400, "VALIDATION_FAILED", "Invalid user id.", parsedParams.error.issues);
    }

    if (!parsedBody.success) {
      return sendError(reply, 400, "VALIDATION_FAILED", "Invalid account state.", parsedBody.error.issues);
    }

    if (parsedParams.data.userId === request.authUser?.id && parsedBody.data.accountState !== "active") {
      return sendError(reply, 409, "INVALID_ROOM_STATE", "Admins cannot restrict their own active session.");
    }

    try {
      const user = await prisma.user.update({
        data: {
          accountState: parsedBody.data.accountState
        },
        include: {
          _count: {
            select: {
              hostedRooms: true,
              messages: true,
              moderationActionsAuthored: true,
              moderationActionsReceived: true,
              participants: true,
              reportsMade: true,
              reportsTargetingUser: true
            }
          }
        },
        where: { id: parsedParams.data.userId }
      });

      request.log.info(
        { accountState: user.accountState, adminUserId: request.authUser?.id, userId: user.id },
        "Admin account state updated"
      );

      return sendOk(reply, { user: toAdminUser(user) });
    } catch (error) {
      if (isRecordNotFound(error)) {
        return sendError(reply, 404, "NOT_FOUND", "User not found.");
      }

      throw error;
    }
  });

  app.get("/api/admin/rooms", adminOnly, async (request, reply) => {
    const parsed = roomListQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_FAILED", "Invalid room list filters.", parsed.error.issues);
    }

    const search = compactSearch(parsed.data.search);
    const rooms = await prisma.room.findMany({
      include: {
        _count: {
          select: {
            messages: true,
            moderationActions: true,
            participants: true,
            reports: true
          }
        },
        category: true,
        host: true
      },
      orderBy: { createdAt: "desc" },
      take: parsed.data.limit ?? 50,
      where: {
        ...(parsed.data.state ? { state: parsed.data.state } : {}),
        ...(parsed.data.visibility ? { visibility: parsed.data.visibility } : {}),
        ...(search
          ? {
              OR: [
                { title: { contains: search, mode: "insensitive" } },
                { host: { displayName: { contains: search, mode: "insensitive" } } },
                { host: { username: { contains: search, mode: "insensitive" } } }
              ]
            }
          : {})
      }
    });

    request.log.info({ count: rooms.length, filters: parsed.data }, "Admin rooms listed");

    return sendOk(reply, {
      filters: {
        search: search ?? "",
        state: parsed.data.state ?? null,
        visibility: parsed.data.visibility ?? null
      },
      rooms: rooms.map(toAdminRoom)
    });
  });

  app.get("/api/admin/rooms/:roomId", adminOnly, async (request, reply) => {
    const parsed = roomParamsSchema.safeParse(request.params);

    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_FAILED", "Invalid room id.", parsed.error.issues);
    }

    const room = await prisma.room.findFirst({
      include: {
        _count: {
          select: {
            messages: true,
            moderationActions: true,
            participants: true,
            reports: true
          }
        },
        category: true,
        host: true,
        messages: {
          include: { user: true },
          orderBy: { createdAt: "desc" },
          take: 12
        },
        moderationActions: {
          include: {
            actor: true,
            room: true,
            target: true
          },
          orderBy: { createdAt: "desc" },
          take: 12
        },
        participants: {
          include: { user: true },
          orderBy: { joinedAt: "desc" },
          take: 24
        },
        reports: {
          include: {
            message: true,
            reporter: true,
            room: true,
            targetUser: true
          },
          orderBy: { createdAt: "desc" },
          take: 12
        }
      },
      where: {
        id: parsed.data.roomId,
        state: { not: "deleted" }
      }
    });

    if (!room) {
      return sendError(reply, 404, "NOT_FOUND", "Room not found.");
    }

    request.log.info({ roomId: room.id }, "Admin room detail loaded");

    return sendOk(reply, {
      history: {
        messages: room.messages.map((message) => ({
          author: userSummary(message.user),
          body: message.body,
          createdAt: message.createdAt.toISOString(),
          id: message.id,
          state: message.state
        })),
        moderationActions: room.moderationActions.map(toAdminModerationAction),
        participants: room.participants.map((participant) => ({
          joinedAt: participant.joinedAt.toISOString(),
          leftAt: participant.leftAt ? participant.leftAt.toISOString() : null,
          role: participant.role,
          state: participant.state,
          user: userSummary(participant.user)
        })),
        reports: room.reports.map(toAdminReport)
      },
      room: toAdminRoom(room)
    });
  });

  app.get("/api/admin/reports", adminOnly, async (request, reply) => {
    const parsed = reportListQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_FAILED", "Invalid report list filters.", parsed.error.issues);
    }

    const search = compactSearch(parsed.data.search);
    const reports = await prisma.report.findMany({
      include: {
        message: true,
        reporter: true,
        room: true,
        targetUser: true
      },
      orderBy: { createdAt: "desc" },
      take: parsed.data.limit ?? 50,
      where: {
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(parsed.data.targetType ? { targetType: parsed.data.targetType } : {}),
        ...(search
          ? {
              OR: [
                { details: { contains: search, mode: "insensitive" } },
                { targetId: { contains: search, mode: "insensitive" } },
                { reporter: { displayName: { contains: search, mode: "insensitive" } } },
                { targetUser: { displayName: { contains: search, mode: "insensitive" } } },
                { room: { title: { contains: search, mode: "insensitive" } } }
              ]
            }
          : {})
      }
    });

    request.log.info({ count: reports.length, filters: parsed.data }, "Admin reports listed");

    return sendOk(reply, {
      filters: {
        search: search ?? "",
        status: parsed.data.status ?? null,
        targetType: parsed.data.targetType ?? null
      },
      reports: reports.map(toAdminReport)
    });
  });

  app.get("/api/admin/reports/:reportId", adminOnly, async (request, reply) => {
    const parsed = reportParamsSchema.safeParse(request.params);

    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_FAILED", "Invalid report id.", parsed.error.issues);
    }

    const report = await prisma.report.findUnique({
      include: {
        message: true,
        reporter: true,
        room: true,
        targetUser: true
      },
      where: { id: parsed.data.reportId }
    });

    if (!report) {
      return sendError(reply, 404, "NOT_FOUND", "Report not found.");
    }

    request.log.info({ reportId: report.id }, "Admin report detail loaded");

    return sendOk(reply, { report: toAdminReport(report) });
  });

  app.patch("/api/admin/reports/:reportId/review", adminOnly, async (request, reply) => {
    const parsedParams = reportParamsSchema.safeParse(request.params);
    const parsedBody = reportReviewSchema.safeParse(request.body);

    if (!parsedParams.success) {
      return sendError(reply, 400, "VALIDATION_FAILED", "Invalid report id.", parsedParams.error.issues);
    }

    if (!parsedBody.success) {
      return sendError(reply, 400, "VALIDATION_FAILED", "Invalid report review status.", parsedBody.error.issues);
    }

    try {
      const report = await prisma.report.update({
        data: {
          reviewedAt: new Date(),
          status: parsedBody.data.status
        },
        include: {
          message: true,
          reporter: true,
          room: true,
          targetUser: true
        },
        where: { id: parsedParams.data.reportId }
      });

      request.log.info(
        { adminUserId: request.authUser?.id, reportId: report.id, status: report.status },
        "Admin report review updated"
      );

      return sendOk(reply, { report: toAdminReport(report) });
    } catch (error) {
      if (isRecordNotFound(error)) {
        return sendError(reply, 404, "NOT_FOUND", "Report not found.");
      }

      throw error;
    }
  });

  app.get("/api/admin/moderation-actions", adminOnly, async (request, reply) => {
    const parsed = moderationListQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_FAILED", "Invalid moderation action filters.", parsed.error.issues);
    }

    const search = compactSearch(parsed.data.search);
    const actions = await prisma.moderationAction.findMany({
      include: {
        actor: true,
        room: true,
        target: true
      },
      orderBy: { createdAt: "desc" },
      take: parsed.data.limit ?? 50,
      where: {
        ...(parsed.data.actionType ? { actionType: parsed.data.actionType } : {}),
        ...(search
          ? {
              OR: [
                { reason: { contains: search, mode: "insensitive" } },
                { actor: { displayName: { contains: search, mode: "insensitive" } } },
                { target: { displayName: { contains: search, mode: "insensitive" } } },
                { room: { title: { contains: search, mode: "insensitive" } } }
              ]
            }
          : {})
      }
    });

    request.log.info({ count: actions.length, filters: parsed.data }, "Admin moderation history listed");

    return sendOk(reply, {
      actions: actions.map(toAdminModerationAction),
      filters: {
        actionType: parsed.data.actionType ?? null,
        search: search ?? ""
      }
    });
  });

  app.get("/api/admin/categories", adminOnly, async (request, reply) => {
    const categories = await prisma.category.findMany({
      include: {
        _count: {
          select: {
            rooms: true
          }
        }
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
    });

    request.log.info({ count: categories.length }, "Admin categories listed");

    return sendOk(reply, { categories: categories.map(toAdminCategory) });
  });

  app.post("/api/admin/categories", adminOnly, async (request, reply) => {
    const parsed = categoryCreateSchema.safeParse(request.body);

    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_FAILED", "Invalid category fields.", parsed.error.issues);
    }

    try {
      const category = await prisma.category.create({
        data: {
          isActive: parsed.data.isActive ?? true,
          name: parsed.data.name,
          slug: slugify(parsed.data.slug ?? parsed.data.name),
          sortOrder: parsed.data.sortOrder ?? 0
        },
        include: {
          _count: {
            select: {
              rooms: true
            }
          }
        }
      });

      request.log.info({ adminUserId: request.authUser?.id, categoryId: category.id }, "Admin category created");

      return sendOk(reply, { category: toAdminCategory(category) }, 201);
    } catch (error) {
      if (isUniqueConflict(error)) {
        return sendError(reply, 409, "CONFLICT", "A category with this slug already exists.");
      }

      if (isRecordNotFound(error)) {
        return sendError(reply, 404, "NOT_FOUND", "Category not found.");
      }

      throw error;
    }
  });

  app.patch("/api/admin/categories/:categoryId", adminOnly, async (request, reply) => {
    const parsedParams = categoryParamsSchema.safeParse(request.params);
    const parsedBody = categoryUpdateSchema.safeParse(request.body);

    if (!parsedParams.success) {
      return sendError(reply, 400, "VALIDATION_FAILED", "Invalid category id.", parsedParams.error.issues);
    }

    if (!parsedBody.success) {
      return sendError(reply, 400, "VALIDATION_FAILED", "Invalid category fields.", parsedBody.error.issues);
    }

    try {
      const category = await prisma.category.update({
        data: {
          ...(parsedBody.data.isActive === undefined ? {} : { isActive: parsedBody.data.isActive }),
          ...(parsedBody.data.name ? { name: parsedBody.data.name } : {}),
          ...(parsedBody.data.slug ? { slug: slugify(parsedBody.data.slug) } : {}),
          ...(parsedBody.data.sortOrder === undefined ? {} : { sortOrder: parsedBody.data.sortOrder })
        },
        include: {
          _count: {
            select: {
              rooms: true
            }
          }
        },
        where: { id: parsedParams.data.categoryId }
      });

      request.log.info({ adminUserId: request.authUser?.id, categoryId: category.id }, "Admin category updated");

      return sendOk(reply, { category: toAdminCategory(category) });
    } catch (error) {
      if (isUniqueConflict(error)) {
        return sendError(reply, 409, "CONFLICT", "A category with this slug already exists.");
      }

      throw error;
    }
  });
}
