CREATE TABLE "PatientDocument" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "uploadedByUserId" UUID,
    "originalName" VARCHAR(180) NOT NULL,
    "mimeType" VARCHAR(80) NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientDocument_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PatientDocument_size_check" CHECK ("size" > 0 AND "size" <= 10485760),
    CONSTRAINT "PatientDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PatientDocument_tenantId_patientId_fkey" FOREIGN KEY ("tenantId", "patientId") REFERENCES "Patient"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PatientDocument_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PatientDocument_storageKey_key" ON "PatientDocument"("storageKey");
CREATE UNIQUE INDEX "PatientDocument_tenantId_id_key" ON "PatientDocument"("tenantId", "id");
CREATE INDEX "PatientDocument_tenantId_patientId_createdAt_idx" ON "PatientDocument"("tenantId", "patientId", "createdAt");
