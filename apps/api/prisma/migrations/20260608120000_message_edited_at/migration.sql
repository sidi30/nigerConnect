-- WhatsApp-style edit: track when a message was last edited (within the 15-min window).
ALTER TABLE "messages" ADD COLUMN "edited_at" TIMESTAMPTZ;
