ALTER TABLE "OutboxAttempt"
  ADD COLUMN "processingMs" INTEGER,
  ADD COLUMN "queueLatencyMs" INTEGER;
