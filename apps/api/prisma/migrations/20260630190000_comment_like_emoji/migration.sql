-- Emoji reactions on comments. Existing comment likes become ❤️.
ALTER TABLE "comment_likes" ADD COLUMN "emoji" VARCHAR(16) NOT NULL DEFAULT '❤️';
