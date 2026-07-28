/**
 * Importa TODO el contenido de los dos Excel del fondo a los módulos de la app.
 *
 *   CC Bancos VA 25.06.2026.xlsx
 *     · CC Santander / CC BICE → Bancos (cartolas)            [import-bancos.ts]
 *     · FlujoII                → Ventas (ABONOS) y Gastos (EGRESOS) de RHO,
 *                                años 2025 y 2026, proyectado + real
 *     · OCRho / OCPani         → Bancos (órdenes de compra: pagada = liberada)
 *     · Prog1…Prog5            → CAPEX de RHO (programas de inversión)
 *   Transferencia detalle.xlsx
 *     · AFIS / CEnergy         → Bancos (transferencias)      [import-bancos.ts]
 *     · Hoja1                  → Gastos recurrentes de AFIS 2026
 *
 * Idempotente: cada bloque borra lo suyo antes de recrear.
 * Uso: DATABASE_URL=... npx tsx scripts/import-excel-completo.ts
 */
import "dotenv/config";
import * as XLSX from "xlsx";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { toMoney, movementFingerprint, type CellValue } from "../src/lib/bank-import";

const BANCOS = "C:/Users/nicol/Downloads/CC Bancos VA 25.06.2026 (1).xlsx";
const TRANSFER = "C:/Users/nicol/Downloads/Transferencia detalle.xlsx";
const READ_OPTS = { sheetRows: 20_000, dense: true, cellFormula: false, cellHTML: false } as const;

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const rowsOf = (file: string, sheet: string): CellValue[][] => {
  const wb = XLSX.readFile(file, READ_OPTS);
  if (!wb.Sheets[sheet]) throw new Error(`No existe la hoja "${sheet}" en ${file}`);
  return XLSX.utils.sheet_to_json<CellValue[]>(wb.Sheets[sheet], { header: 1, defval: null });
};

const text = (v: CellValue): string => (v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim());
const num = (v: CellValue): number => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v ?? "").replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const months = (prefix: "m" | "r", values: number[]) =>
  Object.fromEntries(values.map((v, i) => [`${prefix}${String(i + 1).padStart(2, "0")}`, toMoney(v)]));

async function companyId(code: string) {
  const c = await prisma.company.findUnique({ where: { code } });
  if (!c) throw new Error(`Empresa ${code} no existe`);
  return c.id;
}

async function categoryId(name: string, sortOrder: number) {
  const existing = await prisma.expenseCategory.findUnique({ where: { name } });
  if (existing) return existing.id;
  const created = await prisma.expenseCategory.create({ data: { name, isSystem: false, sortOrder } });
  return created.id;
}

/** Presupuesto limpio para (empresa, año): borra el anterior y crea v1. */
async function freshBudget(code: string, year: number, status: "APROBADO" | "BORRADOR") {
  const cid = await companyId(code);
  await prisma.budget.deleteMany({ where: { companyId: cid, year } });
  return prisma.budget.create({
    data: { companyId: cid, year, version: 1, status, currency: "CLP" },
  });
}

// ═════════════════ FlujoII → Ventas y Gastos de RHO ═════════════════

/**
 * FlujoII tiene DOS bloques anuales (2025 y 2026), cada uno con la estructura:
 *   fila año · fila meses · fila INDICADOR (PROYECTADO|REAL alternados)
 *   EGRESOS … Total Egresos · ABONOS … Total Abonos · SALDO ACUMULADO
 * Las columnas van de a pares desde la 1: [proy_ene, real_ene, proy_feb, …].
 * La jerarquía viene por prefijos: "→ " (nivel 2) y "· · " (nivel 3, proyecto).
 */
type FlujoLine = { label: string; level: number; proy: number[]; real: number[] };

