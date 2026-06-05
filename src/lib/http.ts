import type { FastifyReply } from "fastify";

export type ApiErrorCode =
  | "ACCOUNT_BANNED"
  | "ACCOUNT_RESTRICTED"
  | "ACCOUNT_SUSPENDED"
  | "AUTH_REQUIRED"
  | "CONFLICT"
  | "INTERNAL_ERROR"
  | "INVALID_CREDENTIALS"
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
