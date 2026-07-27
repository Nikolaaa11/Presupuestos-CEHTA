-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CompanyType" AS ENUM ('ADMINISTRADORA', 'FONDO', 'PORTFOLIO');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('FUND_ADMIN', 'COMPANY_MANAGER', 'FUND_ANALYST', 'VIEWER');

-- CreateEnum
CREATE TYPE "BudgetStatus" AS ENUM ('BORRADOR', 'ENVIADO', 'OBSERVADO', 'APROBADO', 'CERRADO');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('CLP', 'UF', 'USD');

-- CreateEnum
CREATE TYPE "SaleType" AS ENUM ('CONTRATO', 'PROYECCION_PUBLICO', 'RECURRENTE');

-- CreateEnum
CREATE TYPE "FinancingSource" AS ENUM ('CAJA_PROPIA', 'BANCO', 'FONDO', 'LEASING', 'MIXTO');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('BORRADOR', 'ENVIADO', 'APROBADO', 'OBSERVADO', 'RECHAZADO');

-- CreateEnum
CREATE TYPE "ApprovalAction" AS ENUM ('ENVIADO', 'OBSERVADO', 'APROBADO', 'RECHAZADO', 'REABIERTO', 'CERRADO');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CompanyType" NOT NULL,
    "sector" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "companyId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "BudgetStatus" NOT NULL DEFAULT 'BORRADOR',
    "currency" "Currency" NOT NULL DEFAULT 'CLP',
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesLine" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "client" TEXT NOT NULL,
    "saleType" "SaleType" NOT NULL DEFAULT 'PROYECCION_PUBLICO',
    "channel" TEXT,
    "capexItemId" TEXT,
    "m01" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m02" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m03" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m04" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m05" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m06" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m07" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m08" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m09" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m10" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m11" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m12" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseLine" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "capexItemId" TEXT,
    "m01" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m02" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m03" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m04" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m05" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m06" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m07" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m08" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m09" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m10" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m11" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m12" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapexItem" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "purpose" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'CLP',
    "monthNeeded" INTEGER NOT NULL,
    "financingMonths" INTEGER,
    "financingSource" "FinancingSource" NOT NULL DEFAULT 'CAJA_PROPIA',
    "isInitiative" BOOLEAN NOT NULL DEFAULT false,
    "initiativeName" TEXT,
    "approvalLevel" INTEGER,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'BORRADOR',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CapexItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalEvent" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "capexItemId" TEXT,
    "actorUserId" TEXT NOT NULL,
    "action" "ApprovalAction" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxRate" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "ufToClp" DECIMAL(12,2) NOT NULL,
    "usdToClp" DECIMAL(10,2) NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_code_key" ON "Company"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Budget_companyId_year_idx" ON "Budget"("companyId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_companyId_year_version_key" ON "Budget"("companyId", "year", "version");

-- CreateIndex
CREATE INDEX "SalesLine_budgetId_idx" ON "SalesLine"("budgetId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_name_key" ON "ExpenseCategory"("name");

-- CreateIndex
CREATE INDEX "ExpenseLine_budgetId_idx" ON "ExpenseLine"("budgetId");

-- CreateIndex
CREATE INDEX "CapexItem_budgetId_idx" ON "CapexItem"("budgetId");

-- CreateIndex
CREATE INDEX "ApprovalEvent_budgetId_createdAt_idx" ON "ApprovalEvent"("budgetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FxRate_year_key" ON "FxRate"("year");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesLine" ADD CONSTRAINT "SalesLine_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesLine" ADD CONSTRAINT "SalesLine_capexItemId_fkey" FOREIGN KEY ("capexItemId") REFERENCES "CapexItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseLine" ADD CONSTRAINT "ExpenseLine_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseLine" ADD CONSTRAINT "ExpenseLine_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseLine" ADD CONSTRAINT "ExpenseLine_capexItemId_fkey" FOREIGN KEY ("capexItemId") REFERENCES "CapexItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapexItem" ADD CONSTRAINT "CapexItem_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalEvent" ADD CONSTRAINT "ApprovalEvent_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalEvent" ADD CONSTRAINT "ApprovalEvent_capexItemId_fkey" FOREIGN KEY ("capexItemId") REFERENCES "CapexItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalEvent" ADD CONSTRAINT "ApprovalEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FxRate" ADD CONSTRAINT "FxRate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

