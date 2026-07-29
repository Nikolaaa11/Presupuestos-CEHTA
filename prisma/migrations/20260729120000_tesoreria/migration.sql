-- Circuito de pagos: lotes de transferencia, estados y bitácora
-- Guido (dueño) libera → Vicky (administradora) sube el comprobante →
-- Guido confirma transferida. Todo queda en BankEvent (append-only).

-- Roles nuevos
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'DUENO';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ADMINISTRADORA';

-- RUT de la empresa (lo pide la nómina bancaria)
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "rut" TEXT;

-- Estados
DO $$ BEGIN
  CREATE TYPE "MovementStatus" AS ENUM ('PENDIENTE', 'LIBERADO', 'EN_TRANSFERENCIA', 'TRANSFERIDO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "BatchStatus" AS ENUM ('LIBERADO', 'COMPROBANTE_SUBIDO', 'TRANSFERIDO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "BankAction" AS ENUM ('LIBERADO', 'LIBERACION_DESHECHA', 'COMPROBANTE_SUBIDO', 'TRANSFERIDO', 'TRANSFERENCIA_REVERTIDA', 'MOVIMIENTO_EDITADO', 'PLANILLA_IMPORTADA', 'PLANILLA_ELIMINADA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Lotes
CREATE TABLE IF NOT EXISTS "TransferBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'LIBERADO',
    "note" TEXT,
    "releasedById" TEXT,
    "releasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proofFileName" TEXT,
    "proofUploadedAt" TIMESTAMP(3),
    "proofUploadedById" TEXT,
    "transferredAt" TIMESTAMP(3),
    "transferredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TransferBatch_pkey" PRIMARY KEY ("id")
);

-- Bitácora (append-only)
CREATE TABLE IF NOT EXISTS "BankEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "movementId" TEXT,
    "batchId" TEXT,
    "actorUserId" TEXT,
    "action" "BankAction" NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankEvent_pkey" PRIMARY KEY ("id")
);

-- Estado y lote en el movimiento
ALTER TABLE "BankMovement" ADD COLUMN IF NOT EXISTS "estado" "MovementStatus" NOT NULL DEFAULT 'PENDIENTE';
ALTER TABLE "BankMovement" ADD COLUMN IF NOT EXISTS "batchId" TEXT;
ALTER TABLE "BankMovement" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Coherencia con lo ya cargado: lo que estaba liberado queda en LIBERADO
UPDATE "BankMovement" SET "estado" = 'LIBERADO' WHERE "released" = true AND "estado" = 'PENDIENTE';

CREATE UNIQUE INDEX IF NOT EXISTS "TransferBatch_companyId_number_key" ON "TransferBatch"("companyId", "number");
CREATE INDEX IF NOT EXISTS "TransferBatch_companyId_status_idx" ON "TransferBatch"("companyId", "status");
CREATE INDEX IF NOT EXISTS "BankEvent_companyId_createdAt_idx" ON "BankEvent"("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "BankEvent_movementId_idx" ON "BankEvent"("movementId");
CREATE INDEX IF NOT EXISTS "BankEvent_batchId_idx" ON "BankEvent"("batchId");
CREATE INDEX IF NOT EXISTS "BankMovement_batchId_idx" ON "BankMovement"("batchId");
CREATE INDEX IF NOT EXISTS "BankMovement_sheetId_estado_idx" ON "BankMovement"("sheetId", "estado");

DO $$ BEGIN
  ALTER TABLE "TransferBatch" ADD CONSTRAINT "TransferBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE "TransferBatch" ADD CONSTRAINT "TransferBatch_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE "TransferBatch" ADD CONSTRAINT "TransferBatch_proofUploadedById_fkey" FOREIGN KEY ("proofUploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE "TransferBatch" ADD CONSTRAINT "TransferBatch_transferredById_fkey" FOREIGN KEY ("transferredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE "BankMovement" ADD CONSTRAINT "BankMovement_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "TransferBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE "BankEvent" ADD CONSTRAINT "BankEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE "BankEvent" ADD CONSTRAINT "BankEvent_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "BankMovement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE "BankEvent" ADD CONSTRAINT "BankEvent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "TransferBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE "BankEvent" ADD CONSTRAINT "BankEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
