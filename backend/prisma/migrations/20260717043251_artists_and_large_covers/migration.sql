-- AlterTable
ALTER TABLE "Release" ADD COLUMN     "coverUrlLarge" TEXT;

-- CreateTable
CREATE TABLE "Artist" (
    "id" TEXT NOT NULL,
    "musicbrainzId" TEXT,
    "name" TEXT NOT NULL,
    "sortName" TEXT,
    "type" TEXT,
    "area" TEXT,
    "beginDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Artist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Artist_musicbrainzId_key" ON "Artist"("musicbrainzId");

-- CreateIndex
CREATE INDEX "Artist_name_idx" ON "Artist"("name");

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
