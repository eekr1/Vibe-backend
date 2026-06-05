import type { User } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../db/prisma.js";
import type { RuntimeConfig } from "../config.js";
import type { AuthUser } from "./auth-types.js";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

type AuthTokenPayload = {
  sub: string;
};

export function toAuthUser(user: User): AuthUser {
  return {
    accountState: user.accountState,
    avatarUrl: user.avatarUrl,
    displayName: user.displayName,
    email: user.email,
    id: user.id,
    role: user.role,
    username: user.username
  };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export function signAuthToken(userId: string, config: RuntimeConfig): string {
  return jwt.sign({ sub: userId } satisfies AuthTokenPayload, config.sessionSecret, {
    expiresIn: SESSION_TTL_SECONDS
  });
}

export function verifyAuthToken(token: string, config: RuntimeConfig): AuthTokenPayload {
  const payload = jwt.verify(token, config.sessionSecret);

  if (!payload || typeof payload !== "object" || typeof payload.sub !== "string") {
    throw new Error("Invalid auth token payload.");
  }

  return { sub: payload.sub };
}

export async function findAuthUserById(userId: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });

  return user ? toAuthUser(user) : null;
}

export function getSessionMaxAgeSeconds() {
  return SESSION_TTL_SECONDS;
}
