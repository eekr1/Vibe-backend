import type { AccountState, UserRole } from "@prisma/client";

export type AuthUser = {
  accountState: AccountState;
  avatarUrl: string | null;
  displayName: string;
  email: string;
  id: string;
  role: UserRole;
  username: string;
};

export const AUTH_COOKIE_NAME = "vibehall_session";
