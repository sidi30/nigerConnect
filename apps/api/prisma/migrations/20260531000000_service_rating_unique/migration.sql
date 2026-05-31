-- Drop duplicate ratings, keeping the earliest per (request_id, rated_user_id),
-- so the new unique constraint can be applied safely.
DELETE FROM "service_ratings" a
USING "service_ratings" b
WHERE a."request_id" = b."request_id"
  AND a."rated_user_id" = b."rated_user_id"
  AND (a."created_at", a."id") > (b."created_at", b."id");

-- CreateIndex
CREATE UNIQUE INDEX "service_ratings_request_id_rated_user_id_key" ON "service_ratings"("request_id", "rated_user_id");
