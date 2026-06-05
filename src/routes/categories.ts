import type { FastifyInstance } from "fastify";
import { prisma } from "../db/prisma.js";
import { sendOk } from "../lib/http.js";

export function registerCategoryRoutes(app: FastifyInstance) {
  app.get("/api/categories", async (_request, reply) => {
    const categories = await prisma.category.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      where: { isActive: true }
    });

    return sendOk(reply, { categories });
  });
}
