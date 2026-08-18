-- Animation éditoriale : comptes pilotés + file de publication.
--
-- L'atelier (poste du propriétaire) remplit la file, le cron du serveur la vide.
-- Les deux moitiés sont séparées pour que l'extinction du poste n'arrête pas la
-- distribution : production par lots d'un côté, publication 24/7 de l'autre.

-- 1. Marqueur interne sur le compte. Jamais exposé par l'API (absent de
--    USER_PUBLIC_SELECT et USER_SELF_SELECT). Sert uniquement à retirer ces
--    comptes de la carte et de la proximité, à accepter les demandes d'ami
--    automatiquement, et à router leurs messages reçus vers la console.
ALTER TABLE "users" ADD COLUMN "is_animated" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "users_is_animated_idx" ON "users"("is_animated");

-- 2. File de publication.
CREATE TYPE "AnimationKind" AS ENUM ('law', 'tip', 'chat');
CREATE TYPE "AnimationStatus" AS ENUM ('draft', 'approved', 'published', 'rejected');

CREATE TABLE "animation_posts" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "bot_id"             UUID NOT NULL,
  "country_code"       CHAR(2),
  "kind"               "AnimationKind" NOT NULL,
  "status"             "AnimationStatus" NOT NULL DEFAULT 'draft',
  "content"            TEXT NOT NULL,
  "media_url"          VARCHAR(500),
  "source_url"         VARCHAR(500),
  "scheduled_at"       TIMESTAMPTZ NOT NULL,
  "published_at"       TIMESTAMPTZ,
  "published_post_id"  UUID,
  "review_note"        VARCHAR(500),
  "reviewed_by_id"     UUID,
  "created_at"         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMPTZ NOT NULL,
  CONSTRAINT "animation_posts_bot_id_fkey"
    FOREIGN KEY ("bot_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "animation_posts_reviewed_by_id_fkey"
    FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Le cron ne lit que (status, scheduled_at) — il balaie cette file à intervalle
-- court, donc l'index composite doit exister dès la première exécution.
CREATE INDEX "animation_posts_status_scheduled_at_idx" ON "animation_posts"("status", "scheduled_at");
CREATE INDEX "animation_posts_bot_id_scheduled_at_idx" ON "animation_posts"("bot_id", "scheduled_at");

-- Un contenu juridique sans source n'est pas publiable : la règle est portée par
-- la base, pas seulement par le service. Un INSERT direct en console ne peut pas
-- la contourner.
ALTER TABLE "animation_posts" ADD CONSTRAINT "animation_posts_law_needs_source"
  CHECK ("kind" <> 'law' OR "source_url" IS NOT NULL);

-- 3. Réglages par compte, pilotables depuis la console sans déploiement.
CREATE TABLE "animation_bots" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"             UUID NOT NULL UNIQUE,
  "handle"              VARCHAR(8) NOT NULL UNIQUE,
  "kind"                "AnimationKind" NOT NULL,
  "active"              BOOLEAN NOT NULL DEFAULT true,
  "posts_per_week"      INTEGER NOT NULL DEFAULT 2,
  "comments_per_day"    INTEGER NOT NULL DEFAULT 3,
  "likes_per_day"       INTEGER NOT NULL DEFAULT 8,
  "friend_req_per_day"  INTEGER NOT NULL DEFAULT 2,
  "active_from_hour"    INTEGER NOT NULL DEFAULT 8,
  "active_to_hour"      INTEGER NOT NULL DEFAULT 22,
  "topics"              TEXT[] NOT NULL DEFAULT '{}',
  "notes"               VARCHAR(1000),
  "updated_at"          TIMESTAMPTZ NOT NULL,
  CONSTRAINT "animation_bots_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "animation_bots_active_idx" ON "animation_bots"("active");

-- Une cadence négative n'a pas de sens et une fenêtre horaire hors 0-23 non plus :
-- la console écrit ici, autant que la base refuse l'absurde.
ALTER TABLE "animation_bots" ADD CONSTRAINT "animation_bots_sane_cadence" CHECK (
  "posts_per_week" >= 0 AND "comments_per_day" >= 0 AND
  "likes_per_day" >= 0 AND "friend_req_per_day" >= 0 AND
  "active_from_hour" BETWEEN 0 AND 23 AND "active_to_hour" BETWEEN 0 AND 23
);

-- 4. Réponses différées aux messages reçus.
CREATE TYPE "AnimationReplyStatus" AS ENUM ('pending', 'sent', 'escalated', 'skipped');

CREATE TABLE "animation_replies" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "bot_id"               UUID NOT NULL,
  "conversation_id"      UUID NOT NULL,
  "incoming_message_id"  UUID NOT NULL UNIQUE,
  "status"               "AnimationReplyStatus" NOT NULL DEFAULT 'pending',
  "attempt"              INTEGER NOT NULL DEFAULT 0,
  "due_at"               TIMESTAMPTZ NOT NULL,
  "draft"                TEXT,
  "sent_message_id"      UUID,
  "escalation_reason"    VARCHAR(200),
  "created_at"           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMPTZ NOT NULL,
  CONSTRAINT "animation_replies_bot_id_fkey"
    FOREIGN KEY ("bot_id") REFERENCES "animation_bots"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- L'unicité sur incoming_message_id est la garantie anti-double-réponse : deux
-- balayages concurrents ne peuvent pas mettre deux fois le même message en file.
CREATE INDEX "animation_replies_status_due_at_idx" ON "animation_replies"("status", "due_at");
CREATE INDEX "animation_replies_conversation_id_idx" ON "animation_replies"("conversation_id");

-- 5. Gestes d'engagement programmés (likes, commentaires, demandes d'ami).
CREATE TYPE "AnimationActionType" AS ENUM ('like', 'comment', 'friend_request');
CREATE TYPE "AnimationActionStatus" AS ENUM ('pending', 'done', 'skipped');

CREATE TABLE "animation_actions" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "bot_id"          UUID NOT NULL,
  "type"            "AnimationActionType" NOT NULL,
  "status"          "AnimationActionStatus" NOT NULL DEFAULT 'pending',
  "target_post_id"  UUID,
  "target_user_id"  UUID,
  "draft"           TEXT,
  "due_at"          TIMESTAMPTZ NOT NULL,
  "done_at"         TIMESTAMPTZ,
  "skip_reason"     VARCHAR(200),
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "animation_actions_bot_id_fkey"
    FOREIGN KEY ("bot_id") REFERENCES "animation_bots"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Un compte ne like pas deux fois le même post et ne redemande pas en ami
-- quelqu'un qu'il a déjà sollicité. NULLS NOT DISTINCT n'est pas nécessaire :
-- Postgres ignore les NULL dans un index unique, donc les lignes « demande
-- d'ami » (target_post_id NULL) ne se gênent pas entre elles, et inversement.
CREATE UNIQUE INDEX "animation_actions_bot_type_post_key"
  ON "animation_actions"("bot_id", "type", "target_post_id");
CREATE UNIQUE INDEX "animation_actions_bot_type_user_key"
  ON "animation_actions"("bot_id", "type", "target_user_id");
CREATE INDEX "animation_actions_status_due_at_idx" ON "animation_actions"("status", "due_at");
