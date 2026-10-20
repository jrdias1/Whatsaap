-- CreateEnum
CREATE TYPE "ReferralQualificationCriterion" AS ENUM ('LEAD_REGISTERED', 'FIRST_NATIVE_APPOINTMENT_COMPLETED');

-- CreateEnum
CREATE TYPE "ReferralCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('CLICKED', 'LEAD_REGISTERED', 'PATIENT_LINKED', 'QUALIFIED', 'CONVERTED', 'PENDING_VERIFICATION', 'REJECTED', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ReferralRewardType" AS ENUM ('VOUCHER', 'SESSION_CREDIT', 'DISCOUNT', 'SERVICE');

-- CreateEnum
CREATE TYPE "ReferralRewardStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'PARTIALLY_USED', 'USED', 'EXPIRED', 'CANCELLED', 'REJECTED');

-- CreateTable
CREATE TABLE "ReferralCampaign" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "status" "ReferralCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "qualificationCriterion" "ReferralQualificationCriterion" NOT NULL,
    "rewardEveryQualifiedCount" INTEGER NOT NULL DEFAULT 1,
    "rewardType" "ReferralRewardType" NOT NULL,
    "rewardQuantity" INTEGER NOT NULL DEFAULT 1,
    "rewardDescription" VARCHAR(500) NOT NULL,
    "rewardValidityDays" INTEGER NOT NULL DEFAULT 90,
    "maxRewardsPerParticipant" INTEGER NOT NULL DEFAULT 1,
    "requireHumanApproval" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralCampaignUnit" (
    "tenantId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "unitId" UUID NOT NULL,

    CONSTRAINT "ReferralCampaignUnit_pkey" PRIMARY KEY ("tenantId","campaignId","unitId")
);

-- CreateTable
CREATE TABLE "ReferralParticipant" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "shareTokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "indicatorPatientId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "patientId" UUID,
    "appointmentId" UUID,
    "clickKey" VARCHAR(100) NOT NULL,
    "claimTokenHash" TEXT NOT NULL,
    "leadPhoneNormalized" TEXT,
    "status" "ReferralStatus" NOT NULL DEFAULT 'CLICKED',
    "firstClickAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leadRegisteredAt" TIMESTAMP(3),
    "patientLinkedAt" TIMESTAMP(3),
    "qualifiedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "qualificationEvidence" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "referralId" UUID NOT NULL,
    "actorId" UUID,
    "event" VARCHAR(50) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralReward" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "milestoneNumber" INTEGER NOT NULL,
    "type" "ReferralRewardType" NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "authorizedQty" INTEGER NOT NULL,
    "usedQty" INTEGER NOT NULL DEFAULT 0,
    "status" "ReferralRewardStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approvedById" UUID,
    "issuedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "voucherHash" TEXT,
    "voucherLast4" VARCHAR(4),
    "decisionReason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralRewardSource" (
    "tenantId" UUID NOT NULL,
    "rewardId" UUID NOT NULL,
    "referralId" UUID NOT NULL,

    CONSTRAINT "ReferralRewardSource_pkey" PRIMARY KEY ("tenantId","rewardId","referralId")
);

-- CreateTable
CREATE TABLE "ReferralRewardUse" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "rewardId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(100) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "actorUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralRewardUse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReferralCampaign_tenantId_status_startsAt_endsAt_idx" ON "ReferralCampaign"("tenantId", "status", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCampaign_tenantId_id_key" ON "ReferralCampaign"("tenantId", "id");

