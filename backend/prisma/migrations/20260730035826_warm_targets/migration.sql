-- CreateEnum
CREATE TYPE "WarmTargetSource" AS ENUM ('CURATED', 'CHART', 'AGGREGATED');

-- CreateTable
CREATE TABLE "WarmTarget" (
    "id" TEXT NOT NULL,
    "artistMbid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" "WarmTargetSource" NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastWarmedAt" TIMESTAMP(3),
    "lastResult" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarmTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WarmTarget_artistMbid_key" ON "WarmTarget"("artistMbid");

-- CreateIndex
CREATE INDEX "WarmTarget_enabled_weight_idx" ON "WarmTarget"("enabled", "weight");
