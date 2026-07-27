/**
 * Seed demo — Presupuestos CEHTA
 * 9 entidades + 10 usuarios demo + catálogo de gastos + FX 2027
 * + presupuesto ejemplo CENERGY 2027 (ENVIADO) con iniciativa CAPEX vinculada
 * + presupuesto RHO 2027 a medio llenar (BORRADOR)
 *
 * Idempotente: upsert por claves únicas; los presupuestos demo se recrean.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import bcrypt from "bcryptjs";
import { approvalLevelFor } from "../src/lib/capex";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const YEAR = 2027;
const FX = { ufToClp: "39200.00", usdToClp: "950.00" };

const COMPANIES = [
  { code: "AFIS",     name: "AFIS S.A.",                     type: "ADMINISTRADORA", sector: "Administradora del fondo" },
  { code: "FIP",      name: "FIP CEHTA ESG",                 type: "FONDO",          sector: "Fondo de inversión privado" },
  { code: "CENERGY",  name: "CENERGY",                       type: "PORTFOLIO",      sector: "Consultoría energética y servicios técnicos" },
  { code: "CSL",      name: "CSL — Climate Smart Leasing",   type: "PORTFOLIO",      sector: "Leasing sostenible de activos productivos" },
  { code: "RHO",      name: "RHO",                           type: "PORTFOLIO",      sector: "Solar PMGD + BESS + agrivoltaica" },
  { code: "DTE",      name: "DTE Consulting & Development",  type: "PORTFOLIO",      sector: "Vivienda social sostenible y eficiencia energética" },
  { code: "EVOQUE",   name: "EVOQUE Energy",                 type: "PORTFOLIO",      sector: "ESCO — eficiencia energética industrial" },
  { code: "REVTECH",  name: "RevTech — Green Mining",        type: "PORTFOLIO",      sector: "Minería circular y óxidos de cobre" },
  { code: "TRONGKAI", name: "Trongkai — Agrosphere",         type: "PORTFOLIO",      sector: "Bioeconomía circular e ingredientes funcionales" },
] as const;

const EXPENSE_CATEGORIES = [
  "Personal y Remuneraciones",
  "Gastos Fijos",
  "Gastos Variables",
  "Administración y Ventas",
  "Otros",
];

/** Reparte un monto mensual constante en los 12 meses. */
function flat(monthly: string) {
  return Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [`m${String(i + 1).padStart(2, "0")}`, monthly]),
  );
}

/** Meses específicos: { 4: "4000000", 5: "5000000" } (resto queda en 0). */
function months(values: Record<number, string>) {
  return Object.fromEntries(
    Object.entries(values).map(([m, v]) => [`m${String(m).padStart(2, "0")}`, v]),
  );
}

