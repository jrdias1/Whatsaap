ALTER TABLE "MetaWebhookEvent"
ADD COLUMN "enqueuedAt" TIMESTAMP(3);

CREATE INDEX "MetaWebhookEvent_enqueue_recovery_idx"
ON "MetaWebhookEvent" ("status", "enqueuedAt", "nextAttemptAt", "receivedAt");
