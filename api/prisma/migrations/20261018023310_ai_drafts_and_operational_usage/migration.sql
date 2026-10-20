-- CreateEnum
CREATE TYPE "MessageOrigin" AS ENUM ('HUMAN', 'AI_DRAFT_HUMAN_APPROVED', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AiDraftStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "approvedById" UUID,
ADD COLUMN     "origin" "MessageOrigin" NOT NULL DEFAULT 'HUMAN';

-- CreateTable
CREATE TABLE "AiSettings" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "conversationProcessingAuthorized" BOOLEAN NOT NULL DEFAULT false,
    "apiKeyEncrypted" TEXT,
    "model" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    "instructions" VARCHAR(4000) NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDraft" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "status" "AiDraftStatus" NOT NULL DEFAULT 'PENDING',
    "body" VARCHAR(4000) NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" UUID,

    CONSTRAINT "AiDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiSettings_tenantId_key" ON "AiSettings"("tenantId");

-- CreateIndex
CREATE INDEX "AiDraft_tenantId_conversationId_status_createdAt_idx" ON "AiDraft"("tenantId", "conversationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiDraft_tenantId_id_key" ON "AiDraft"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDraft" ADD CONSTRAINT "AiDraft_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDraft" ADD CONSTRAINT "AiDraft_tenantId_conversationId_fkey" FOREIGN KEY ("tenantId", "conversationId") REFERENCES "Conversation"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
