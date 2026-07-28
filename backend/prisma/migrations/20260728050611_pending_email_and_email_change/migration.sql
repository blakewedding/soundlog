-- AlterEnum
ALTER TYPE "VerificationPurpose" ADD VALUE 'EMAIL_CHANGE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pendingEmail" TEXT;
