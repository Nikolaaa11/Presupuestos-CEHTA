-- Cronograma de pago por etapas (%) para CAPEX, y marcado manual de "pagado"
-- en Gastos. Ninguna de las dos cambia el circuito de aprobación existente:
-- son datos informativos que alimentan el panel de avisos.

-- Etapas de desembolso de una inversión (30% al pedido, 70% contra entrega...).
CREATE TABLE IF NOT EXISTS "CapexPaymentStage" (
    "id" TEXT NOT NULL,
    "capexItemId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,
    "dueMonth" INTEGER NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CapexPaymentStage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CapexPaymentStage_capexItemId_idx" ON "CapexPaymentStage"("capexItemId");

DO $$ BEGIN
  ALTER TABLE "CapexPaymentStage" ADD CONSTRAINT "CapexPaymentStage_capexItemId_fkey"
    FOREIGN KEY ("capexItemId") REFERENCES "CapexItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CapexPaymentStage" ADD CONSTRAINT "CapexPaymentStage_paidById_fkey"
    FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Marcado manual de "pagado" en cada línea de gasto.
ALTER TABLE "ExpenseLine" ADD COLUMN IF NOT EXISTS "paid" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ExpenseLine" ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3);
ALTER TABLE "ExpenseLine" ADD COLUMN IF NOT EXISTS "paidById" TEXT;

DO $$ BEGIN
  ALTER TABLE "ExpenseLine" ADD CONSTRAINT "ExpenseLine_paidById_fkey"
    FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
