ALTER TYPE "ConsentPurpose" ADD VALUE IF NOT EXISTS 'PROCEDURE_RETURN';

ALTER TABLE "AutomationExecution" ADD COLUMN "responseDeadlineAt" TIMESTAMP(3);

ALTER TABLE "Task" ADD COLUMN "procedureId" UUID;
CREATE INDEX "Task_tenantId_procedureId_status_idx" ON "Task"("tenantId", "procedureId", "status");
ALTER TABLE "Task" ADD CONSTRAINT "Task_tenantId_procedureId_fkey" FOREIGN KEY ("tenantId", "procedureId") REFERENCES "Procedure"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;