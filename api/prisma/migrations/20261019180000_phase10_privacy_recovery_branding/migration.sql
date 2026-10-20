ALTER TABLE "Tenant"
    ADD COLUMN "displayName" TEXT,
    ADD COLUMN "legalName" TEXT,
    ADD COLUMN "contactEmail" TEXT,
    ADD COLUMN "contactPhone" TEXT,
    ADD COLUMN "address" TEXT,
    ADD COLUMN "accentColor" TEXT,
    ADD COLUMN "secondaryColor" TEXT,
    ADD COLUMN "institutionalText" TEXT;

ALTER TABLE "Unit"
    ADD COLUMN "contactEmail" TEXT,
    ADD COLUMN "contactPhone" TEXT,
    ADD COLUMN "address" TEXT;

CREATE TYPE "PrivacyRequestStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'COMPLETED', 'REJECTED');
CREATE TYPE "PrivacyRequestType" AS ENUM ('ACCESS', 'CORRECTION', 'EXPORT', 'CONSENT_REVIEW', 'ERASURE', 'ANONYMIZATION', 'DATA_USE_QUESTION');

CREATE TABLE "PasswordRecoveryToken" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordRecoveryToken_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PasswordRecoveryToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PasswordRecoveryToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PasswordRecoveryToken_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "PrivacyRequest" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "type" "PrivacyRequestType" NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "PrivacyRequestStatus" NOT NULL DEFAULT 'OPEN',
    "closureReason" TEXT,
    "createdById" UUID NOT NULL,
    "assignedToId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrivacyRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PrivacyRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PrivacyRequest_tenantId_patientId_fkey" FOREIGN KEY ("tenantId", "patientId") REFERENCES "Patient"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PrivacyRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PrivacyRequest_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PrivacyRequest_tenantId_id_key" ON "PrivacyRequest"("tenantId", "id");

CREATE TABLE "PrivacyRequestEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "privacyRequestId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrivacyRequestEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PrivacyRequestEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PrivacyRequestEvent_tenantId_privacyRequestId_fkey" FOREIGN KEY ("tenantId", "privacyRequestId") REFERENCES "PrivacyRequest"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PasswordRecoveryToken_tokenHash_key" ON "PasswordRecoveryToken"("tokenHash");
CREATE INDEX "PasswordRecoveryToken_tenantId_userId_usedAt_expiresAt_idx" ON "PasswordRecoveryToken"("tenantId", "userId", "usedAt", "expiresAt");
CREATE INDEX "PrivacyRequest_tenantId_status_createdAt_idx" ON "PrivacyRequest"("tenantId", "status", "createdAt");
CREATE INDEX "PrivacyRequest_tenantId_patientId_createdAt_idx" ON "PrivacyRequest"("tenantId", "patientId", "createdAt");
CREATE INDEX "PrivacyRequestEvent_tenantId_privacyRequestId_occurredAt_idx" ON "PrivacyRequestEvent"("tenantId", "privacyRequestId", "occurredAt");

CREATE OR REPLACE FUNCTION prevent_privacy_request_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Privacy request history is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PrivacyRequestEvent_immutable"
BEFORE UPDATE OR DELETE ON "PrivacyRequestEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_privacy_request_event_mutation();
