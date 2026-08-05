/**
 * Prueba E2E de la carga masiva del presupuesto (Fase 2) contra el server real:
 * descarga la plantilla, la llena, la sube por /api/presupuesto/upload con la
 * sesión del encargado y verifica en la base el upsert, los guards y que lo
 * que el Excel no trae (ejecución real, pagado) quede intacto.
 *
 * Uso: node scripts/test-import-presupuesto.mjs [URL_BASE] [DATABASE_URL]
 */
import * as XLSX from "xlsx";
import pg from "pg";

const base = process.argv[2] ?? "http://localhost:3000";
const dbUrl = process.argv[3] ?? "postgres://postgres:postgres@127.0.0.1:51214/presupuestos?sslmode=disable";

const db = new pg.Client({ connectionString: dbUrl });
await db.connect();

const resultados = [];
const check = (nombre, cond, detalle = "") => {
  resultados.push(cond);
  console.log(`${cond ? "✓" : "✗"} ${nombre}${detalle ? " — " + detalle : ""}`);
};

// ── Sesión del encargado de RHO ──
const cookies = {};
const guardar = (r) => {
  for (const ck of r.headers.getSetCookie?.() ?? []) {
    const [p] = ck.split(";");
    const i = p.indexOf("=");
    cookies[p.slice(0, i).trim()] = p.slice(i + 1);
  }
};
const header = () => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
let r = await fetch(`${base}/api/auth/csrf`);
guardar(r);
const { csrfToken } = await r.json();
r = await fetch(`${base}/api/auth/callback/credentials`, {
  method: "POST",
  redirect: "manual",
  headers: { cookie: header(), "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ csrfToken, email: "demo.rho@cehta.cl", password: "Demo2026!", callbackUrl: base }),
});
guardar(r);

async function subir(modulo, aoa, year = 2026) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Datos");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const form = new FormData();
  form.set("file", new File([buffer], `test-${modulo}.xlsx`));
  form.set("modulo", modulo);
  form.set("año", String(year));
  const res = await fetch(`${base}/api/presupuesto/upload`, {
    method: "POST",
    headers: { cookie: header() },
    body: form,
  });
  return { status: res.status, data: await res.json() };
}

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

// ── 0) Plantillas descargables ──
for (const m of ["ventas", "gastos", "capex"]) {
  const res = await fetch(`${base}/api/presupuesto/plantilla?modulo=${m}`, { headers: { cookie: header() } });
  const buf = Buffer.from(await res.arrayBuffer());
  const ok = res.status === 200 && buf.length > 500 && buf.subarray(0, 2).toString() === "PK";
  check(`plantilla de ${m} descarga como xlsx`, ok, `${buf.length} bytes`);
}

// ── 1) VENTAS: crear nueva + actualizar existente sin tocar lo real ──
const [{ id: budgetId }] = (await db.query(`
  SELECT b.id FROM "Budget" b JOIN "Company" c ON c.id=b."companyId"
  WHERE c.code='RHO' AND b.year=2026 ORDER BY b.version DESC LIMIT 1`)).rows;
const [lineaExistente] = (await db.query(`
  SELECT id, client, r03::text AS r03 FROM "SalesLine" WHERE "budgetId"=$1 ORDER BY "sortOrder" LIMIT 1`, [budgetId])).rows;

const v = await subir("ventas", [
  ["Cliente", "Tipo", "Canal", ...MESES],
  [lineaExistente.client, "Contrato", "actualizado por import", "9.111.222", ...Array(11).fill(0)],
  ["Cliente Nuevo Import E2E", "Recurrente", "", ...Array(11).fill(0), "1.234.567,89"],
]);
check("ventas: importación acepta", v.status === 200, JSON.stringify(v.data).slice(0, 120));
check("ventas: 1 creada y 1 actualizada", v.data.creadas === 1 && v.data.actualizadas === 1);

const [vNueva] = (await db.query(`
  SELECT "saleType", m12::text AS m12 FROM "SalesLine" WHERE "budgetId"=$1 AND client='Cliente Nuevo Import E2E'`, [budgetId])).rows;
check("ventas: la nueva quedó con tipo y monto exactos", vNueva?.saleType === "RECURRENTE" && vNueva?.m12 === "1234567.89", vNueva?.m12);

