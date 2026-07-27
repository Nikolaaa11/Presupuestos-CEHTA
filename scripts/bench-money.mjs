// Micro-benchmark de la matemática de dinero y de los patrones de la grilla.
// Uso: node scripts/bench-money.mjs [filas]
// Mide el costo REAL de lo que ocurre en cada render de la grilla.
import Decimal from "decimal.js";

const MONTH_KEYS = ["m01","m02","m03","m04","m05","m06","m07","m08","m09","m10","m11","m12"];
const ROWS = Number(process.argv[2] ?? 50);
const CATEGORIES = 5;

function dec(v) {
  return v instanceof Decimal ? v : new Decimal(typeof v === "object" ? v.toString() : v);
}
function lineTotal(line) {
  return MONTH_KEYS.reduce((acc, k) => acc.plus(line[k] == null ? 0 : dec(line[k])), new Decimal(0));
}
function monthlyTotals(lines) {
  const out = Object.fromEntries(MONTH_KEYS.map((k) => [k, new Decimal(0)]));
  for (const line of lines) for (const k of MONTH_KEYS) {
    const v = line[k];
    if (v != null) out[k] = out[k].plus(dec(v));
  }
  return out;
}

const lines = Array.from({ length: ROWS }, (_, i) => ({
  id: "line" + i,
  categoryId: "cat" + (i % CATEGORIES),
  ...Object.fromEntries(MONTH_KEYS.map((k) => [k, String(1_000_000 + i * 1000)])),
}));

function time(label, fn, iterations = 100) {
  fn(); // warmup
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  ${label.padEnd(52)} ${(ms / iterations).toFixed(3).padStart(9)} ms/render`);
  return ms / iterations;
}

console.log(`\n=== Costo por render de la grilla — ${ROWS} filas, ${CATEGORIES} categorías ===\n`);

// 1. Totales por mes del pie (1 pasada sobre todas las líneas)
const tFooter = time("monthlyTotals (fila de totales del pie)", () => monthlyTotals(lines));

// 2. Total anual por línea: se llama una vez POR FILA en el render
const tRowTotals = time("lineTotal × cada fila (columna Total)", () => {
  for (const l of lines) lineTotal(l);
});

// 3. PATRÓN ACTUAL de subtotales por categoría: filter + monthlyTotals por cada
//    fila-subtotal, y ADEMÁS lineTotal sobre ese resultado. Sin memoizar.
const tCategoryNow = time("subtotales por categoría (patrón actual, sin memo)", () => {
  for (let c = 0; c < CATEGORIES; c++) {
    const key = "cat" + c;
    const totals = monthlyTotals(lines.filter((l) => l.categoryId === key));
    lineTotal(totals);
  }
});

// 4. PATRÓN OPTIMIZADO: una sola pasada agrupando por categoría
const tCategoryOpt = time("subtotales por categoría (1 sola pasada, agrupado)", () => {
  const groups = new Map();
  for (const l of lines) {
    let acc = groups.get(l.categoryId);
    if (!acc) { acc = Object.fromEntries(MONTH_KEYS.map((k) => [k, new Decimal(0)])); groups.set(l.categoryId, acc); }
    for (const k of MONTH_KEYS) acc[k] = acc[k].plus(dec(l[k]));
  }
  for (const [, totals] of groups) lineTotal(totals);
});

// 5. findIndex dentro del map de render → O(n²)
const tFindIndex = time("findIndex por fila (O(n²) actual)", () => {
  for (const l of lines) lines.findIndex((item) => item.id === l.id);
});
const tMapLookup = time("Map.get por fila (O(n) optimizado)", () => {
  const idx = new Map(lines.map((l, i) => [l.id, i]));
  for (const l of lines) idx.get(l.id);
});

const totalNow = tFooter + tRowTotals + tCategoryNow + tFindIndex;
const totalOpt = tFooter + tRowTotals + tCategoryOpt + tMapLookup;

console.log(`\n  ${"TOTAL por render (actual)".padEnd(52)} ${totalNow.toFixed(3).padStart(9)} ms`);
console.log(`  ${"TOTAL por render (optimizado, sin memo)".padEnd(52)} ${totalOpt.toFixed(3).padStart(9)} ms`);
console.log(`  ${"Reducción".padEnd(52)} ${((1 - totalOpt / totalNow) * 100).toFixed(1).padStart(8)} %`);

// Asignaciones de objetos Decimal por render (presión de GC)
const decimalsPerRender = ROWS * 12 * 2 + 12 * ROWS * 2 + CATEGORIES * 12 * 2;
console.log(`\n  Objetos Decimal asignados por render (aprox): ${decimalsPerRender.toLocaleString("es-CL")}`);
console.log("");
