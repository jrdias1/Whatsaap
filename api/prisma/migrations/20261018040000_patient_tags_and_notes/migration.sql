CREATE TABLE "PatientTagDefinition" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PatientTagDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PatientTag" (
    "tenantId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "tagId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PatientTag_pkey" PRIMARY KEY ("tenantId", "patientId", "tagId")
);

CREATE TABLE "PatientNote" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "authorUserId" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PatientNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PatientTagDefinition_tenantId_id_key" ON "PatientTagDefinition"("tenantId", "id");
CREATE UNIQUE INDEX "PatientTagDefinition_tenantId_name_key" ON "PatientTagDefinition"("tenantId", "name");
CREATE INDEX "PatientTagDefinition_tenantId_name_idx" ON "PatientTagDefinition"("tenantId", "name");
CREATE INDEX "PatientTag_tenantId_tagId_idx" ON "PatientTag"("tenantId", "tagId");
CREATE INDEX "PatientNote_tenantId_patientId_createdAt_idx" ON "PatientNote"("tenantId", "patientId", "createdAt");

ALTER TABLE "PatientTagDefinition" ADD CONSTRAINT "PatientTagDefinition_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatientTag" ADD CONSTRAINT "PatientTag_tenantId_patientId_fkey"
  FOREIGN KEY ("tenantId", "patientId") REFERENCES "Patient"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatientTag" ADD CONSTRAINT "PatientTag_tenantId_tagId_fkey"
  FOREIGN KEY ("tenantId", "tagId") REFERENCES "PatientTagDefinition"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatientNote" ADD CONSTRAINT "PatientNote_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatientNote" ADD CONSTRAINT "PatientNote_tenantId_patientId_fkey"
  FOREIGN KEY ("tenantId", "patientId") REFERENCES "Patient"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatientNote" ADD CONSTRAINT "PatientNote_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
