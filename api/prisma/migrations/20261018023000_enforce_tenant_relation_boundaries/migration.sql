-- Preserve existing unit memberships by deriving tenant from their membership.
ALTER TABLE "UnitMembership" ADD COLUMN "tenantId" UUID;
UPDATE "UnitMembership" AS um
SET "tenantId" = m."tenantId"
FROM "Membership" AS m
WHERE m."id" = um."membershipId";
ALTER TABLE "UnitMembership" ALTER COLUMN "tenantId" SET NOT NULL;

ALTER TABLE "ConsentEvent" DROP CONSTRAINT "ConsentEvent_patientId_fkey";
ALTER TABLE "ConsentPreference" DROP CONSTRAINT "ConsentPreference_patientId_fkey";
ALTER TABLE "Patient" DROP CONSTRAINT "Patient_unitId_fkey";
ALTER TABLE "Procedure" DROP CONSTRAINT "Procedure_unitId_fkey";
ALTER TABLE "UnitMembership" DROP CONSTRAINT "UnitMembership_membershipId_fkey";
ALTER TABLE "UnitMembership" DROP CONSTRAINT "UnitMembership_unitId_fkey";
DROP INDEX "ConsentPreference_patientId_channel_purpose_key";

CREATE UNIQUE INDEX "ConsentPreference_tenantId_patientId_channel_purpose_key"
  ON "ConsentPreference"("tenantId", "patientId", "channel", "purpose");
CREATE UNIQUE INDEX "Membership_tenantId_id_key" ON "Membership"("tenantId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "Patient_tenantId_id_key" ON "Patient"("tenantId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "Procedure_tenantId_id_key" ON "Procedure"("tenantId", "id");
CREATE INDEX "UnitMembership_tenantId_membershipId_idx" ON "UnitMembership"("tenantId", "membershipId");

ALTER TABLE "UnitMembership"
  ADD CONSTRAINT "UnitMembership_tenantId_membershipId_fkey"
  FOREIGN KEY ("tenantId", "membershipId") REFERENCES "Membership"("tenantId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnitMembership"
  ADD CONSTRAINT "UnitMembership_tenantId_unitId_fkey"
  FOREIGN KEY ("tenantId", "unitId") REFERENCES "Unit"("tenantId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Patient"
  ADD CONSTRAINT "Patient_tenantId_unitId_fkey"
  FOREIGN KEY ("tenantId", "unitId") REFERENCES "Unit"("tenantId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConsentPreference"
  ADD CONSTRAINT "ConsentPreference_tenantId_patientId_fkey"
  FOREIGN KEY ("tenantId", "patientId") REFERENCES "Patient"("tenantId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsentEvent"
  ADD CONSTRAINT "ConsentEvent_tenantId_patientId_fkey"
  FOREIGN KEY ("tenantId", "patientId") REFERENCES "Patient"("tenantId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Procedure"
  ADD CONSTRAINT "Procedure_tenantId_unitId_fkey"
  FOREIGN KEY ("tenantId", "unitId") REFERENCES "Unit"("tenantId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
