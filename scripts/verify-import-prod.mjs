/**
 * Verifica en producción la carga masiva por Excel SIN mutar datos reales:
 * plantillas, botón en la UI, guard de rol, y el rechazo de la plantilla
 * cruda (que por diseño no escribe nada).
 * Uso: node scripts/verify-import-prod.mjs [URL_BASE]
 */
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

const rho = await sesion("demo.rho@cehta.cl", "Demo2026!");

// 1) Plantillas
let plantillaVentas = null;
for (const m of ["ventas", "gastos", "capex"]) {
  const res = await fetch(`${base}/api/presupuesto/plantilla?modulo=${m}`, { headers: { cookie: rho() } });
  const buf = Buffer.from(await res.arrayBuffer());
  if (m === "ventas") plantillaVentas = buf;
  check(`plantilla de ${m} descarga`, res.status === 200 && buf.subarray(0, 2).toString() === "PK", `${buf.length} bytes`);
}

// 2) Botón en la UI del encargado
const ventasHtml = await (await fetch(`${base}/ventas`, { headers: { cookie: rho() } })).text();
check("botón Importar Excel visible en Ventas", ventasHtml.includes("Importar Excel"));

// 3) La plantilla cruda se rechaza (EJEMPLO) — no escribe nada por diseño
const form = new FormData();
form.set("file", new File([plantillaVentas], "plantilla-ventas.xlsx"));
form.set("modulo", "ventas");
form.set("año", "2026");
const cruda = await fetch(`${base}/api/presupuesto/upload`, { method: "POST", headers: { cookie: rho() }, body: form });
const crudaData = await cruda.json();
check(
  "subir la plantilla cruda → 422 con rechazos EJEMPLO (cero escrituras)",
  cruda.status === 422 && crudaData.rechazos?.every((r) => r.motivo.includes("EJEMPLO")),
  `status ${cruda.status}`,
);

// 4) Guard de rol: el dueño no importa líneas
const guido = await sesion("guido@cehta.cl", "Cehta2026!");
const form2 = new FormData();
form2.set("file", new File([plantillaVentas], "plantilla-ventas.xlsx"));
form2.set("modulo", "ventas");
const comoGuido = await fetch(`${base}/api/presupuesto/upload`, { method: "POST", headers: { cookie: guido() }, body: form2 });
check("el dueño del fondo recibe 403 (solo la gerencia importa)", comoGuido.status === 403);

const ok = resultados.filter(Boolean).length;
console.log(`\n${ok}/${resultados.length} verificaciones OK`);
process.exit(ok === resultados.length ? 0 : 1);
