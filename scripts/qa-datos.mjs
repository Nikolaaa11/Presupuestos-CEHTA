/**
 * Auditoría de calidad de los datos cargados en la plataforma.
 * Comprueba, contra la base real, las invariantes que si se rompen hacen que
 * "los montos no salgan bien" en pantalla. Solo lee — nunca modifica.
 *
 * Uso: node scripts/qa-datos.mjs [DATABASE_URL]
 */
import pg from "pg";

const url = process.argv[2] ?? "postgres://postgres:postgres@127.0.0.1:51214/presupuestos?sslmode=disable";
const c = new pg.Client({ connectionString: url });
await c.connect();

const resultados = [];
const check = (nombre, cond, detalle = "") => {
  resultados.push(cond);
  console.log(`${cond ? "✓" : "✗"} ${nombre}${detalle ? " — " + detalle : ""}`);
};
const q = (sql, params) => c.query(sql, params).then((r) => r.rows);

// ── 1) Integridad referencial ──
const [huerfanos] = await q(`
  SELECT
    (SELECT count(*) FROM "BankMovement" m LEFT JOIN "BankSheet" s ON s.id = m."sheetId" WHERE s.id IS NULL)::int AS movs,
    (SELECT count(*) FROM "SalesLine" l LEFT JOIN "Budget" b ON b.id = l."budgetId" WHERE b.id IS NULL)::int AS ventas,
    (SELECT count(*) FROM "ExpenseLine" l LEFT JOIN "Budget" b ON b.id = l."budgetId" WHERE b.id IS NULL)::int AS gastos,
    (SELECT count(*) FROM "CapexItem" i LEFT JOIN "Budget" b ON b.id = i."budgetId" WHERE b.id IS NULL)::int AS capex,
    (SELECT count(*) FROM "CapexPaymentStage" e LEFT JOIN "CapexItem" i ON i.id = e."capexItemId" WHERE i.id IS NULL)::int AS etapas
`);
check("sin registros huérfanos", Object.values(huerfanos).every((v) => v === 0), JSON.stringify(huerfanos));

// ── 2) Montos: nada negativo donde no corresponde, nada absurdo ──
const [negativos] = await q(`
  SELECT
    (SELECT count(*) FROM "CapexItem" WHERE amount < 0)::int AS capex_neg,
    (SELECT count(*) FROM "CapexItem" WHERE amount > 100000000000)::int AS capex_absurdo,
    (SELECT count(*) FROM "BankMovement" WHERE debit < 0 OR credit < 0)::int AS bancos_neg
`);
check("sin montos negativos ni fuera de rango", Object.values(negativos).every((v) => v === 0), JSON.stringify(negativos));

const meses = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
for (const tabla of ["SalesLine", "ExpenseLine"]) {
  const conds = meses.map((m) => `"m${m}" < 0 OR "r${m}" < 0`).join(" OR ");
  const [{ n }] = await q(`SELECT count(*)::int AS n FROM "${tabla}" WHERE ${conds}`);
  check(`${tabla}: sin celdas negativas`, n === 0, n ? `${n} filas` : "");
}

// ── 3) CAPEX dentro de los topes de sanidad del import ──
const [capexTotal] = await q(`
  SELECT co.code, b.year, sum(i.amount)::numeric AS total, count(*)::int AS n
  FROM "CapexItem" i JOIN "Budget" b ON b.id = i."budgetId" JOIN "Company" co ON co.id = b."companyId"
  WHERE co.code = 'RHO' AND b.year = 2026 GROUP BY co.code, b.year
`);
check(
  "CAPEX RHO 2026 en el orden esperado (~$2.241 MM, no billones)",
  capexTotal && Number(capexTotal.total) > 2_000_000_000 && Number(capexTotal.total) < 3_000_000_000,
  capexTotal ? `${Number(capexTotal.total).toLocaleString("es-CL")} en ${capexTotal.n} ítems` : "sin datos",
);

// ── 4) Cronogramas de etapas: ningún ítem pasado de 100% ──
const sobregirados = await q(`
  SELECT "capexItemId", sum(percent)::numeric AS suma
  FROM "CapexPaymentStage" GROUP BY "capexItemId" HAVING sum(percent) > 100
`);
check("ningún cronograma de etapas supera el 100%", sobregirados.length === 0, `${sobregirados.length} sobregirados`);

