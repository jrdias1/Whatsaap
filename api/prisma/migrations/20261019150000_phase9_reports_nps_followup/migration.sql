CREATE TABLE "NpsSettings" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "unitId" UUID,
    "eligibleProcedureIds" JSONB,
    "delayHours" INTEGER NOT NULL DEFAULT 24,
    "question" VARCHAR(1000) NOT NULL DEFAULT 'De 0 a 10, o quanto voce recomendaria nossa clinica?',
    "allowComment" BOOLEAN NOT NULL DEFAULT true,
    "repeatAfterDays" INTEGER NOT NULL DEFAULT 0,
    "windowStartMinute" INTEGER NOT NULL DEFAULT 480,
    "windowEndMinute" INTEGER NOT NULL DEFAULT 1200,
    "createFollowupBelow" INTEGER,
    "followupDueHours" INTEGER NOT NULL DEFAULT 24,
    "responsibleUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NpsSettings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "NpsSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "NpsSettings_tenantId_key" ON "NpsSettings"("tenantId");
CREATE INDEX "NpsSettings_tenantId_enabled_unitId_idx" ON "NpsSettings"("tenantId", "enabled", "unitId");

CREATE TABLE "NpsSurvey" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "appointmentId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'PLANNED',
    "question" VARCHAR(1000) NOT NULL,
    "allowComment" BOOLEAN NOT NULL DEFAULT true,
    "score" INTEGER,
    "comment" VARCHAR(2000),
    "responseSource" VARCHAR(40),
    "respondedByUserId" UUID,
    "respondedAt" TIMESTAMP(3),
    "followupTaskId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NpsSurvey_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "NpsSurvey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NpsSurvey_tenantId_unitId_fkey" FOREIGN KEY ("tenantId", "unitId") REFERENCES "Unit"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NpsSurvey_tenantId_unitId_appointmentId_fkey" FOREIGN KEY ("tenantId", "unitId", "appointmentId") REFERENCES "Appointment"("tenantId", "unitId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NpsSurvey_tenantId_patientId_fkey" FOREIGN KEY ("tenantId", "patientId") REFERENCES "Patient"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NpsSurvey_score_check" CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= 10))
);
CREATE UNIQUE INDEX "NpsSurvey_tenantId_id_key" ON "NpsSurvey"("tenantId", "id");
CREATE UNIQUE INDEX "NpsSurvey_tenantId_appointmentId_key" ON "NpsSurvey"("tenantId", "appointmentId");
CREATE UNIQUE INDEX "NpsSurvey_followupTaskId_key" ON "NpsSurvey"("followupTaskId");
CREATE INDEX "NpsSurvey_tenantId_unitId_scheduledAt_status_idx" ON "NpsSurvey"("tenantId", "unitId", "scheduledAt", "status");
CREATE INDEX "NpsSurvey_tenantId_patientId_respondedAt_idx" ON "NpsSurvey"("tenantId", "patientId", "respondedAt");
