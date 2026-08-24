-- AlterTable
ALTER TABLE "Artist" ALTER COLUMN "aliases" SET DEFAULT ARRAY[]::TEXT[];

-- Backfill the rows that predate the default.
--
-- §10 read-back, performed before this was written:
--   SELECT count(*) FROM "Artist" WHERE aliases IS NULL;  -> 23
--   SELECT id, name FROM "Artist" WHERE aliases IS NULL;  -> 23 rows, all read
-- Every one is an artist the 6.3e alias backfill reported as "no aliases
-- upstream", which is exactly the population this is meant to normalise. The
-- filter below is the identical filter that SELECT carried.
--
-- Safe by construction: it can only turn NULL into an empty array, and Prisma
-- already reads both as `[]`, so no application behaviour changes.
UPDATE "Artist" SET "aliases" = ARRAY[]::TEXT[] WHERE "aliases" IS NULL;
