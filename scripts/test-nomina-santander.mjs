/**
 * E2E de la nómina en formato Santander: crea un lote de prueba estilo
 * Resintech (factura pagada en abonos), descarga la nómina con la sesión de
 * Guido y verifica las 13 columnas, las fórmulas K/L, la hoja Control de
 * abonos con su diferencia-fórmula, y la sección Abonos por referencia en la
 * pantalla de Bancos. Limpia todo al final.
 *
 * Uso: node scripts/test-nomina-santander.mjs [URL_BASE] [DATABASE_URL]
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
const q = (sql, p) => db.query(sql, p).then((r) => r.rows);

// ── Sesión de Guido ──
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
  body: new URLSearchParams({ csrfToken, email: "guido@cehta.cl", password: "Cehta2026!", callbackUrl: base }),
});
guardar(r);

// ── Datos de prueba: hoja + 3 abonos Resintech + registro con el total ──
const [{ id: companyId }] = await q(`SELECT id FROM "Company" WHERE code='RHO'`);
await q(`UPDATE "Company" SET "cuentaOrigen"='94278910' WHERE id=$1`, [companyId]);

const [{ id: sheetId }] = await q(
  `INSERT INTO "BankSheet" (id, "companyId", name, "sourceFile", "createdAt")
   VALUES (gen_random_uuid()::text, $1, 'E2E Cartola Santander', 'e2e.xlsx', now()) RETURNING id`,
  [companyId],
);
const [{ id: regSheetId }] = await q(
  `INSERT INTO "BankSheet" (id, "companyId", name, "sourceFile", "createdAt")
   VALUES (gen_random_uuid()::text, $1, 'Órdenes de compra E2E', 'e2e.xlsx', now()) RETURNING id`,
  [companyId],
);
// Registro: el total de la factura ($15.484.578), saldo aún pendiente $484.578
await q(
  `INSERT INTO "BankMovement" (id, "sheetId", "rowIndex", reference, description, debit, credit, estado, released, rut, "bankName", "accountNumber", "createdAt", "updatedAt")
   VALUES (gen_random_uuid()::text, $1, 1, 'Factura 541 E2E', 'Resintech Ltda — total', 484578, 0, 'PENDIENTE', false, NULL, NULL, NULL, now(), now())`,
  [regSheetId],
);
// Tres abonos ya liberados (los que van en el lote)
const abonoIds = [];
for (let i = 0; i < 3; i++) {
  const [{ id }] = await q(
    `INSERT INTO "BankMovement" (id, "sheetId", "rowIndex", reference, description, debit, credit, date, estado, released, rut, "bankName", "accountNumber", email, "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, 'Factura 541 E2E', 'Abono Resintech', 5000000, 0, now(), 'LIBERADO', true, '76.058.363-4', 'Banco de Chile', '3300036508', 'pagos@resintech.cl', now(), now()) RETURNING id`,
    [sheetId, i + 1],
  );
  abonoIds.push(id);
}
const [{ id: loteId }] = await q(
  `INSERT INTO "TransferBatch" (id, "companyId", number, status, "releasedAt", "createdAt")
   VALUES (gen_random_uuid()::text, $1, 900, 'LIBERADO', now(), now()) RETURNING id`,
  [companyId],
);
await q(`UPDATE "BankMovement" SET "batchId"=$1 WHERE id = ANY($2)`, [loteId, abonoIds]);

try {
  // ── 1) Nómina del lote en formato Santander ──
  const res = await fetch(`${base}/api/bancos/nomina?lote=${loteId}`, { headers: { cookie: header() } });
  check("la nómina del lote descarga", res.status === 200);
  const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer", cellFormula: true });

  check(
    "hojas: Transferencias + Control de abonos + Resumen",
    ["Transferencias", "Control de abonos", "Resumen"].every((h) => wb.SheetNames.includes(h)),
    wb.SheetNames.join(", "),
  );

  const t = wb.Sheets["Transferencias"];
  const enc = XLSX.utils.sheet_to_json(t, { header: 1 })[0];
  check("13 columnas con los encabezados EXACTOS del formato del banco", enc.length === 13 && String(enc[0]).startsWith("Cuenta origen") && String(enc[12]).includes("Glosa cartola beneficiario"));
  const fila2 = XLSX.utils.sheet_to_json(t, { header: 1 })[1];
  check(
    "fila de abono: cuenta origen, CLP, cuenta destino, código banco 1, RUT sin puntos, monto",
    String(fila2[0]) === "94278910" && fila2[1] === "CLP" && String(fila2[2]) === "3300036508" && fila2[4] === 1 && fila2[5] === "760583634" && fila2[7] === 5000000,
    JSON.stringify(fila2.slice(0, 8)),
  );
  check("K y L son fórmulas =I (como en el archivo real del banco)", t.K2?.f === "I2" && t.L2?.f === "I2");
  check("M dice PROVEEDORES", fila2[12] === "PROVEEDORES");

  const c = wb.Sheets["Control de abonos"];
  const filasC = XLSX.utils.sheet_to_json(c, { header: 1 });
  const filaRef = filasC[3]; // fila 4: primera referencia
  check(
    "Control: Total $15.484.578, abonado antes $0, este lote $15.000.000",
    filaRef?.[0] === "Factura 541 E2E" && filaRef?.[1] === 15484578 && filaRef?.[2] === 0 && filaRef?.[3] === 15000000,
    JSON.stringify(filaRef),
  );
  check("la DIFERENCIA es una fórmula que se descuenta sola", c.E4?.f === "B4-C4-D4");
  check("el total del lote es fórmula SUM", /^SUM\(D4:D\d+\)$/.test(c.D6?.f ?? ""));

  // ── 2) Pantalla inicial de Bancos: sección Abonos por referencia ──
  const html = await (await fetch(`${base}/bancos?empresa=RHO`, { headers: { cookie: header() } })).text();
  check("sección «Abonos por referencia» en la pantalla inicial", html.includes("Abonos por referencia"));
  check("el grupo E2E aparece con su diferencia", html.includes("Factura 541 E2E"));
  check("columnas del detalle: Fecha/Descripción/Monto abono/Datos bancarios/Estado",
    ["Monto abono", "Datos bancarios"].every((col) => html.includes(col)));

} finally {
  // ── Limpieza total ──
  await q(`DELETE FROM "TransferBatch" WHERE id=$1`, [loteId]);
  await q(`DELETE FROM "BankSheet" WHERE id IN ($1, $2)`, [sheetId, regSheetId]);
  await q(`UPDATE "Company" SET "cuentaOrigen"=NULL WHERE id=$1`, [companyId]);
  console.log("(datos de prueba limpiados)");
}

const ok = resultados.filter(Boolean).length;
console.log(`\n${ok}/${resultados.length} verificaciones OK`);
await db.end();
process.exit(ok === resultados.length ? 0 : 1);