const [vActual] = (await db.query(`
  SELECT m01::text AS m01, r03::text AS r03, channel FROM "SalesLine" WHERE id=$1`, [lineaExistente.id])).rows;
check("ventas: la existente actualizó m01 y canal", vActual.m01 === "9111222.00" && vActual.channel === "actualizado por import");
check("ventas: la ejecución real (r03) quedó INTACTA", vActual.r03 === lineaExistente.r03, `antes=${lineaExistente.r03} después=${vActual.r03}`);

// ── 2) GASTOS: categoría nueva + pagado intacto ──
const [gastoExistente] = (await db.query(`
  SELECT e.id, e.item, c.name AS cat FROM "ExpenseLine" e JOIN "ExpenseCategory" c ON c.id=e."categoryId"
  WHERE e."budgetId"=$1 ORDER BY e."sortOrder" LIMIT 1`, [budgetId])).rows;
await db.query(`UPDATE "ExpenseLine" SET paid=true, "paidAt"=now() WHERE id=$1`, [gastoExistente.id]);

const g = await subir("gastos", [
  ["Categoría", "Ítem", ...MESES],
  [gastoExistente.cat, gastoExistente.item, "777.888", ...Array(11).fill(0)],
  ["Categoría Import E2E", "Ítem nuevo E2E", 50000, ...Array(11).fill(0)],
]);
check("gastos: importación acepta", g.status === 200);
check("gastos: 1 creada, 1 actualizada y categoría nueva", g.data.creadas === 1 && g.data.actualizadas === 1 && g.data.categoriasNuevas?.includes("Categoría Import E2E"));

const [gActual] = (await db.query(`SELECT m01::text AS m01, paid FROM "ExpenseLine" WHERE id=$1`, [gastoExistente.id])).rows;
check("gastos: actualizó el monto y el PAGADO quedó intacto", gActual.m01 === "777888.00" && gActual.paid === true);

// ── 3) CAPEX: nivel N recalculado server-side ──
const c = await subir("capex", [
  ["Inversión", "Para qué", "Monto", "Moneda", "Mes requerido", "Plazo", "Fuente", "Iniciativa"],
  ["Inversión Import E2E", "prueba", "600", "UF", "Sep", "12", "Banco", ""],
]);
check("capex: importación acepta", c.status === 200);
const [cNuevo] = (await db.query(`
  SELECT currency, "approvalLevel", "monthNeeded", "financingSource" FROM "CapexItem"
  WHERE "budgetId"=$1 AND description='Inversión Import E2E'`, [budgetId])).rows;
check(
  "capex: UF 600 → nivel N2, mes 9, fuente BANCO (calculado en el server)",
  cNuevo?.currency === "UF" && cNuevo?.approvalLevel === 2 && cNuevo?.monthNeeded === 9 && cNuevo?.financingSource === "BANCO",
  JSON.stringify(cNuevo),
);

// ── 4) Guards: presupuesto no editable y rechazos con motivo ──
await db.query(`UPDATE "Budget" SET status='ENVIADO' WHERE id=$1`, [budgetId]);
const bloqueado = await subir("ventas", [["Cliente", "Tipo", "Canal", ...MESES], ["X", "", "", 1, ...Array(11).fill(0)]]);
check("guard: con presupuesto ENVIADO responde 409", bloqueado.status === 409, bloqueado.data.error?.slice(0, 60));
await db.query(`UPDATE "Budget" SET status='BORRADOR' WHERE id=$1`, [budgetId]);

const conRechazos = await subir("ventas", [
  ["Cliente", "Tipo", "Canal", ...MESES],
  ["", "", "", 999, ...Array(11).fill(0)],
  ["Cliente OK E2E", "quizás", "", 1, ...Array(11).fill(0)],
]);
check(
  "rechazos: cada fila mala vuelve con su motivo",
  conRechazos.status === 422 || (conRechazos.data.rechazos?.length === 2),
  JSON.stringify(conRechazos.data.rechazos ?? []).slice(0, 140),
);

// ── 5) Re-importar el MISMO archivo: idempotente (todo actualizadas, nada duplicado) ──
const rep = await subir("capex", [
  ["Inversión", "Para qué", "Monto", "Moneda", "Mes requerido", "Plazo", "Fuente", "Iniciativa"],
  ["Inversión Import E2E", "prueba", "600", "UF", "Sep", "12", "Banco", ""],
]);
const [{ n: repetidos }] = (await db.query(`
  SELECT count(*)::int AS n FROM "CapexItem" WHERE "budgetId"=$1 AND description='Inversión Import E2E'`, [budgetId])).rows;
