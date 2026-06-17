import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { sendError, sendOk } from "../lib/http.js";

const publicContentParamsSchema = z.object({
  pageKey: z.enum(["terms", "privacy", "community-guidelines", "support"])
});

function toPublicContent(content: {
  pageKey: string;
  publishedAt: Date | null;
  publishedBody: string | null;
  publishedTitle: string | null;
  updatedAt: Date;
}) {
  return {
    body: content.publishedBody,
    pageKey: content.pageKey,
    publishedAt: content.publishedAt ? content.publishedAt.toISOString() : null,
    title: content.publishedTitle,
    updatedAt: content.updatedAt.toISOString()
  };
}

export function registerContentRoutes(app: FastifyInstance) {
  app.get("/api/content/:pageKey", async (request, reply) => {
    const parsed = publicContentParamsSchema.safeParse(request.params);

    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_FAILED", "Invalid content page.", parsed.error.issues);
    }

    const content = await prisma.platformContent.findUnique({
      select: {
        pageKey: true,
        publishedAt: true,
        publishedBody: true,
        publishedTitle: true,
        status: true,
        updatedAt: true
      },
      where: { pageKey: parsed.data.pageKey }
    });

    if (!content || content.status !== "published" || !content.publishedBody || !content.publishedTitle) {
      request.log.warn({ pageKey: parsed.data.pageKey }, "Published platform content not found");
      return sendError(reply, 404, "NOT_FOUND", "This page is not published yet.");
    }

    request.log.info({ pageKey: content.pageKey }, "Published platform content loaded");

    return sendOk(reply, { content: toPublicContent(content) });
  });
}
