-- CreateTable
CREATE TABLE "AutomationExecution" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "automationId" UUID NOT NULL,
    "appointmentId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "executedAt" TIMESTAMP(3),
    "outboxMessageId" UUID,
    "responseAction" VARCHAR(32),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationExecution_status_scheduledAt_id_idx" ON "AutomationExecution"("status", "scheduledAt", "id");

-- CreateIndex
CREATE INDEX "AutomationExecution_tenantId_unitId_appointmentId_status_idx" ON "AutomationExecution"("tenantId", "unitId", "appointmentId", "status");

-- CreateIndex
CREATE INDEX "AutomationExecution_tenantId_automationId_scheduledAt_idx" ON "AutomationExecution"("tenantId", "automationId", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationExecution_tenantId_id_key" ON "AutomationExecution"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationExecution_tenantId_idempotencyKey_key" ON "AutomationExecution"("tenantId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_tenantId_unitId_fkey" FOREIGN KEY ("tenantId", "unitId") REFERENCES "Unit"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_tenantId_automationId_fkey" FOREIGN KEY ("tenantId", "automationId") REFERENCES "Automation"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_tenantId_unitId_appointmentId_fkey" FOREIGN KEY ("tenantId", "unitId", "appointmentId") REFERENCES "Appointment"("tenantId", "unitId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_tenantId_patientId_fkey" FOREIGN KEY ("tenantId", "patientId") REFERENCES "Patient"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
