-- Módulo Bancos: planillas bancarias y movimientos con estado de liberación

CREATE TABLE "BankSheet" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankSheet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BankMovement" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "date" TIMESTAMP(3),
    "entryDate" TIMESTAMP(3),
    "reference" TEXT,
    "description" TEXT,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(18,2),
    "categoryGeneral" TEXT,
    "categoryDetail" TEXT,
    "categorySpecific" TEXT,
    "businessCenter" TEXT,
    "capitalTag" TEXT,
    "rut" TEXT,
    "bankName" TEXT,
    "accountNumber" TEXT,
    "accountType" TEXT,
    "docType" TEXT,
    "docNumber" TEXT,
    "email" TEXT,
    "link" TEXT,
    "released" BOOLEAN NOT NULL DEFAULT false,
    "releasedAt" TIMESTAMP(3),
    "releasedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BankSheet_companyId_idx" ON "BankSheet"("companyId");
CREATE INDEX "BankMovement_sheetId_idx" ON "BankMovement"("sheetId");
CREATE INDEX "BankMovement_sheetId_released_idx" ON "BankMovement"("sheetId", "released");

ALTER TABLE "BankSheet" ADD CONSTRAINT "BankSheet_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BankSheet" ADD CONSTRAINT "BankSheet_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BankMovement" ADD CONSTRAINT "BankMovement_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "BankSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BankMovement" ADD CONSTRAINT "BankMovement_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
