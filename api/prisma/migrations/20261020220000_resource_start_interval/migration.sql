ALTER TABLE "UnitResource" ADD COLUMN "startIntervalMinutes" INTEGER;
ALTER TABLE "UnitResource" ADD CONSTRAINT "UnitResource_startIntervalMinutes_check"
  CHECK ("startIntervalMinutes" IS NULL OR "startIntervalMinutes" IN (5, 10, 15, 20, 30, 60));