async function main() {
  console.log("→ Empresas...");
  const companies: Record<string, { id: string }> = {};
  for (const c of COMPANIES) {
    companies[c.code] = await prisma.company.upsert({
      where: { code: c.code },
      update: { name: c.name, type: c.type, sector: c.sector },
      create: c,
    });
  }

  console.log("→ Usuarios demo...");
  const adminHash = bcrypt.hashSync("Cehta2026!", 10);
  const demoHash = bcrypt.hashSync("Demo2026!", 10);

  await prisma.user.upsert({
    where: { email: "admin@cehta.cl" },
    update: { role: "FUND_ADMIN", active: true },
    create: {
      email: "admin@cehta.cl",
      passwordHash: adminHash,
      name: "Administración Fondo (AFIS/FIP)",
      role: "FUND_ADMIN",
      companyId: null,
    },
  });

  const demoUsers: Record<string, { id: string }> = {};
  for (const c of COMPANIES) {
    const email = `demo.${c.code.toLowerCase()}@cehta.cl`;
    demoUsers[c.code] = await prisma.user.upsert({
      where: { email },
      update: { role: "COMPANY_MANAGER", companyId: companies[c.code].id, active: true },
      create: {
        email,
        passwordHash: demoHash,
        name: `Gerencia ${c.code}`,
        role: "COMPANY_MANAGER",
        companyId: companies[c.code].id,
      },
    });
  }

  console.log("→ Catálogo de categorías de gasto...");
  const categories: Record<string, { id: string }> = {};
  for (const [i, name] of EXPENSE_CATEGORIES.entries()) {
    categories[name] = await prisma.expenseCategory.upsert({
      where: { name },
      update: { sortOrder: i },
      create: { name, isSystem: true, sortOrder: i },
    });
  }

  console.log("→ Tipos de cambio 2027...");
  await prisma.fxRate.upsert({
    where: { year: YEAR },
    update: { ufToClp: FX.ufToClp, usdToClp: FX.usdToClp },
    create: { year: YEAR, ufToClp: FX.ufToClp, usdToClp: FX.usdToClp },
  });

  // ──────────────── Presupuesto ejemplo CENERGY 2027 (ENVIADO) ────────────────
  console.log("→ Presupuesto CENERGY 2027 (ejemplo completo, ENVIADO)...");
  await prisma.budget.deleteMany({ where: { companyId: companies.CENERGY.id, year: YEAR } });

  const cenergyBudget = await prisma.budget.create({
    data: {
      companyId: companies.CENERGY.id,
      year: YEAR,
      version: 1,
      status: "ENVIADO",
      currency: "CLP",
      submittedAt: new Date("2026-07-20T14:00:00Z"),
    },
  });

  // CAPEX primero (las ventas/gastos de la iniciativa se vinculan a él)
  const camioneta = await prisma.capexItem.create({
    data: {
      budgetId: cenergyBudget.id,
      description: "Camioneta 4x4 para trabajo en terreno",
      purpose: "Reemplazo de vehículo 2019 — visitas a faenas mineras",
      amount: "900",
      currency: "UF",
      monthNeeded: 3,
      financingMonths: 36,
      financingSource: "LEASING",
      isInitiative: false,
      approvalLevel: approvalLevelFor("900", "UF", FX), // → N2
      approvalStatus: "ENVIADO",
      sortOrder: 0,
    },
  });

  const laboratorio = await prisma.capexItem.create({
    data: {
      budgetId: cenergyBudget.id,
      description: "Laboratorio de medición y certificación eléctrica",
      purpose: "Nueva línea de negocio: ensayos NCh y certificación de equipos para clientes industriales",
      amount: "140000",
      currency: "USD",
      monthNeeded: 2,
      financingMonths: 18,
      financingSource: "BANCO",
      isInitiative: true,
      initiativeName: "Laboratorio CENERGY",
      approvalLevel: approvalLevelFor("140000", "USD", FX), // → N3
      approvalStatus: "ENVIADO",
      sortOrder: 1,
    },
  });

  await prisma.salesLine.createMany({
    data: [
      { budgetId: cenergyBudget.id, client: "Minera Los Andes — contrato O&M eléctrico", saleType: "CONTRATO", channel: "Contrato marco 3 años", sortOrder: 0, ...flat("18000000") },
      { budgetId: cenergyBudget.id, client: "Enel Distribución — auditorías de red", saleType: "CONTRATO", channel: "Licitación adjudicada", sortOrder: 1, ...flat("12000000") },
      { budgetId: cenergyBudget.id, client: "Cartera clientes recurrentes", saleType: "RECURRENTE", channel: "Servicios técnicos continuos", sortOrder: 2, ...flat("7500000") },
      { budgetId: cenergyBudget.id, client: "Proyectos spot industria", saleType: "PROYECCION_PUBLICO", channel: "Propuestas directas", sortOrder: 3, ...months({ 2: "5000000", 4: "6000000", 6: "9000000", 8: "6000000", 10: "8000000", 12: "5000000" }) },
      { budgetId: cenergyBudget.id, client: "Servicios de laboratorio — clientes nuevos", saleType: "PROYECCION_PUBLICO", channel: "Iniciativa laboratorio", capexItemId: laboratorio.id, sortOrder: 4, ...months({ 4: "4000000", 5: "5000000", 6: "6000000", 7: "7000000", 8: "8000000", 9: "8000000", 10: "8000000", 11: "8000000", 12: "8000000" }) },
      { budgetId: cenergyBudget.id, client: "Certificaciones NCh — laboratorio", saleType: "CONTRATO", channel: "Convenio gremio industrial", capexItemId: laboratorio.id, sortOrder: 5, ...months({ 6: "3000000", 7: "3000000", 8: "3000000", 9: "3000000", 10: "3000000", 11: "3000000", 12: "3000000" }) },
    ],
  });

  await prisma.expenseLine.createMany({
    data: [
      { budgetId: cenergyBudget.id, categoryId: categories["Personal y Remuneraciones"].id, item: "Sueldos equipo consultoría (12 personas)", sortOrder: 0, ...flat("22000000") },
      { budgetId: cenergyBudget.id, categoryId: categories["Personal y Remuneraciones"].id, item: "Sueldos administración", sortOrder: 1, ...flat("6500000") },
      { budgetId: cenergyBudget.id, categoryId: categories["Personal y Remuneraciones"].id, item: "Técnicos laboratorio (2 nuevos)", capexItemId: laboratorio.id, sortOrder: 2, ...months({ 3: "5500000", 4: "5500000", 5: "5500000", 6: "5500000", 7: "5500000", 8: "5500000", 9: "5500000", 10: "5500000", 11: "5500000", 12: "5500000" }) },
      { budgetId: cenergyBudget.id, categoryId: categories["Gastos Fijos"].id, item: "Arriendo oficina Providencia", sortOrder: 3, ...flat("3200000") },
      { budgetId: cenergyBudget.id, categoryId: categories["Gastos Fijos"].id, item: "Seguros y patentes", sortOrder: 4, ...flat("800000") },
      { budgetId: cenergyBudget.id, categoryId: categories["Gastos Variables"].id, item: "Viáticos y trabajo en terreno", sortOrder: 5, ...flat("2400000") },
      { budgetId: cenergyBudget.id, categoryId: categories["Gastos Variables"].id, item: "Instrumentación y consumibles", sortOrder: 6, ...flat("1500000") },
      { budgetId: cenergyBudget.id, categoryId: categories["Administración y Ventas"].id, item: "Marketing y propuestas comerciales", sortOrder: 7, ...flat("900000") },
    ],
  });

  await prisma.approvalEvent.create({
    data: {
      budgetId: cenergyBudget.id,
      actorUserId: demoUsers.CENERGY.id,
      action: "ENVIADO",
      comment: "Presupuesto 2027 enviado a revisión del fondo. Incluye iniciativa Laboratorio CENERGY (USD 140k, banco 18 meses).",
    },
  });

  // ──────────────── Presupuesto RHO 2027 (BORRADOR a medio llenar) ────────────────
  console.log("→ Presupuesto RHO 2027 (borrador)...");
  await prisma.budget.deleteMany({ where: { companyId: companies.RHO.id, year: YEAR } });

  const rhoBudget = await prisma.budget.create({
    data: { companyId: companies.RHO.id, year: YEAR, version: 1, status: "BORRADOR", currency: "CLP" },
  });

  await prisma.salesLine.createMany({
    data: [
      { budgetId: rhoBudget.id, client: "PPA distribuidora — PMGD El Sauce", saleType: "CONTRATO", channel: "PPA 10 años", sortOrder: 0, ...flat("45000000") },
      { budgetId: rhoBudget.id, client: "Venta spot CEN (excedentes)", saleType: "PROYECCION_PUBLICO", channel: "Mercado spot", sortOrder: 1, ...months({ 1: "8000000", 2: "7500000", 3: "6000000" }) },
    ],
  });

  await prisma.expenseLine.createMany({
    data: [
      { budgetId: rhoBudget.id, categoryId: categories["Personal y Remuneraciones"].id, item: "Equipo O&M planta", sortOrder: 0, ...flat("9500000") },
      { budgetId: rhoBudget.id, categoryId: categories["Gastos Fijos"].id, item: "Arriendo terreno + seguros planta", sortOrder: 1, ...flat("4200000") },
    ],
  });

  await prisma.capexItem.create({
    data: {
      budgetId: rhoBudget.id,
      description: "Repotenciación de inversores string",
      amount: "1800",
      currency: "UF",
      monthNeeded: 6,
      financingSource: "CAJA_PROPIA",
      approvalLevel: approvalLevelFor("1800", "UF", FX), // → N2
      approvalStatus: "BORRADOR",
      sortOrder: 0,
    },
  });

  console.log("✓ Seed completo:");
  console.log(`  ${COMPANIES.length} empresas · ${COMPANIES.length + 1} usuarios · ${EXPENSE_CATEGORIES.length} categorías`);
  console.log("  CENERGY 2027 ENVIADO (6 ventas, 8 gastos, 2 capex — camioneta UF900/N2, laboratorio USD140k/N3)");
  console.log("  RHO 2027 BORRADOR (2 ventas, 2 gastos, 1 capex)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
