-- S4 E-MARKET (M2) — "Entraide" surface: additive & reversible.
-- 1) intent discriminator (free help vs paid service) on service_requests
-- 2) service_media ordered gallery (1-N, cascade), mirrors post_media
-- Existing rows become 'help_free' (they carry no budget → consistent).

-- CreateEnum
CREATE TYPE "ServiceIntent" AS ENUM ('help_free', 'paid_service');

-- AlterTable
ALTER TABLE "service_requests" ADD COLUMN "intent" "ServiceIntent" NOT NULL DEFAULT 'help_free';

-- CreateTable
CREATE TABLE "service_media" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "media_url" VARCHAR(500) NOT NULL,
    "thumbnail_url" VARCHAR(500),
    "media_type" "MediaType" NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "blurhash" VARCHAR(100),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "service_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_media_request_id_idx" ON "service_media"("request_id");

-- CreateIndex
CREATE INDEX "service_requests_intent_status_created_at_idx" ON "service_requests"("intent", "status", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "service_media" ADD CONSTRAINT "service_media_request_id_fkey"
    FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
