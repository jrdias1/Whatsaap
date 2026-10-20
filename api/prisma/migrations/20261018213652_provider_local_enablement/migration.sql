-- AlterTable
ALTER TABLE "EvolutionConnection" ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "MetaConnection" ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true;
