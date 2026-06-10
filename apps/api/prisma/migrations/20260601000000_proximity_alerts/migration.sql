-- AlterEnum
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block alongside other
-- statements on PostgreSQL < 12 / certain setups, so it is kept as its own statement.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'proximity';

-- AlterTable
ALTER TABLE "users" ADD COLUMN "proximity_alerts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "proximity_radius" INTEGER NOT NULL DEFAULT 100;
