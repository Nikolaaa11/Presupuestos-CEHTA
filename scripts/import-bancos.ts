/**
 * Importa las planillas bancarias reales a la base (módulo Bancos).
 * Usa EXACTAMENTE el mismo parser que el endpoint de subida (single source).
 *
 * Uso:  DATABASE_URL=... npx tsx scripts/import-bancos.ts
 * Los archivos y su mapeo hoja→empresa se definen en IMPORTS.
 */
import "dotenv/config";
import * as XLSX from "xlsx";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { parseWorkbook, type CellValue } from "../src/lib/bank-import";

const IMPORTS: { file: string; assignments: { sheet: string; companyCode: string }[] }[] = [
  {
    file: "C:/Users/nicol/Downloads/CC Bancos VA 25.06.2026 (1).xlsx",
    assignments: [
      { sheet: "CC Santander", companyCode: "RHO" },
      { sheet: "CC BICE", companyCode: "RHO" },
    ],
  },
  {
    file: "C:/Users/nicol/Downloads/Transferencia detalle.xlsx",
    assignments: [
      { sheet: "AFIS", companyCode: "AFIS" },
      { sheet: "CEnergy", companyCode: "CENERGY" },
    ],
  },
];

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  for (const job of IMPORTS) {
    const fileName = job.file.split("/").pop()!;
    // Mismos límites que el endpoint (defensa en profundidad, aunque acá los
    // archivos los provee el operador).
    const workbook = XLSX.readFile(job.file, {
      sheetRows: 20_000,
      dense: true,
      cellFormula: false,
      cellHTML: false,
    });
    const aoa = workbook.SheetNames.map((name) => ({
      name,
      rows: XLSX.utils.sheet_to_json<CellValue[]>(workbook.Sheets[name], { header: 1, defval: null }),
    }));
    const wantedSheets = job.assignments.map((a) => a.sheet);
    const { parsed } = parseWorkbook(aoa, wantedSheets);

    for (const assignment of job.assignments) {
      const sheet = parsed.find((p) => p.name.trim().toLowerCase() === assignment.sheet.toLowerCase());
      if (!sheet) {
        console.error(`✗ Hoja "${assignment.sheet}" no reconocida en ${fileName}`);
        continue;
      }
      const company = await prisma.company.findUnique({ where: { code: assignment.companyCode } });
      if (!company) {
        console.error(`✗ Empresa ${assignment.companyCode} no existe`);
        continue;
      }

      // Idempotente: reemplaza la misma hoja del mismo archivo.
      await prisma.bankSheet.deleteMany({
        where: { companyId: company.id, name: sheet.name, sourceFile: fileName },
      });
      const dbSheet = await prisma.bankSheet.create({
        data: { companyId: company.id, name: sheet.name, sourceFile: fileName, uploadedById: null },
      });
      await prisma.bankMovement.createMany({
        data: sheet.movements.map((m) => ({
          sheetId: dbSheet.id,
          rowIndex: m.rowIndex,
          date: m.date ? new Date(`${m.date}T12:00:00Z`) : null,
          entryDate: m.entryDate ? new Date(`${m.entryDate}T12:00:00Z`) : null,
          reference: m.reference,
          description: m.description,
          credit: m.credit,
          debit: m.debit,
          balance: m.balance,
          categoryGeneral: m.categoryGeneral,
          categoryDetail: m.categoryDetail,
          categorySpecific: m.categorySpecific,
          businessCenter: m.businessCenter,
          capitalTag: m.capitalTag,
          rut: m.rut,
          bankName: m.bankName,
          accountNumber: m.accountNumber,
          accountType: m.accountType,
          docType: m.docType,
          docNumber: m.docNumber,
          email: m.email,
          link: m.link,
          released: m.released,
        })),
      });
      const pending = sheet.movements.filter((m) => !m.released).length;
      console.log(
        `✓ ${assignment.companyCode} ← "${sheet.name}" (${fileName}): ${sheet.movements.length} movimientos, ${pending} pendientes de liberar`,
      );
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
