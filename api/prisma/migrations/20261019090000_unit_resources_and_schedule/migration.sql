-- CreateEnum
CREATE TYPE "UnitResourceType" AS ENUM ('PROFESSIONAL', 'ROOM', 'EQUIPMENT');

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "UnitResource" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "type" "UnitResourceType" NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentResource" (
    "tenantId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "appointmentId" UUID NOT NULL,
    "resourceId" UUID NOT NULL,

    CONSTRAINT "AppointmentResource_pkey" PRIMARY KEY ("tenantId","unitId","appointmentId","resourceId")
);

-- CreateTable
CREATE TABLE "ProcedureResourceRequirement" (
    "tenantId" UUID NOT NULL,
    "procedureId" UUID NOT NULL,
    "resourceType" "UnitResourceType" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ProcedureResourceRequirement_pkey" PRIMARY KEY ("tenantId","procedureId","resourceType")
);

-- CreateTable
CREATE TABLE "UnitWorkingInterval" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitWorkingInterval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitScheduleException" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "label" VARCHAR(160),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitScheduleException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitScheduleExceptionInterval" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "exceptionId" UUID NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,

    CONSTRAINT "UnitScheduleExceptionInterval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitScheduleBlock" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "resourceId" UUID,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "label" VARCHAR(160),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnitScheduleBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UnitResource_tenantId_unitId_type_active_name_idx" ON "UnitResource"("tenantId", "unitId", "type", "active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "UnitResource_tenantId_unitId_id_key" ON "UnitResource"("tenantId", "unitId", "id");

-- CreateIndex
CREATE INDEX "AppointmentResource_tenantId_unitId_resourceId_idx" ON "AppointmentResource"("tenantId", "unitId", "resourceId");

-- CreateIndex
CREATE INDEX "UnitWorkingInterval_tenantId_unitId_weekday_startMinute_idx" ON "UnitWorkingInterval"("tenantId", "unitId", "weekday", "startMinute");

-- CreateIndex
CREATE UNIQUE INDEX "UnitWorkingInterval_tenantId_unitId_id_key" ON "UnitWorkingInterval"("tenantId", "unitId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "UnitScheduleException_tenantId_unitId_id_key" ON "UnitScheduleException"("tenantId", "unitId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "UnitScheduleException_tenantId_unitId_date_key" ON "UnitScheduleException"("tenantId", "unitId", "date");

-- CreateIndex
CREATE INDEX "UnitScheduleExceptionInterval_tenantId_unitId_exceptionId_s_idx" ON "UnitScheduleExceptionInterval"("tenantId", "unitId", "exceptionId", "startMinute");

-- CreateIndex
CREATE INDEX "UnitScheduleBlock_tenantId_unitId_startsAt_endsAt_idx" ON "UnitScheduleBlock"("tenantId", "unitId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "UnitScheduleBlock_tenantId_unitId_resourceId_startsAt_endsA_idx" ON "UnitScheduleBlock"("tenantId", "unitId", "resourceId", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "UnitScheduleBlock_tenantId_unitId_id_key" ON "UnitScheduleBlock"("tenantId", "unitId", "id");

-- AddForeignKey
ALTER TABLE "UnitResource" ADD CONSTRAINT "UnitResource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitResource" ADD CONSTRAINT "UnitResource_tenantId_unitId_fkey" FOREIGN KEY ("tenantId", "unitId") REFERENCES "Unit"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentResource" ADD CONSTRAINT "AppointmentResource_tenantId_unitId_appointmentId_fkey" FOREIGN KEY ("tenantId", "unitId", "appointmentId") REFERENCES "Appointment"("tenantId", "unitId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentResource" ADD CONSTRAINT "AppointmentResource_tenantId_unitId_resourceId_fkey" FOREIGN KEY ("tenantId", "unitId", "resourceId") REFERENCES "UnitResource"("tenantId", "unitId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcedureResourceRequirement" ADD CONSTRAINT "ProcedureResourceRequirement_tenantId_procedureId_fkey" FOREIGN KEY ("tenantId", "procedureId") REFERENCES "Procedure"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitWorkingInterval" ADD CONSTRAINT "UnitWorkingInterval_tenantId_unitId_fkey" FOREIGN KEY ("tenantId", "unitId") REFERENCES "Unit"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitScheduleException" ADD CONSTRAINT "UnitScheduleException_tenantId_unitId_fkey" FOREIGN KEY ("tenantId", "unitId") REFERENCES "Unit"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitScheduleExceptionInterval" ADD CONSTRAINT "UnitScheduleExceptionInterval_tenantId_unitId_exceptionId_fkey" FOREIGN KEY ("tenantId", "unitId", "exceptionId") REFERENCES "UnitScheduleException"("tenantId", "unitId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitScheduleBlock" ADD CONSTRAINT "UnitScheduleBlock_tenantId_unitId_fkey" FOREIGN KEY ("tenantId", "unitId") REFERENCES "Unit"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitScheduleBlock" ADD CONSTRAINT "UnitScheduleBlock_tenantId_unitId_resourceId_fkey" FOREIGN KEY ("tenantId", "unitId", "resourceId") REFERENCES "UnitResource"("tenantId", "unitId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