check("re-importar es idempotente (actualiza, no duplica)", rep.data.actualizadas === 1 && rep.data.creadas === 0 && repetidos === 1);

// ── 6) La plantilla oficial cruda NO infla el presupuesto (filas EJEMPLO) ──
const resPlantilla = await fetch(`${base}/api/presupuesto/plantilla?modulo=ventas`, { headers: { cookie: header() } });
const plantillaBuf = Buffer.from(await resPlantilla.arrayBuffer());
const formCruda = new FormData();
formCruda.set("file", new File([plantillaBuf], "plantilla-ventas.xlsx"));
formCruda.set("modulo", "ventas");
formCruda.set("año", "2026");
const cruda = await fetch(`${base}/api/presupuesto/upload`, { method: "POST", headers: { cookie: header() }, body: formCruda });
const crudaData = await cruda.json();
check(
  "subir la plantilla sin editar rechaza las filas EJEMPLO (no crea ficticios)",
  cruda.status === 422 && crudaData.rechazos?.every((r) => r.motivo.includes("EJEMPLO")),
  `status ${cruda.status}, ${crudaData.rechazos?.length ?? 0} rechazos`,
);

// ── 7) Un Excel con solo 6 meses se rechaza diciendo qué columnas faltan ──
const parcial = await subir("ventas", [
  ["Cliente", "Tipo", "Canal", "Ene", "Feb", "Mar", "Abr", "May", "Jun"],
  ["Cliente Parcial", "", "", 1, 2, 3, 4, 5, 6],
]);
check(
  "archivo con meses incompletos → 422 nombrando las columnas que faltan",
  parcial.status === 422 && /Jul/.test(parcial.data.error ?? ""),
  parcial.data.error?.slice(0, 100),
);

// ── 8) Actualizar capex con celda Moneda vacía PRESERVA la moneda (no UF→CLP) ──
await subir("capex", [
  ["Inversión", "Para qué", "Monto", "Moneda", "Mes requerido", "Plazo", "Fuente", "Iniciativa"],
  ["Inversión Moneda E2E", "", "20000", "UF", "1", "", "Banco", ""],
]);
const upd = await subir("capex", [
  ["Inversión", "Para qué", "Monto", "Moneda", "Mes requerido", "Plazo", "Fuente", "Iniciativa"],
  ["Inversión Moneda E2E", "", "20000", "", "2", "", "", ""],
]);
const [monedaRow] = (await db.query(`
  SELECT currency, "approvalLevel", "financingSource", "monthNeeded" FROM "CapexItem"
  WHERE "budgetId"=$1 AND description='Inversión Moneda E2E'`, [budgetId])).rows;
check(
  "capex: celda vacía al actualizar preserva UF, fuente y recalcula N con la moneda REAL",
  upd.status === 200 && monedaRow?.currency === "UF" && monedaRow?.financingSource === "BANCO" && monedaRow?.monthNeeded === 2 && monedaRow?.approvalLevel === 4,
  JSON.stringify(monedaRow),
);

// ── Limpieza de los datos de prueba ──
await db.query(`DELETE FROM "CapexItem" WHERE "budgetId"=$1 AND description='Inversión Moneda E2E'`, [budgetId]);
await db.query(`DELETE FROM "SalesLine" WHERE "budgetId"=$1 AND client IN ('Cliente Nuevo Import E2E','Cliente OK E2E')`, [budgetId]);
await db.query(`DELETE FROM "ExpenseLine" WHERE "budgetId"=$1 AND item='Ítem nuevo E2E'`, [budgetId]);
await db.query(`DELETE FROM "ExpenseCategory" WHERE name='Categoría Import E2E'`);
await db.query(`DELETE FROM "CapexItem" WHERE "budgetId"=$1 AND description='Inversión Import E2E'`, [budgetId]);
await db.query(`UPDATE "ExpenseLine" SET paid=false, "paidAt"=NULL WHERE id=$1`, [gastoExistente.id]);
console.log("(datos de prueba limpiados)");

const ok = resultados.filter(Boolean).length;
console.log(`\n${ok}/${resultados.length} verificaciones OK`);
await db.end();
process.exit(ok === resultados.length ? 0 : 1);
