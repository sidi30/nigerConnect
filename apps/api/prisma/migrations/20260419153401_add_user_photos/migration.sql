-- CreateTable
CREATE TABLE "user_photos" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "thumbnail_url" VARCHAR(500),
    "caption" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_photos_user_id_sort_order_idx" ON "user_photos"("user_id", "sort_order");

-- CreateIndex
CREATE INDEX "users_country_code_city_idx" ON "users"("country_code", "city");

-- AddForeignKey
ALTER TABLE "user_photos" ADD CONSTRAINT "user_photos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
