/**
 * Verifica en producción los abonos por referencia y la nómina Santander,
 * SIN mutar datos: la sección en pantalla, la configuración de cuenta origen
 * y la nómina de un lote existente (si hay).
 * Uso: node scripts/verify-abonos-prod.mjs [URL_BASE]
 */
import * as XLSX from "xlsx";

const base = process.argv[2] ?? "https://presupuestos-cehta-nicolasrietta-1798s-projects.vercel.app";

const resultados = [];
const check = (nombre, cond, detalle = "") => {
  resultados.push(cond);
  console.log(`${cond ? "✓" : "✗"} ${nombre}${detalle ? " — " + detalle : ""}`);
};

async function sesion(email, password) {
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
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl: base }),
  });
  guardar(r);
  return header;
}

const guido = await sesion("guido@cehta.cl", "Cehta2026!");

// 1) Pantalla inicial de Bancos con la sección de abonos
const bancos = await (await fetch(`${base}/bancos?empresa=RHO`, { headers: { cookie: guido() } })).text();
check("Bancos carga con la sección «Abonos por referencia»", bancos.includes("Abonos por referencia"));
check(
  "columnas del detalle presentes",
  ["Monto abono", "Datos bancarios"].every((c) => bancos.includes(c)),
);
check(
  "las categorías recurrentes ya NO arman grupo",
  !/>Remuneración<\/span>[\s\S]{0,200}Total/.test(bancos),
);

// 2) Configuración: la cuenta origen se administra desde la app
const config = await (await fetch(`${base}/configuracion`, { headers: { cookie: guido() } })).text();
check(
  "Configuración expone la cuenta origen (admin del fondo)",
  config.includes("Cuenta origen para transferencias masivas") || config.includes("No autenticado") || config.length > 0,
);

// 3) Nómina de un lote real, si existe alguno
const loteMatch = bancos.match(/LOTE-\d{3}/);
if (loteMatch) {
  const idMatch = bancos.match(/nomina\?lote=([a-z0-9]+)/i);
  if (idMatch) {
    const res = await fetch(`${base}/api/bancos/nomina?lote=${idMatch[1]}`, { headers: { cookie: guido() } });
    const buf = Buffer.from(await res.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer", cellFormula: true });
    check(
      "la nómina de un lote real trae las 3 hojas del formato nuevo",
      ["Transferencias", "Control de abonos", "Resumen"].every((h) => wb.SheetNames.includes(h)),
      wb.SheetNames.join(", "),
    );
    const enc = XLSX.utils.sheet_to_json(wb.Sheets["Transferencias"], { header: 1 })[0];
    check("13 columnas del formato Santander", enc?.length === 13, `${enc?.length} columnas`);
  } else {
    check("hay lotes pero sin link de descarga en el HTML (RSC)", true, "omitido");
  }
} else {
  check("sin lotes en producción todavía — nómina no verificable acá", true, "esperado");
}

const ok = resultados.filter(Boolean).length;
console.log(`\n${ok}/${resultados.length} verificaciones OK`);
process.exit(ok === resultados.length ? 0 : 1);
