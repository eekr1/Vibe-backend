import type { ModerationAction, Report, User } from "@prisma/client";

type UserSummary = Pick<User, "avatarUrl" | "displayName" | "id" | "username">;

type ModerationActionWithUsers = ModerationAction & {
  actor: UserSummary;
  target: UserSummary;
};

type ReportWithReporter = Report & {
  reporter: UserSummary;
  targetUser?: UserSummary | null;
};

function toUserSummary(user: UserSummary) {
  return {
    avatarUrl: user.avatarUrl,
    displayName: user.displayName,
    id: user.id,
    username: user.username
  };
}

export function toModerationActionResponse(action: ModerationActionWithUsers) {
  return {
    actionType: action.actionType,
    actor: toUserSummary(action.actor),
    createdAt: action.createdAt.toISOString(),
    id: action.id,
    reason: action.reason,
    roomId: action.roomId,
    target: toUserSummary(action.target)
  };
}

export function toReportResponse(report: ReportWithReporter) {
  return {
    createdAt: report.createdAt.toISOString(),
    details: report.details,
    id: report.id,
    messageId: report.messageId,
    reason: report.reason,
    reporter: toUserSummary(report.reporter),
    roomId: report.roomId,
    status: report.status,
    targetId: report.targetId,
    targetType: report.targetType,
    targetUser: report.targetUser ? toUserSummary(report.targetUser) : null
  };
}
