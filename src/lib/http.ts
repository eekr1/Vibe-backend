import type { FastifyReply } from "fastify";

export type ApiErrorCode =
  | "ACCOUNT_BANNED"
  | "ACCOUNT_RESTRICTED"
  | "ACCOUNT_SUSPENDED"
  | "ADMIN_REQUIRED"
  | "AUTH_REQUIRED"
  | "CONFLICT"
  | "FORBIDDEN"
  | "INTERNAL_ERROR"
  | "INVALID_ROOM_STATE"
  | "INVALID_CREDENTIALS"
  | "INVALID_RESET_TOKEN"
  | "HOST_REQUIRED"
  | "MODERATION_ACTION_INVALID"
  | "MODERATION_TARGET_INVALID"
  | "REPORT_REASON_INVALID"
  | "REPORT_TARGET_INVALID"
  | "ROOM_ACCESS_DENIED"
  | "ROOM_ENDED"
  | "ROOM_FULL"
  | "ROOM_NOT_LIVE"
  | "ROOM_PASSWORD_REQUIRED"
  | "ROOM_USER_BANNED"
  | "NOT_FOUND"
  | "VALIDATION_FAILED";

export function sendOk<TData>(reply: FastifyReply, data: TData, statusCode = 200) {
  return reply.status(statusCode).send({
    ok: true,
    data
  });
}

export function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown
) {
  return reply.status(statusCode).send({
    ok: false,
    error: {
      code,
      details,
      message
    }
  });
}
