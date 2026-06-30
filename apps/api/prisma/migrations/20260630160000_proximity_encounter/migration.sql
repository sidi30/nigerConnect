-- Mutual double-blind proximity encounter (Sprint 2 — PX3).
CREATE TYPE "ProximityEncounterStatus" AS ENUM ('active', 'requested', 'accepted', 'declined', 'expired');

CREATE TABLE "proximity_encounters" (
    "id" UUID NOT NULL,
    "user_a_id" UUID NOT NULL,
    "user_b_id" UUID NOT NULL,
    "status" "ProximityEncounterStatus" NOT NULL DEFAULT 'active',
    "requester_id" UUID,
    "distance_bucket" INTEGER NOT NULL,
    "zone" VARCHAR(20) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "responded_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    CONSTRAINT "proximity_encounters_pkey" PRIMARY KEY ("id")
);

-- Unordered-pair dedup: participants are always stored sorted (user_a_id < user_b_id).
CREATE UNIQUE INDEX "proximity_encounters_user_a_id_user_b_id_key" ON "proximity_encounters"("user_a_id", "user_b_id");
CREATE INDEX "proximity_encounters_user_b_id_idx" ON "proximity_encounters"("user_b_id");
CREATE INDEX "proximity_encounters_requester_id_idx" ON "proximity_encounters"("requester_id");

ALTER TABLE "proximity_encounters" ADD CONSTRAINT "proximity_encounters_user_a_id_fkey"
    FOREIGN KEY ("user_a_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proximity_encounters" ADD CONSTRAINT "proximity_encounters_user_b_id_fkey"
    FOREIGN KEY ("user_b_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proximity_encounters" ADD CONSTRAINT "proximity_encounters_requester_id_fkey"
    FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
