-- CreateTable
CREATE TABLE "ProductFeedback" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" VARCHAR(2000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductFeedback_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductFeedback_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
    CONSTRAINT "ProductFeedback_comment_check" CHECK (char_length(btrim("comment")) BETWEEN 10 AND 2000)
);

-- CreateIndex
CREATE INDEX "ProductFeedback_userId_createdAt_idx" ON "ProductFeedback"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductFeedback_createdAt_id_idx" ON "ProductFeedback"("createdAt" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "ProductFeedback" ADD CONSTRAINT "ProductFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
