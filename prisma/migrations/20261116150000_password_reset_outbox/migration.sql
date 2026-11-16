-- Password reset and invitation emails waiting for delivery (D81). Additive table only.
-- CreateTable
CREATE TABLE "PasswordResetOutbox" (
    "id" UUID NOT NULL,
    "userId" TEXT,
    "linkSealed" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetOutbox_pkey" PRIMARY KEY ("id"),
    -- A sealed link is always present (random bytes for a decoy row), attempts are bounded,
    -- and a row never outlives the one-hour reset link by more than a day.
    CONSTRAINT "PasswordResetOutbox_shape_check" CHECK (
        length("linkSealed") > 0
        AND "attempts" BETWEEN 0 AND 10
        AND "expiresAt" > "createdAt"
        AND "expiresAt" <= "createdAt" + interval '1 day'
    )
);

-- CreateIndex
CREATE INDEX "PasswordResetOutbox_nextAttemptAt_idx" ON "PasswordResetOutbox"("nextAttemptAt");

-- AddForeignKey
ALTER TABLE "PasswordResetOutbox" ADD CONSTRAINT "PasswordResetOutbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
