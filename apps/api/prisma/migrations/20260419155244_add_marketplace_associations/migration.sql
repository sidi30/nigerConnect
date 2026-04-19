-- CreateEnum
CREATE TYPE "ServiceCategory" AS ENUM ('logement', 'transport', 'admin_category', 'sante', 'emploi', 'business', 'education', 'autre');

-- CreateEnum
CREATE TYPE "ServiceUrgency" AS ENUM ('urgent', 'normal');

-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('open', 'in_progress', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "AssociationCategory" AS ENUM ('generaliste', 'etudiants', 'femmes', 'jeunesse', 'culture', 'business', 'sport', 'religieux');

-- CreateEnum
CREATE TYPE "AssociationRole" AS ENUM ('admin', 'moderator', 'member');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('pending', 'approved');

-- CreateTable
CREATE TABLE "service_requests" (
    "id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "category" "ServiceCategory" NOT NULL,
    "urgency" "ServiceUrgency" NOT NULL DEFAULT 'normal',
    "budget" VARCHAR(50),
    "city" VARCHAR(100),
    "country_code" CHAR(2),
    "status" "ServiceStatus" NOT NULL DEFAULT 'open',
    "response_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_responses" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "responder_id" UUID NOT NULL,
    "message" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_ratings" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "rated_user_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "associations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "logo_url" VARCHAR(500),
    "cover_url" VARCHAR(500),
    "category" "AssociationCategory" NOT NULL,
    "country_code" CHAR(2),
    "city" VARCHAR(100),
    "website" VARCHAR(300),
    "contact_email" VARCHAR(255),
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "member_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "associations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "association_members" (
    "association_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "AssociationRole" NOT NULL DEFAULT 'member',
    "status" "MembershipStatus" NOT NULL DEFAULT 'approved',
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "association_members_pkey" PRIMARY KEY ("association_id","user_id")
);

-- CreateTable
CREATE TABLE "association_events" (
    "id" UUID NOT NULL,
    "association_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "event_date" TIMESTAMPTZ NOT NULL,
    "location" VARCHAR(200),
    "cover_url" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "association_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_requests_status_created_at_idx" ON "service_requests"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "service_requests_category_status_idx" ON "service_requests"("category", "status");

-- CreateIndex
CREATE INDEX "service_requests_country_code_status_idx" ON "service_requests"("country_code", "status");

-- CreateIndex
CREATE INDEX "service_responses_request_id_idx" ON "service_responses"("request_id");

-- CreateIndex
CREATE INDEX "service_ratings_rated_user_id_idx" ON "service_ratings"("rated_user_id");

-- CreateIndex
CREATE INDEX "associations_category_country_code_idx" ON "associations"("category", "country_code");

-- CreateIndex
CREATE INDEX "association_members_user_id_idx" ON "association_members"("user_id");

-- CreateIndex
CREATE INDEX "association_events_association_id_event_date_idx" ON "association_events"("association_id", "event_date");

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_responses" ADD CONSTRAINT "service_responses_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_responses" ADD CONSTRAINT "service_responses_responder_id_fkey" FOREIGN KEY ("responder_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_ratings" ADD CONSTRAINT "service_ratings_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "associations" ADD CONSTRAINT "associations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "association_members" ADD CONSTRAINT "association_members_association_id_fkey" FOREIGN KEY ("association_id") REFERENCES "associations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "association_members" ADD CONSTRAINT "association_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "association_events" ADD CONSTRAINT "association_events_association_id_fkey" FOREIGN KEY ("association_id") REFERENCES "associations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
