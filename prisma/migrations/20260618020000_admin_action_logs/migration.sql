CREATE TYPE "AdminActionType" AS ENUM (
  'account_restricted',
  'account_suspended',
  'account_banned',
  'account_restored',
  'message_hidden',
  'message_deleted',
  'room_ended',
  'room_deleted'
);

CREATE TYPE "AdminActionTargetType" AS ENUM (
  'user',
  'message',
  'room'
);

CREATE TABLE "admin_action_logs" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "reportId" TEXT,
  "targetType" "AdminActionTargetType" NOT NULL,
  "targetId" TEXT NOT NULL,
  "actionType" "AdminActionType" NOT NULL,
  "reason" TEXT,
  "metadata" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_action_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_action_logs_actorUserId_createdAt_idx" ON "admin_action_logs"("actorUserId", "createdAt");
CREATE INDEX "admin_action_logs_reportId_createdAt_idx" ON "admin_action_logs"("reportId", "createdAt");
CREATE INDEX "admin_action_logs_targetType_targetId_createdAt_idx" ON "admin_action_logs"("targetType", "targetId", "createdAt");
CREATE INDEX "admin_action_logs_actionType_createdAt_idx" ON "admin_action_logs"("actionType", "createdAt");

ALTER TABLE "admin_action_logs" ADD CONSTRAINT "admin_action_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "admin_action_logs" ADD CONSTRAINT "admin_action_logs_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
