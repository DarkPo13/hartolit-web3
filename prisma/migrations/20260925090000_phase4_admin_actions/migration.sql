ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_RECORD_UPDATED';

CREATE TABLE "AdminAction" (
    "id" UUID NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "entity" VARCHAR(20) NOT NULL,
    "entityId" VARCHAR(191) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminAction_createdAt_id_idx" ON "AdminAction"("createdAt" DESC, "id" DESC);
CREATE INDEX "AdminAction_entity_entityId_createdAt_idx" ON "AdminAction"("entity", "entityId", "createdAt" DESC);
ALTER TABLE "AdminAction" ADD CONSTRAINT "AdminAction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