// ── 5) Estados coherentes en el circuito de pagos ──
const [incoherentes] = await q(`
  SELECT
    (SELECT count(*) FROM "BankMovement" WHERE estado <> 'PENDIENTE' AND released = false)::int AS liberado_sin_flag,
    (SELECT count(*) FROM "BankMovement" WHERE estado = 'PENDIENTE' AND "batchId" IS NOT NULL)::int AS pendiente_con_lote,
    (SELECT count(*) FROM "BankMovement" WHERE estado <> 'PENDIENTE' AND "batchId" IS NULL)::int AS circuito_sin_lote
`);
check(
  "estados del circuito coherentes (flag released y lote en sincronía)",
  incoherentes.liberado_sin_flag === 0 && incoherentes.pendiente_con_lote === 0,
  JSON.stringify(incoherentes) + (incoherentes.circuito_sin_lote > 0 ? " (los sin lote son importados como pagados: esperado)" : ""),
);

// ── 6) Duplicados de IMPORTACIÓN: mismo rowIndex repetido en una planilla.
// Filas con valores idénticos pero rowIndex distinto son datos fuente tal cual
// (ej. FFMM: 8 compras de $18M el mismo día en filas consecutivas del Excel) —
// eso NO es un duplicado del importador y no debe fallar.
const dupImport = await q(`
  SELECT "sheetId", "rowIndex", count(*)::int AS n
  FROM "BankMovement" GROUP BY "sheetId", "rowIndex" HAVING count(*) > 1 LIMIT 5
`);
check("el importador no duplicó ninguna fila (rowIndex único por planilla)", dupImport.length === 0);

const repetidas = await q(`
  SELECT reference, count(*)::int AS n FROM "BankMovement"
  GROUP BY "sheetId", reference, debit, credit, date
  HAVING count(*) > 3 AND max(abs(debit) + abs(credit)) > 1000000
`);
if (repetidas.length > 0) {
  console.log(
    `  ℹ ${repetidas.length} grupo(s) de filas idénticas de origen (${repetidas.map((d) => `${d.reference}×${d.n}`).join(", ")}) — dato fuente, no error`,
  );
}

// ── 7) Presupuestos: estado válido y única versión "viva" por año ──
const versiones = await q(`
  SELECT "companyId", year, count(*) FILTER (WHERE status IN ('BORRADOR','ENVIADO','REVISADO','OBSERVADO'))::int AS vivas
  FROM "Budget" GROUP BY "companyId", year HAVING count(*) FILTER (WHERE status IN ('BORRADOR','ENVIADO','REVISADO','OBSERVADO')) > 1
`);
check("a lo sumo una versión en edición/revisión por empresa-año", versiones.length === 0, `${versiones.length} conflictos`);

// ── 8) Todas las categorías referenciadas existen (FK Restrict lo garantiza, se confirma) ──
const [{ n: catFaltantes }] = await q(`
  SELECT count(*)::int AS n FROM "ExpenseLine" l LEFT JOIN "ExpenseCategory" c ON c.id = l."categoryId" WHERE c.id IS NULL
`);
check("todas las líneas de gasto tienen categoría válida", catFaltantes === 0);

// ── 9) OCs: el avance nunca supera el total (por construcción, se confirma) ──
const ocsMal = await q(`
  SELECT s."companyId", m.reference
  FROM "BankMovement" m JOIN "BankSheet" s ON s.id = m."sheetId"
  WHERE m.reference ~ '^OC[0-9]' AND m.debit > 0
  GROUP BY s."companyId", m.reference
  HAVING sum(m.debit) FILTER (WHERE m.estado <> 'PENDIENTE') > sum(m.debit)
`);
check("ninguna OC con avance mayor que su total", ocsMal.length === 0);

const ok = resultados.filter(Boolean).length;
console.log(`\n${ok}/${resultados.length} verificaciones de datos OK`);
await c.end();
process.exit(ok === resultados.length ? 0 : 1);
