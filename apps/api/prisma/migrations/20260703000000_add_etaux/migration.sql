-- E-TAUX — taux du jour (BCE) + prix crowdsourcés. Additive & reversible.
-- 1) FX daily snapshot from the ECB (free XML feed; EUR/XOF stays an app constant)
-- 2) community-reported prices + trust votes (billet/transfert/colis)
-- 3) 'community_price' target on the existing Report enum (reuse moderation)

-- AlterEnum
ALTER TYPE "ReportTargetType" ADD VALUE IF NOT EXISTS 'community_price';

-- CreateEnum
CREATE TYPE "CommunityPriceType" AS ENUM ('billet_avion', 'transfert_argent', 'colis_kg');

-- CreateEnum
CREATE TYPE "CommunityPriceStatus" AS ENUM ('active', 'removed');

-- CreateTable
CREATE TABLE "fx_rate_snapshots" (
    "id" UUID NOT NULL,
    "as_of" DATE NOT NULL,
    "eur_usd" DECIMAL(10,6) NOT NULL,
    "eur_cad" DECIMAL(10,6) NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'ecb',
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "fx_rate_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fx_rate_snapshots_as_of_key" ON "fx_rate_snapshots"("as_of");

-- CreateIndex
CREATE INDEX "fx_rate_snapshots_as_of_idx" ON "fx_rate_snapshots"("as_of" DESC);

-- CreateTable
CREATE TABLE "community_prices" (
    "id" UUID NOT NULL,
    "submitter_id" UUID NOT NULL,
    "type" "CommunityPriceType" NOT NULL,
    "origin_city" VARCHAR(100),
    "origin_country" CHAR(2),
    "dest_city" VARCHAR(100),
    "dest_country" CHAR(2),
    "provider" VARCHAR(100),
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "note" VARCHAR(280),
    "trust_score" INTEGER NOT NULL DEFAULT 0,
    "status" "CommunityPriceStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "community_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "community_prices_type_status_created_at_idx" ON "community_prices"("type", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "community_prices_type_origin_country_dest_country_status_idx" ON "community_prices"("type", "origin_country", "dest_country", "status");

-- CreateIndex
CREATE INDEX "community_prices_submitter_id_idx" ON "community_prices"("submitter_id");

-- CreateTable
CREATE TABLE "community_price_votes" (
    "user_id" UUID NOT NULL,
    "price_id" UUID NOT NULL,
    "value" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "community_price_votes_pkey" PRIMARY KEY ("user_id","price_id")
);

-- CreateIndex
CREATE INDEX "community_price_votes_price_id_idx" ON "community_price_votes"("price_id");

-- AddForeignKey
ALTER TABLE "community_prices" ADD CONSTRAINT "community_prices_submitter_id_fkey"
    FOREIGN KEY ("submitter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_price_votes" ADD CONSTRAINT "community_price_votes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_price_votes" ADD CONSTRAINT "community_price_votes_price_id_fkey"
    FOREIGN KEY ("price_id") REFERENCES "community_prices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
