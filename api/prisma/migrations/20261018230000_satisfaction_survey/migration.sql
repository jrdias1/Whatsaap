ALTER TYPE "ConsentPurpose" ADD VALUE IF NOT EXISTS 'SATISFACTION_SURVEY';
CREATE TYPE "SatisfactionClassification" AS ENUM ('EXCELLENT', 'GOOD', 'REGULAR', 'POOR', 'VERY_POOR');
CREATE TYPE "SatisfactionSurveyState" AS ENUM ('PENDING', 'OUTBOXED', 'RESPONDED', 'EXPIRED', 'SUPPRESSED', 'FAILED');

ALTER TABLE "Task" ADD COLUMN "appointmentId" UUID;
ALTER TABLE "Task" ADD CONSTRAINT "Task_tenantId_unitId_appointmentId_fkey" FOREIGN KEY ("tenantId", "unitId", "appointmentId") REFERENCES "Appointment"("tenantId", "unitId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SatisfactionSurvey" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "unitId" UUID NOT NULL,
  "automationId" UUID NOT NULL,
  "executionId" UUID NOT NULL,
  "appointmentId" UUID NOT NULL,
  "patientId" UUID NOT NULL,
  "procedureId" UUID,
  "channel" "ConsentChannel" NOT NULL DEFAULT 'WHATSAPP',
  "provider" TEXT NOT NULL,
  "question" VARCHAR(1000) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "state" "SatisfactionSurveyState" NOT NULL DEFAULT 'PENDING',
  "classification" "SatisfactionClassification",
  "responseSource" VARCHAR(40),
  "responseMessageId" VARCHAR(200),
  "respondedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "outboxMessageId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SatisfactionSurvey_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SatisfactionSurvey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SatisfactionSurvey_tenantId_unitId_fkey" FOREIGN KEY ("tenantId", "unitId") REFERENCES "Unit"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SatisfactionSurvey_tenantId_automationId_fkey" FOREIGN KEY ("tenantId", "automationId") REFERENCES "Automation"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SatisfactionSurvey_tenantId_executionId_fkey" FOREIGN KEY ("tenantId", "executionId") REFERENCES "AutomationExecution"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SatisfactionSurvey_tenantId_unitId_appointmentId_fkey" FOREIGN KEY ("tenantId", "unitId", "appointmentId") REFERENCES "Appointment"("tenantId", "unitId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SatisfactionSurvey_tenantId_patientId_fkey" FOREIGN KEY ("tenantId", "patientId") REFERENCES "Patient"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SatisfactionSurvey_tenantId_procedureId_fkey" FOREIGN KEY ("tenantId", "procedureId") REFERENCES "Procedure"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SatisfactionSurvey_executionId_key" ON "SatisfactionSurvey"("executionId");
CREATE UNIQUE INDEX "SatisfactionSurvey_tenantId_id_key" ON "SatisfactionSurvey"("tenantId", "id");
CREATE UNIQUE INDEX "SatisfactionSurvey_tenantId_executionId_key" ON "SatisfactionSurvey"("tenantId", "executionId");
CREATE UNIQUE INDEX "SatisfactionSurvey_tenantId_automationId_appointmentId_key" ON "SatisfactionSurvey"("tenantId", "automationId", "appointmentId");
CREATE INDEX "SatisfactionSurvey_tenantId_unitId_state_expiresAt_idx" ON "SatisfactionSurvey"("tenantId", "unitId", "state", "expiresAt");
CREATE INDEX "SatisfactionSurvey_tenantId_patientId_state_expiresAt_idx" ON "SatisfactionSurvey"("tenantId", "patientId", "state", "expiresAt");

CREATE TABLE "SatisfactionSurveyEvent" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "surveyId" UUID NOT NULL,
  "event" VARCHAR(40) NOT NULL,
  "metadata" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SatisfactionSurveyEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SatisfactionSurveyEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SatisfactionSurveyEvent_tenantId_surveyId_fkey" FOREIGN KEY ("tenantId", "surveyId") REFERENCES "SatisfactionSurvey"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SatisfactionSurveyEvent_tenantId_surveyId_occurredAt_idx" ON "SatisfactionSurveyEvent"("tenantId", "surveyId", "occurredAt");

CREATE FUNCTION prevent_satisfaction_survey_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SatisfactionSurveyEvent is append-only';
END;
$$;
CREATE TRIGGER "SatisfactionSurveyEvent_immutable_update" BEFORE UPDATE ON "SatisfactionSurveyEvent" FOR EACH ROW EXECUTE FUNCTION prevent_satisfaction_survey_event_mutation();
CREATE TRIGGER "SatisfactionSurveyEvent_immutable_delete" BEFORE DELETE ON "SatisfactionSurveyEvent" FOR EACH ROW EXECUTE FUNCTION prevent_satisfaction_survey_event_mutation();