-- CreateIndex
CREATE INDEX "ReferralCampaignUnit_tenantId_unitId_idx" ON "ReferralCampaignUnit"("tenantId", "unitId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralParticipant_shareTokenHash_key" ON "ReferralParticipant"("shareTokenHash");

-- CreateIndex
CREATE INDEX "ReferralParticipant_tenantId_campaignId_unitId_idx" ON "ReferralParticipant"("tenantId", "campaignId", "unitId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralParticipant_tenantId_id_key" ON "ReferralParticipant"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralParticipant_tenantId_campaignId_patientId_key" ON "ReferralParticipant"("tenantId", "campaignId", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralParticipant_tenantId_campaignId_id_key" ON "ReferralParticipant"("tenantId", "campaignId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_claimTokenHash_key" ON "Referral"("claimTokenHash");

-- CreateIndex
CREATE INDEX "Referral_tenantId_campaignId_participantId_status_idx" ON "Referral"("tenantId", "campaignId", "participantId", "status");

-- CreateIndex
CREATE INDEX "Referral_tenantId_patientId_status_idx" ON "Referral"("tenantId", "patientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_tenantId_id_key" ON "Referral"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_tenantId_clickKey_key" ON "Referral"("tenantId", "clickKey");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_tenantId_leadPhoneNormalized_key" ON "Referral"("tenantId", "leadPhoneNormalized");

-- CreateIndex
CREATE INDEX "ReferralEvent_tenantId_referralId_createdAt_idx" ON "ReferralEvent"("tenantId", "referralId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralReward_voucherHash_key" ON "ReferralReward"("voucherHash");

-- CreateIndex
CREATE INDEX "ReferralReward_tenantId_status_createdAt_idx" ON "ReferralReward"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ReferralReward_tenantId_participantId_status_idx" ON "ReferralReward"("tenantId", "participantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralReward_tenantId_id_key" ON "ReferralReward"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralReward_tenantId_campaignId_participantId_milestoneN_key" ON "ReferralReward"("tenantId", "campaignId", "participantId", "milestoneNumber");

-- CreateIndex
CREATE INDEX "ReferralRewardSource_tenantId_referralId_idx" ON "ReferralRewardSource"("tenantId", "referralId");

-- CreateIndex
CREATE INDEX "ReferralRewardUse_tenantId_rewardId_createdAt_idx" ON "ReferralRewardUse"("tenantId", "rewardId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralRewardUse_tenantId_idempotencyKey_key" ON "ReferralRewardUse"("tenantId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "ReferralCampaign" ADD CONSTRAINT "ReferralCampaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCampaign" ADD CONSTRAINT "ReferralCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCampaignUnit" ADD CONSTRAINT "ReferralCampaignUnit_tenantId_campaignId_fkey" FOREIGN KEY ("tenantId", "campaignId") REFERENCES "ReferralCampaign"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCampaignUnit" ADD CONSTRAINT "ReferralCampaignUnit_tenantId_unitId_fkey" FOREIGN KEY ("tenantId", "unitId") REFERENCES "Unit"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralParticipant" ADD CONSTRAINT "ReferralParticipant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralParticipant" ADD CONSTRAINT "ReferralParticipant_tenantId_campaignId_fkey" FOREIGN KEY ("tenantId", "campaignId") REFERENCES "ReferralCampaign"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralParticipant" ADD CONSTRAINT "ReferralParticipant_tenantId_patientId_fkey" FOREIGN KEY ("tenantId", "patientId") REFERENCES "Patient"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralParticipant" ADD CONSTRAINT "ReferralParticipant_tenantId_unitId_fkey" FOREIGN KEY ("tenantId", "unitId") REFERENCES "Unit"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_tenantId_campaignId_fkey" FOREIGN KEY ("tenantId", "campaignId") REFERENCES "ReferralCampaign"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_tenantId_campaignId_participantId_fkey" FOREIGN KEY ("tenantId", "campaignId", "participantId") REFERENCES "ReferralParticipant"("tenantId", "campaignId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_tenantId_indicatorPatientId_fkey" FOREIGN KEY ("tenantId", "indicatorPatientId") REFERENCES "Patient"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_tenantId_patientId_fkey" FOREIGN KEY ("tenantId", "patientId") REFERENCES "Patient"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_tenantId_unitId_fkey" FOREIGN KEY ("tenantId", "unitId") REFERENCES "Unit"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_tenantId_unitId_appointmentId_fkey" FOREIGN KEY ("tenantId", "unitId", "appointmentId") REFERENCES "Appointment"("tenantId", "unitId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralEvent" ADD CONSTRAINT "ReferralEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralEvent" ADD CONSTRAINT "ReferralEvent_tenantId_referralId_fkey" FOREIGN KEY ("tenantId", "referralId") REFERENCES "Referral"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_tenantId_campaignId_fkey" FOREIGN KEY ("tenantId", "campaignId") REFERENCES "ReferralCampaign"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_tenantId_campaignId_participantId_fkey" FOREIGN KEY ("tenantId", "campaignId", "participantId") REFERENCES "ReferralParticipant"("tenantId", "campaignId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_tenantId_unitId_fkey" FOREIGN KEY ("tenantId", "unitId") REFERENCES "Unit"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralRewardSource" ADD CONSTRAINT "ReferralRewardSource_tenantId_rewardId_fkey" FOREIGN KEY ("tenantId", "rewardId") REFERENCES "ReferralReward"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralRewardSource" ADD CONSTRAINT "ReferralRewardSource_tenantId_referralId_fkey" FOREIGN KEY ("tenantId", "referralId") REFERENCES "Referral"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralRewardUse" ADD CONSTRAINT "ReferralRewardUse_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralRewardUse" ADD CONSTRAINT "ReferralRewardUse_tenantId_rewardId_fkey" FOREIGN KEY ("tenantId", "rewardId") REFERENCES "ReferralReward"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralRewardUse" ADD CONSTRAINT "ReferralRewardUse_tenantId_unitId_fkey" FOREIGN KEY ("tenantId", "unitId") REFERENCES "Unit"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
