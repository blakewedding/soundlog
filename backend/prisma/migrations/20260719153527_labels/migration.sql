-- AlterTable
ALTER TABLE "Release" ADD COLUMN     "labelId" TEXT;

-- CreateTable
CREATE TABLE "Label" (
    "id" TEXT NOT NULL,
    "musicbrainzId" TEXT,
    "discogsId" TEXT,
    "name" TEXT NOT NULL,
    "area" TEXT,
    "founded" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Label_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Label_musicbrainzId_key" ON "Label"("musicbrainzId");

-- CreateIndex
CREATE UNIQUE INDEX "Label_discogsId_key" ON "Label"("discogsId");

-- CreateIndex
CREATE INDEX "Label_name_idx" ON "Label"("name");

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "Label"("id") ON DELETE SET NULL ON UPDATE CASCADE;
