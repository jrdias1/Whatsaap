ALTER TABLE "AutomationExecution"
ADD COLUMN "stepKey" VARCHAR(80);

CREATE INDEX "AutomationExecution_tenantId_patientId_status_scheduledAt_idx"
ON "AutomationExecution"("tenantId", "patientId", "status", "scheduledAt");
