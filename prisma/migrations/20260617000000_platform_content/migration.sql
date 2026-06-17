-- CreateEnum
CREATE TYPE "PlatformContentStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "PlatformContentAuditAction" AS ENUM ('draft_saved', 'published', 'unpublished');

-- CreateTable
CREATE TABLE "platform_content" (
    "id" TEXT NOT NULL,
    "pageKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "draftBody" TEXT NOT NULL,
    "publishedTitle" TEXT,
    "publishedBody" TEXT,
    "status" "PlatformContentStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "draftUpdatedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "lastEditorUserId" TEXT,
    "lastPublisherUserId" TEXT,

    CONSTRAINT "platform_content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_content_audits" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actionType" "PlatformContentAuditAction" NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_content_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_content_pageKey_key" ON "platform_content"("pageKey");

-- CreateIndex
CREATE INDEX "platform_content_status_idx" ON "platform_content"("status");

-- CreateIndex
CREATE INDEX "platform_content_audits_contentId_createdAt_idx" ON "platform_content_audits"("contentId", "createdAt");

-- CreateIndex
CREATE INDEX "platform_content_audits_actorUserId_createdAt_idx" ON "platform_content_audits"("actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "platform_content" ADD CONSTRAINT "platform_content_lastEditorUserId_fkey" FOREIGN KEY ("lastEditorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_content" ADD CONSTRAINT "platform_content_lastPublisherUserId_fkey" FOREIGN KEY ("lastPublisherUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_content_audits" ADD CONSTRAINT "platform_content_audits_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_content_audits" ADD CONSTRAINT "platform_content_audits_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "platform_content"("id") ON DELETE CASCADE ON UPDATE CASCADE;
