// Cuenta queries y mide latencia por operación lógica, contra la base real.
// Uso: node scripts/count-queries.mjs
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: [{ emit: "event", level: "query" }] });

let count = 0;
prisma.$on("query", () => count++);

async function measure(label, fn) {
  count = 0;
  const t0 = process.hrtime.bigint();
  await fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  ${label.padEnd(46)} ${String(count).padStart(3)} queries  ${ms.toFixed(1).padStart(7)} ms`);
  return { count, ms };
}

const YEAR = 2027;
const company = await prisma.company.findUnique({ where: { code: "CENERGY" } });
const budget = await prisma.budget.findFirst({
  where: { companyId: company.id, year: YEAR },
  orderBy: { version: "desc" },
});
const line = await prisma.salesLine.findFirst({ where: { budgetId: budget.id } });

console.log("\n=== Queries y latencia por operación ===\n");

// Lo que hace getCurrentBudget() en cada carga de /ventas y /gastos
const pageLoad = await measure("Carga de /ventas (getCurrentBudget)", () =>
  prisma.budget.findFirst({
    where: { companyId: company.id, year: YEAR },
    orderBy: { version: "desc" },
    include: {
      salesLines: { orderBy: { sortOrder: "asc" } },
      expenseLines: { orderBy: { sortOrder: "asc" } },
      capexItems: { orderBy: { sortOrder: "asc" } },
    },
  }),
);

// Lo que hace updateSalesLineMonths(): lookup + guard + update
const cellWrite = await measure("Editar UNA celda (escritura pura)", async () => {
  const l = await prisma.salesLine.findUnique({ where: { id: line.id }, select: { budgetId: true } });
  await prisma.budget.findUnique({ where: { id: l.budgetId }, select: { id: true, companyId: true, status: true, year: true } });
  await prisma.salesLine.update({ where: { id: line.id }, data: { m01: line.m01.toString() } });
});

console.log(`  ${"— sin revalidatePath: NO se recarga     ".padEnd(46)} ${String(pageLoad.count).padStart(3)} queries  ${pageLoad.ms.toFixed(1).padStart(7)} ms`);
console.log(`  ${"TOTAL REAL por celda editada (optimizado)".padEnd(46)} ${String(cellWrite.count).padStart(3)} queries  ${cellWrite.ms.toFixed(1).padStart(7)} ms`);

// Consolidado del fondo
const cons = await measure("Consolidado del fondo (9 empresas)", () =>
  prisma.company.findMany({
    orderBy: [{ type: "asc" }, { code: "asc" }],
    include: {
      budgets: {
        where: { year: YEAR }, orderBy: { version: "desc" }, take: 1,
        include: { salesLines: true, expenseLines: true, capexItems: { orderBy: [{ monthNeeded: "asc" }, { sortOrder: "asc" }] } },
      },
    },
  }),
);

// El export hace ESO y ADEMÁS vuelve a traer todo
const exportExtra = await measure("Export Excel: catálogo de categorías", () =>
  prisma.expenseCategory.findMany({ select: { id: true, name: true } }),
);
console.log(`  ${"TOTAL export Excel (optimizado)".padEnd(46)} ${String(cons.count + exportExtra.count).padStart(3)} queries  ${(cons.ms + exportExtra.ms).toFixed(1).padStart(7)} ms`);

// Escenario de carga real: un gerente llenando 12 meses × 20 clientes
const CELLS = 240;
console.log(`\n=== Proyección: gerente cargando ${CELLS} celdas ===`);
console.log(`  Optimizado: ${((cellWrite.count) * CELLS).toLocaleString("es-CL")} queries · ${(((cellWrite.ms) * CELLS) / 1000).toFixed(1)} s de trabajo servidor`);
console.log(`  Sin recarga: ${(cellWrite.count * CELLS).toLocaleString("es-CL")} queries · ${((cellWrite.ms * CELLS) / 1000).toFixed(1)} s`);
console.log("");

await prisma.$disconnect();
