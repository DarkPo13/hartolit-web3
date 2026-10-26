-- CreateTable
CREATE TABLE "TwoFactorReplayGuard" (
    "userId" TEXT NOT NULL,
    "lastStep" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TwoFactorReplayGuard_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "TwoFactorReplayGuard" ADD CONSTRAINT "TwoFactorReplayGuard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
