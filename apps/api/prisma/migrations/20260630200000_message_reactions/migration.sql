-- Emoji reactions on chat messages (Messenger-style, one per user per message).
CREATE TABLE "message_reactions" (
    "user_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "emoji" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("user_id","message_id")
);

CREATE INDEX "message_reactions_message_id_idx" ON "message_reactions"("message_id");

ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
