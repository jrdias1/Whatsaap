CREATE TYPE "ConsentEvidenceType" AS ENUM (
  'SIGNED_DOCUMENT',
  'WRITTEN_FORM',
  'WHATSAPP_MESSAGE',
  'EMAIL_MESSAGE',
  'OTHER'
);

ALTER TABLE "ConsentPreference"
  ADD COLUMN "evidenceType" "ConsentEvidenceType",
  ADD COLUMN "evidenceReference" TEXT;

ALTER TABLE "ConsentEvent"
  ADD COLUMN "evidenceType" "ConsentEvidenceType",
  ADD COLUMN "evidenceReference" TEXT;
