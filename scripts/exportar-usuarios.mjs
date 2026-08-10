/**
 * Excel con TODOS los usuarios para empezar a probar la plataforma.
 *
 * No se limita a listarlos: comprueba uno por uno que entren de verdad en
 * producción antes de escribirlos, y agrega qué hace cada rol y qué conviene
 * probar con él. Un listado que no se verifica no sirve para empezar a usar
 * la app — es justamente donde uno pierde la tarde.
 *
 * Uso: node scripts/exportar-usuarios.mjs [DATABASE_URL] [URL_BASE] [SALIDA.xlsx]
 */
import pg from "pg";
import * as XLSX from "xlsx";
import { writeFileSync } from "node:fs";

const dbUrl = process.argv[2] ?? "postgres://postgres:postgres@127.0.0.1:51214/presupuestos?sslmode=disable";
const base = process.argv[3] ?? "https://presupuestos-cehta-nicolasrietta-1798s-projects.vercel.app";
const salida = process.argv[4] ?? "Usuarios-Presupuestos-CEHTA.xlsx";

/** Las cuentas del fondo usan Cehta2026!; las de gerencia, Demo2026!. */
const claveDe = (email) => (email.startsWith("demo.") ? "Demo2026!" : "Cehta2026!");

const ROL = {
  FUND_ADMIN: {
    nombre: "Administrador de la plataforma",
    hace: "Ve las 10 entidades, consolida, configura la cuenta origen del banco y destraba lo que se complique.",
    probar: "Entrá primero con este: es el único que ve todo junto. Mirá el consolidado y la configuración.",
  },
  DUENO: {
    nombre: "Dueño del fondo",
    hace: "Aprueba los presupuestos que Vicky revisó, libera los pagos y confirma que se transfirieron.",
    probar: "En Bancos: seleccioná pagos pendientes y liberalos — sale el lote y la nómina para el banco.",
  },
  ADMINISTRADORA: {
    nombre: "Administradora del fondo",
    hace: "Revisa los presupuestos antes del dueño y sube el comprobante de cada transferencia.",
    probar: "Revisá un presupuesto «Enviado» y dale visto bueno. En Bancos, subí el comprobante de un lote liberado.",
  },
  COMPANY_MANAGER: {
    nombre: "Encargado de empresa",
    hace: "Carga y edita el presupuesto de SU empresa (Ventas, Gastos, CAPEX) y lo envía al fondo.",
    probar: "Entrá a Ventas o Gastos, cambiá un monto y mandalo a revisión. Solo ve su propia empresa.",
  },
};

async function entra(email, password) {
  const cookies = {};
  const guardar = (r) => {
    for (const ck of r.headers.getSetCookie?.() ?? []) {
      const [p] = ck.split(";");
      const i = p.indexOf("=");
      cookies[p.slice(0, i).trim()] = p.slice(i + 1);
    }
  };
  const header = () => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  try {
    let r = await fetch(`${base}/api/auth/csrf`);
    guardar(r);
    const { csrfToken } = await r.json();
    r = await fetch(`${base}/api/auth/callback/credentials`, {
      method: "POST",
      redirect: "manual",
      headers: { cookie: header(), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, email, password, callbackUrl: base }),
    });
    guardar(r);
    const res = await fetch(`${base}/`, { headers: { cookie: header() }, redirect: "manual" });
    // 200 = entró al panel; 307 hacia /login = no entró.
    return res.status === 200;
  } catch {
    return false;
  }
}

const c = new pg.Client({ connectionString: dbUrl });
await c.connect();
const { rows } = await c.query(`
  SELECT u.email, u.name, u.role, co.code, co.name AS empresa
  FROM "User" u LEFT JOIN "Company" co ON co.id = u."companyId"
  ORDER BY
    CASE u.role WHEN 'FUND_ADMIN' THEN 1 WHEN 'DUENO' THEN 2 WHEN 'ADMINISTRADORA' THEN 3 ELSE 4 END,
    co.code NULLS FIRST`);
await c.end();

console.log(`Verificando ${rows.length} cuentas contra ${base} …`);
const filas = [];
for (const u of rows) {
  const clave = claveDe(u.email);
  const ok = await entra(u.email, clave);
  console.log(`${ok ? "✓" : "✗"} ${u.email}`);
  const r = ROL[u.role] ?? { nombre: u.role, hace: "", probar: "" };
  filas.push({
    Empresa: u.code ?? "Todo el fondo",
    "Nombre de la empresa": u.empresa ?? "AFIS / FIP — vista consolidada",
    Rol: r.nombre,
    Persona: u.name,
    Correo: u.email,
    Contraseña: clave,
    "Qué puede hacer": r.hace,
    "Por dónde empezar": r.probar,
    Entra: ok ? "sí" : "NO — revisar",
  });
}

const wb = XLSX.utils.book_new();

// Hoja 1: las cuentas
const ws = XLSX.utils.json_to_sheet(filas);
ws["!cols"] = [
  { wch: 14 }, { wch: 30 }, { wch: 30 }, { wch: 30 }, { wch: 26 },
  { wch: 13 }, { wch: 78 }, { wch: 78 }, { wch: 13 },
];
ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas.length, c: 8 } }) };
ws["!freeze"] = { xSplit: 0, ySplit: 1 };
XLSX.utils.book_append_sheet(wb, ws, "Usuarios");

// Hoja 2: cómo probar los dos circuitos, en orden
const guia = [
  ["CÓMO PROBAR LA PLATAFORMA", ""],
  ["", ""],
  [`Dirección`, base],
  ["", ""],
  ["CIRCUITO DEL PRESUPUESTO — hacen falta 3 personas, a propósito", ""],
  ["1", "Entrá como el encargado de una empresa (demo.rho@cehta.cl) y editá Ventas o Gastos."],
  ["2", "Mandalo a revisión con «Enviar a revisión»."],
  ["3", "Entrá como Vicky (vicky@cehta.cl) y dale «Revisar (visto bueno)» — o devolvelo con «Observar»."],
  ["4", "Entrá como Guido (guido@cehta.cl) y aprobalo. Quien revisó NO puede aprobar: son dos firmas."],
  ["", ""],
  ["CIRCUITO DE PAGOS — también son tres manos", ""],
  ["1", "Como Guido, entrá a Bancos, seleccioná pagos pendientes y «Liberar y crear lote»."],
  ["2", "Descargá la nómina del lote: es el archivo que se carga en el banco (formato Santander)."],
  ["3", "Como Vicky, subí el comprobante de la transferencia."],
  ["4", "Como Guido, confirmá que se transfirió."],
  ["", ""],
  ["CARGAR ALGO A MANO", ""],
  ["1", "En Bancos, «+ Agregar movimiento»: una factura suelta o un abono que entró."],
  ["2", "Ojo: quien lo carga NO puede liberarlo. Cargalo con Vicky y liberalo con Guido."],
  ["", ""],
  ["ANTES DE REPARTIR ESTOS ACCESOS", ""],
  ["", "Estas claves son de puesta en marcha y están compartidas por tipo de cuenta."],
  ["", "Cambialas antes de darle el acceso a alguien de afuera del equipo."],
];
const wsGuia = XLSX.utils.aoa_to_sheet(guia);
wsGuia["!cols"] = [{ wch: 12 }, { wch: 110 }];
XLSX.utils.book_append_sheet(wb, wsGuia, "Cómo probar");

writeFileSync(salida, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
const entran = filas.filter((f) => f.Entra === "sí").length;
console.log(`\n${salida} — ${filas.length} cuentas, ${entran} verificadas contra producción`);
process.exit(entran === filas.length ? 0 : 1);
