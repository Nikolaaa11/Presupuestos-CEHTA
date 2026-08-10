/**
 * E2E de la alta manual de movimientos, contra el servidor real.
 *
 * Cubre lo que no se puede ejercer desde la UI: que una hoja de Excel llamada
 * como la planilla manual no la borre, que la descarga por empresa siga
 * funcionando con la planilla nueva, y que la bitácora sobreviva a la fila que
 * documenta. Limpia lo que crea.
 *
 * Uso: node scripts/test-alta-movimiento.mjs [URL_BASE] [DATABASE_URL]
 */
import * as XLSX from "xlsx";
import pg from "pg";

const base = process.argv[2] ?? "http://localhost:3000";
const dbUrl = process.argv[3] ?? "postgres://postgres:postgres@127.0.0.1:51214/presupuestos?sslmode=disable";
const PLANILLA_MANUAL = "Cargas manuales";

const resultados = [];
const check = (nombre, cond, detalle = "") => {
  resultados.push(cond);
  console.log(`${cond ? "✓" : "✗"} ${nombre}${detalle ? " — " + detalle : ""}`);
};

// ── sesión ──
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
  body: new URLSearchParams({ csrfToken, email: "admin@cehta.cl", password: "Cehta2026!", callbackUrl: base }),
});
guardar(r);

const c = new pg.Client({ connectionString: dbUrl });
await c.connect();
const q = (sql, params) => c.query(sql, params).then((x) => x.rows);

// ── 1) El botón existe en la pantalla ──
const html = await (await fetch(`${base}/bancos?empresa=RHO`, { headers: { cookie: header() } })).text();
check("la pantalla de Bancos ofrece agregar un movimiento", html.includes("Agregar movimiento"));

// ── 2) Una hoja llamada como la planilla manual NO puede borrarla ──
// Sin este guard, subir un Excel con esa hoja se llevaba en cascada todo lo
// cargado a mano —y sus eventos— devolviendo {ok:true}: nadie veía el error.
const antesManual = await q(
  `select count(*)::int n from "BankMovement" m join "BankSheet" s on s.id=m."sheetId" where s.manual`,
);

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.aoa_to_sheet([
    ["Fecha", "Nombre/Ref", "Descripción", "Abonos", "Egreso"],
    ["2026-08-01", "TRAMPA", "hoja con el nombre reservado", 0, 1000],
  ]),
  PLANILLA_MANUAL,
);
const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

const form = new FormData();
form.set("file", new File([buf], "trampa.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
form.set("companyCode", "RHO");
form.set("sheets", PLANILLA_MANUAL);
const subida = await fetch(`${base}/api/bancos/upload`, {
  method: "POST",
  headers: { cookie: header() },
  body: form,
});
const cuerpo = await subida.json().catch(() => ({}));
check(
  "una hoja llamada «Cargas manuales» se rechaza",
  subida.status === 422,
  `status ${subida.status}${cuerpo.error ? " · " + String(cuerpo.error).slice(0, 70) : ""}`,
);

const despuesManual = await q(
  `select count(*)::int n from "BankMovement" m join "BankSheet" s on s.id=m."sheetId" where s.manual`,
);
check(
  "y no borró ni un movimiento manual",
  antesManual[0].n === despuesManual[0].n,
  `antes ${antesManual[0].n} · después ${despuesManual[0].n}`,
);

// ── 3) Una sola planilla manual por empresa ──
const hojas = await q(
  `select "companyId", count(*)::int n from "BankSheet" where manual group by 1 having count(*)>1`,
);
check("no hay dos planillas manuales en la misma empresa", hojas.length === 0);

// ── 4) La descarga por empresa sigue viva con la planilla nueva ──
// Dos hojas homónimas en un mismo libro hacen fallar a SheetJS.
const nomina = await fetch(`${base}/api/bancos/nomina?empresa=RHO`, { headers: { cookie: header() } });
check("la descarga por empresa responde 200", nomina.status === 200, `status ${nomina.status}`);

// ── 5) Las filas manuales llevan autor ──
const sinAutor = await q(
  `select count(*)::int n from "BankMovement" m join "BankSheet" s on s.id=m."sheetId"
   where s.manual and m."createdById" is null`,
);
check("todo movimiento manual tiene autor registrado", sinAutor[0].n === 0, `${sinAutor[0].n} sin autor`);

// ── 6) La bitácora sobrevive a la fila que documenta ──
// Era ON DELETE CASCADE: el evento se borraba junto con el movimiento, y
// `deshacerLiberacion` llegaba a borrar el evento que acababa de escribir.
//
// El caso se ARMA acá en vez de buscar una fila que quizá exista: un chequeo
// que se saltea solo no verifica nada, y así fue como esta comprobación no
// corrió en la segunda pasada.
const [empresa] = await q(`select id from "Company" order by code limit 1`);
const [autor] = await q(`select id from "User" where email = 'admin@cehta.cl'`);
const [hoja] = await q(
  `insert into "BankSheet" (id,"companyId",name,"sourceFile",manual,"createdAt")
   values ('sheet_test_bitacora',$1,'ZZ prueba bitácora','test',false,now())
   on conflict (id) do update set name = excluded.name returning id`,
  [empresa.id],
);
const [mov] = await q(
  `insert into "BankMovement" (id,"sheetId","rowIndex",reference,debit,credit,estado,"createdAt","updatedAt")
   values ('mov_test_bitacora',$1,1,'PRUEBA-BITACORA','1234.56','0','PENDIENTE',now(),now())
   on conflict (id) do update set reference = excluded.reference returning id`,
  [hoja.id],
);
const [ev] = await q(
  `insert into "BankEvent" (id,"companyId","movementId","actorUserId",action,detail,"createdAt")
   values ('ev_test_bitacora',$1,$2,$3,'MOVIMIENTO_AGREGADO','Egreso a pagar · PRUEBA-BITACORA · $1.235 (1234.56) · fecha 2026-08-15',now())
   on conflict (id) do update set detail = excluded.detail returning id`,
  [empresa.id, mov.id, autor.id],
);

await c.query(`delete from "BankMovement" where id = $1`, [mov.id]);
const [sobrevive] = await q(`select id, "movementId", detail from "BankEvent" where id = $1`, [ev.id]);
check(
  "borrar el movimiento NO borra su línea de bitácora",
  Boolean(sobrevive),
  sobrevive ? "el evento sigue ahí" : "el evento desapareció (¿volvió el CASCADE?)",
);
check(
  "y el evento queda huérfano pero legible",
  Boolean(sobrevive) && sobrevive.movementId === null && (sobrevive.detail ?? "").includes("1234.56"),
  sobrevive?.detail?.slice(0, 55) ?? "",
);

// Limpieza de lo que armó esta prueba
await c.query(`delete from "BankEvent" where id = $1`, [ev.id]);
await c.query(`delete from "BankSheet" where id = $1`, [hoja.id]);
console.log("  (limpieza: se borró la planilla y el evento de prueba)");

await c.end();
const ok = resultados.filter(Boolean).length;
console.log(`\n${ok}/${resultados.length} verificaciones OK`);
process.exit(ok === resultados.length ? 0 : 1);