function parseFlujoBlock(rows: CellValue[][], headerRow: number): { year: number; lines: FlujoLine[] } {
  const year = Number(text(rows[headerRow - 2]?.[0])) || 0;
  const lines: FlujoLine[] = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const raw = text(rows[i]?.[0]);
    if (!raw) continue;
    if (/^\d{4}$/.test(raw) || raw === "INDICADOR:") break; // empieza el bloque siguiente
    const proy: number[] = [];
    const real: number[] = [];
    for (let m = 0; m < 12; m++) {
      proy.push(num(rows[i]?.[1 + m * 2]));
      real.push(num(rows[i]?.[2 + m * 2]));
    }
    const level = raw.startsWith("·") || raw.includes("·   ·") ? 3 : raw.startsWith("→") ? 2 : 1;
    const label = raw.replace(/^[→·\s]+/, "").trim();
    if (label) lines.push({ label, level, proy, real });
  }
  return { year, lines };
}

async function importFlujoII() {
  const rows = rowsOf(BANCOS, "FlujoII");
  const headerRows = rows
    .map((r, i) => (text(r?.[0]) === "INDICADOR:" ? i : -1))
    .filter((i) => i >= 0);

  for (const headerRow of headerRows) {
    const { year, lines } = parseFlujoBlock(rows, headerRow);
    if (!year) continue;

    // Separar EGRESOS / ABONOS y descartar filas de total
    const egresos: FlujoLine[] = [];
    const abonos: FlujoLine[] = [];
    let section: "none" | "egresos" | "abonos" = "none";
    let parent = "";
    const parents: string[] = [];

    for (const line of lines) {
      const upper = line.label.toUpperCase();
      if (upper === "EGRESOS") { section = "egresos"; continue; }
      if (upper === "ABONOS") { section = "abonos"; continue; }
      if (/^TOTAL |^SALDO ACUMULADO/.test(upper)) continue;

      if (line.level === 1) parent = line.label;
      const withParent = { ...line, label: line.level === 1 ? line.label : `${parent} — ${line.label}` };
      parents.push(parent);
      (section === "abonos" ? abonos : egresos).push(withParent);
    }

    const budget = await freshBudget("RHO", year, "APROBADO");

    // ── Gastos: se importan las hojas del árbol (nivel más profundo) para no
    //    duplicar montos, y los nodos de nivel 1 sin hijos.
    const leafEgresos = egresos.filter((l, i) => {
      const next = egresos[i + 1];
      return !next || next.level <= l.level;
    });

    let sortOrder = 0;
    for (const line of leafEgresos) {
      const catName = line.label.split(" — ")[0];
      const cid = await categoryId(catName, 50 + sortOrder);
      await prisma.expenseLine.create({
        data: {
          budgetId: budget.id,
          categoryId: cid,
          item: line.label.includes(" — ") ? line.label.split(" — ").slice(1).join(" — ") : line.label,
          sortOrder: sortOrder++,
          ...months("m", line.proy),
          ...months("r", line.real),
        },
      });
    }

    // ── Ventas (ABONOS): capital, préstamos, ventas, fondos mutuos, reversa
    const leafAbonos = abonos.filter((l, i) => {
      const next = abonos[i + 1];
      return !next || next.level <= l.level;
    });
    sortOrder = 0;
    for (const line of leafAbonos) {
      await prisma.salesLine.create({
        data: {
          budgetId: budget.id,
          client: line.label,
          saleType: /capital|préstamo|prestamo/i.test(line.label) ? "CONTRATO" : "RECURRENTE",
          channel: "FlujoII",
          sortOrder: sortOrder++,
          ...months("m", line.proy),
          ...months("r", line.real),
        },
      });
    }

    console.log(`✓ RHO ${year}: ${leafEgresos.length} líneas de gasto, ${leafAbonos.length} de abonos (proyectado + real)`);
  }
}

// ═════════════════ Hoja1 → Gastos recurrentes AFIS 2026 ═════════════════

