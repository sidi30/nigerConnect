-- BUG 2 — safety-by-default (RGPD art.25): new accounts are NOT shown on the
-- public map until they explicitly opt in. Only the default changes; existing
-- rows keep their current value.
ALTER TABLE "users" ALTER COLUMN "show_on_map" SET DEFAULT false;

-- BUG 1 — ephemeral, PRIVATE proximity-matching position. Written by the
-- foreground proximity ping and read ONLY by the Haversine matcher (filtered by
-- proximity_updated_at freshness). Never exposed by the public map surfaces
-- (markers / nearby / clusters), so live GPS never leaks through the
-- city-coarse latitude/longitude pin.
ALTER TABLE "users"
  ADD COLUMN "proximity_lat" DECIMAL(10,7),
  ADD COLUMN "proximity_lon" DECIMAL(10,7),
  ADD COLUMN "proximity_updated_at" TIMESTAMPTZ;
