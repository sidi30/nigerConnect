-- CreateEnum
CREATE TYPE "PageKind" AS ENUM ('community', 'cause', 'business', 'official', 'group');

-- CreateEnum
CREATE TYPE "PageRole" AS ENUM ('admin', 'editor');

-- CreateEnum
CREATE TYPE "ReviewTargetType" AS ENUM ('user', 'page');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'page_follow';
ALTER TYPE "NotificationType" ADD VALUE 'poll_new';
ALTER TYPE "NotificationType" ADD VALUE 'review_received';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "expires_at" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "rating_avg" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "rating_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "pages" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "kind" "PageKind" NOT NULL DEFAULT 'community',
    "avatar_url" VARCHAR(500),
    "cover_url" VARCHAR(500),
    "country_code" CHAR(2),
    "city" VARCHAR(100),
    "website" VARCHAR(300),
    "contact_email" VARCHAR(255),
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "follower_count" INTEGER NOT NULL DEFAULT 0,
    "rating_avg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_followers" (
    "page_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_followers_pkey" PRIMARY KEY ("page_id","user_id")
);

-- CreateTable
CREATE TABLE "page_admins" (
    "page_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "PageRole" NOT NULL DEFAULT 'editor',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_admins_pkey" PRIMARY KEY ("page_id","user_id")
);

-- CreateTable
CREATE TABLE "polls" (
    "id" UUID NOT NULL,
    "page_id" UUID,
    "author_id" UUID NOT NULL,
    "question" VARCHAR(300) NOT NULL,
    "multi_choice" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMPTZ,
    "vote_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "polls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poll_options" (
    "id" UUID NOT NULL,
    "poll_id" UUID NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "vote_count" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "poll_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poll_votes" (
    "poll_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poll_votes_pkey" PRIMARY KEY ("poll_id","user_id","option_id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "target_type" "ReviewTargetType" NOT NULL,
    "target_user_id" UUID,
    "target_page_id" UUID,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pages_kind_country_code_idx" ON "pages"("kind", "country_code");

-- CreateIndex
CREATE INDEX "pages_created_by_idx" ON "pages"("created_by");

-- CreateIndex
CREATE INDEX "page_followers_user_id_idx" ON "page_followers"("user_id");

-- CreateIndex
CREATE INDEX "page_admins_user_id_idx" ON "page_admins"("user_id");

-- CreateIndex
CREATE INDEX "polls_page_id_created_at_idx" ON "polls"("page_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "polls_author_id_idx" ON "polls"("author_id");

-- CreateIndex
CREATE INDEX "poll_options_poll_id_idx" ON "poll_options"("poll_id");

-- CreateIndex
CREATE INDEX "poll_votes_option_id_idx" ON "poll_votes"("option_id");

-- CreateIndex
CREATE INDEX "poll_votes_user_id_idx" ON "poll_votes"("user_id");

-- CreateIndex
CREATE INDEX "reviews_target_user_id_created_at_idx" ON "reviews"("target_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reviews_target_page_id_created_at_idx" ON "reviews"("target_page_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "reviews_author_id_target_user_id_key" ON "reviews"("author_id", "target_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_author_id_target_page_id_key" ON "reviews"("author_id", "target_page_id");

-- CreateIndex
CREATE INDEX "notifications_expires_at_idx" ON "notifications"("expires_at");

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_followers" ADD CONSTRAINT "page_followers_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_followers" ADD CONSTRAINT "page_followers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_admins" ADD CONSTRAINT "page_admins_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_admins" ADD CONSTRAINT "page_admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polls" ADD CONSTRAINT "polls_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polls" ADD CONSTRAINT "polls_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_options" ADD CONSTRAINT "poll_options_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "poll_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_target_page_id_fkey" FOREIGN KEY ("target_page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
