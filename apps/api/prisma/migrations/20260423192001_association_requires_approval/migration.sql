-- AlterEnum
ALTER TYPE "MembershipStatus" ADD VALUE 'rejected';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'association_join_request';
ALTER TYPE "NotificationType" ADD VALUE 'association_join_approved';
ALTER TYPE "NotificationType" ADD VALUE 'association_join_rejected';

-- AlterTable
ALTER TABLE "associations" ADD COLUMN     "requires_approval" BOOLEAN NOT NULL DEFAULT false;
