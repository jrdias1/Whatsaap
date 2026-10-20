ALTER TABLE "Tenant" ADD COLUMN "provisioningKey" TEXT;
CREATE UNIQUE INDEX "Tenant_provisioningKey_key" ON "Tenant"("provisioningKey");
ALTER TABLE "Subscription" ADD COLUMN "limitOverrides" JSONB;
CREATE TABLE "PlatformAdminIdentity" (
  "userId" UUID NOT NULL,
  "totpSecretEncrypted" TEXT NOT NULL,
  "lastTotpStep" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformAdminIdentity_pkey" PRIMARY KEY ("userId")
);
ALTER TABLE "PlatformAdminIdentity" ADD CONSTRAINT "PlatformAdminIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
