-- Like a comment (Instagram-style). Join table; likeCount on comments already
-- exists and stays the denormalised counter.
CREATE TABLE "comment_likes" (
    "user_id" UUID NOT NULL,
    "comment_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "comment_likes_pkey" PRIMARY KEY ("user_id","comment_id")
);

CREATE INDEX "comment_likes_comment_id_idx" ON "comment_likes"("comment_id");

ALTER TABLE "comment_likes" ADD CONSTRAINT "comment_likes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "comment_likes" ADD CONSTRAINT "comment_likes_comment_id_fkey"
    FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
