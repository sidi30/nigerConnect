-- CreateIndex
CREATE INDEX "users_latitude_longitude_idx" ON "users"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "users_show_on_map_status_idx" ON "users"("show_on_map", "status");