async function importHoja1() {
  const rows = rowsOf(TRANSFER, "Hoja1");
  // fila 1: meses desde la col 2 (Abril…Diciembre)
  const monthNames = (rows[1] ?? []).slice(2).map(text);
  const budget = await freshBudget("AFIS", 2026, "APROBADO");
  const cid = await categoryId("Gastos Fijos", 1);

  let sortOrder = 0;
  for (let i = 2; i < rows.length; i++) {
    const item = text(rows[i]?.[0]);
    if (!item) continue;
    const values = new Array(12).fill(0);
    monthNames.forEach((name, idx) => {
      const monthIndex = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"]
        .indexOf(name.toLowerCase());
      if (monthIndex >= 0) values[monthIndex] = num(rows[i]?.[2 + idx]);
    });
    if (values.every((v) => v === 0)) continue;
    const dia = num(rows[i]?.[1]);
    await prisma.expenseLine.create({
      data: {
        budgetId: budget.id,
        categoryId: cid,
        item: dia ? `${item} (día ${dia})` : item,
        sortOrder: sortOrder++,
        ...months("m", values),
        ...months("r", values), // la planilla registra lo efectivamente pagado
      },
    });
  }
  console.log(`✓ AFIS 2026: ${sortOrder} gastos recurrentes (Hoja1)`);
}

// ═════════════════ Prog1…Prog5 → CAPEX de RHO ═════════════════

async function importProgramas() {
  const cid = await companyId("RHO");
  // Los programas son inversión: van al presupuesto 2026 de RHO
  let budget = await prisma.budget.findFirst({ where: { companyId: cid, year: 2026 }, orderBy: { version: "desc" } });
  if (!budget) budget = await freshBudget("RHO", 2026, "APROBADO");
  await prisma.capexItem.deleteMany({ where: { budgetId: budget.id } });

  let sortOrder = 0;
  const add = async (description: string, amount: number, currency: "CLP" | "UF" | "USD", purpose: string, monthNeeded = 1) => {
    if (!amount || amount <= 0) return;
    await prisma.capexItem.create({
      data: {
        budgetId: budget!.id,
        description: description.slice(0, 200),
        purpose: purpose.slice(0, 500),
        amount: toMoney(amount),
        currency,
        monthNeeded,
        financingSource: "FONDO",
        isInitiative: false,
        approvalStatus: "APROBADO",
        sortOrder: sortOrder++,
      },
    });
  };

  // Prog1: cartera de proyectos (MW y UF) + boletas de garantía
  const p1 = rowsOf(BANCOS, "Prog1");
  for (let i = 2; i < p1.length; i++) {
    const proyecto = text(p1[i]?.[1]);
    const mw = num(p1[i]?.[4]);
    const uf = num(p1[i]?.[5]);
    if (proyecto && mw > 0 && uf > 0) {
      await add(`Proyecto ${proyecto} — ${mw} MW`, uf, "UF", `Cartera de proyectos: ${mw} MW a UF ${uf}`);
    }
    // Boletas y devoluciones (columna 4 = pesos)
    if (/^Boleta|^Devolución/i.test(proyecto)) {
      await add(proyecto, num(p1[i]?.[4]), "CLP", "Boleta de garantía / devolución (Prog1)");
    }
  }

  // Prog2: ítems por proyecto (columna 2 = pesos)
  const p2 = rowsOf(BANCOS, "Prog2");
  let proyectoActual = "";
  for (let i = 1; i < p2.length; i++) {
    const col0 = text(p2[i]?.[0]);
    const detalle = text(p2[i]?.[1]);
    const pesos = num(p2[i]?.[2]);
    if (col0) proyectoActual = col0;
    if (detalle && pesos > 0) {
      await add(`${proyectoActual || "Programa"} — ${detalle}`, pesos, "CLP", "Programa de inversión (Prog2)");
    }
  }

  // Prog3, Prog4, Prog5: presupuestos por período (columna 4 = pesos totales)
  for (const [sheet, periodo] of [["Prog3", "dic-2025 a mar-2026"], ["Prog4", "abr-2026 a jul-2026"], ["Prog5", "programa 6 meses"]] as const) {
    const rows = rowsOf(BANCOS, sheet);
    let bloque = "";
    for (let i = 2; i < rows.length; i++) {
      const col0 = text(rows[i]?.[0]);
      const detalle = text(rows[i]?.[1]);
      const total = num(rows[i]?.[4]);
      if (col0 && !detalle) bloque = col0;
      if (detalle && total > 0) {
        await add(`${bloque || sheet} — ${detalle}`, total, "CLP", `${sheet}: ${periodo}`);
      }
    }
  }

  console.log(`✓ RHO CAPEX: ${sortOrder} ítems de inversión (Prog1–Prog5)`);
}

