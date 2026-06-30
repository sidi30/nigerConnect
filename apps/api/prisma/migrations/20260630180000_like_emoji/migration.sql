-- Emoji reactions (Instagram/Facebook-style). Existing likes become ❤️ reactions.
ALTER TABLE "likes" ADD COLUMN "emoji" VARCHAR(16) NOT NULL DEFAULT '❤️';