// ═════════════════ OCRho / OCPani → Bancos (órdenes de compra) ═════════════════

async function importOrdenesCompra() {
  const cid = await companyId("RHO");
  const jobs = [
    { sheet: "OCRho", nombre: "Órdenes de compra RHO", cols: { oc: 0, proyecto: 1, proveedor: 2, desc: 3, porPagar: 4, santander: 5, bice: 6, pagado: 7, saldo: 8, estado: 9 } },
    { sheet: "OCPani", nombre: "Órdenes de compra Panimávida", cols: { oc: 0, proyecto: -1, proveedor: 1, desc: 2, porPagar: 3, santander: 4, bice: 5, pagado: 6, saldo: 7, estado: 8 } },
  ];

  for (const job of jobs) {
    const rows = rowsOf(BANCOS, job.sheet);
    const c = job.cols;
    const movimientos = [];
    for (let i = 4; i < rows.length; i++) {
      const oc = text(rows[i]?.[c.oc]);
      const proveedor = text(rows[i]?.[c.proveedor]);
      const desc = text(rows[i]?.[c.desc]);
      const porPagar = num(rows[i]?.[c.porPagar]);
      const pagado = num(rows[i]?.[c.pagado]);
      const saldo = num(rows[i]?.[c.saldo]);
      const estado = text(rows[i]?.[c.estado]);
      if (!oc) continue;
      if (!proveedor && !desc && porPagar === 0 && pagado === 0) continue; // OC vacía

      const proyecto = c.proyecto >= 0 ? text(rows[i]?.[c.proyecto]) : "Panimávida";
      movimientos.push({
        rowIndex: i,
        reference: oc,
        description: [proveedor, desc].filter(Boolean).join(" — ") || oc,
        debit: toMoney(porPagar),
        credit: toMoney(pagado),
        balance: toMoney(saldo),
        categoryGeneral: "Orden de compra",
        categoryDetail: estado || null,
        businessCenter: proyecto || null,
        // Una OC totalmente pagada se considera liberada.
        released: /pagad/i.test(estado) || (porPagar > 0 && saldo === 0),
      });
    }

    await prisma.bankSheet.deleteMany({ where: { companyId: cid, name: job.nombre } });
    const sheet = await prisma.bankSheet.create({
      data: { companyId: cid, name: job.nombre, sourceFile: "CC Bancos VA 25.06.2026 (1).xlsx", uploadedById: null },
    });
    await prisma.bankMovement.createMany({
      data: movimientos.map((m) => ({ ...m, sheetId: sheet.id, releasedAt: m.released ? new Date() : null })),
    });
    const pendientes = movimientos.filter((m) => !m.released).length;
    console.log(`✓ RHO ← "${job.nombre}": ${movimientos.length} OCs, ${pendientes} pendientes de pago`);
  }
}

async function main() {
  console.log("→ FlujoII (Ventas + Gastos de RHO, 2025 y 2026)...");
  await importFlujoII();
  console.log("→ Programas de inversión (CAPEX RHO)...");
  await importProgramas();
  console.log("→ Órdenes de compra...");
  await importOrdenesCompra();
  console.log("→ Gastos recurrentes AFIS (Hoja1)...");
  await importHoja1();
  console.log("\n✓ Importación completa.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

export { movementFingerprint }; // evita el warning de import sin uso en algunos linters
