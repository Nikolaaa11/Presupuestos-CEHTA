/**
 * Verifica en producción la fase de avisos y pago por etapas, sobre el HTML
 * servido y sin modificar datos.
 * Uso: node scripts/verify-avisos-prod.mjs [URL_BASE]
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
      const [par] = ck.split(";");
      const i = par.indexOf("=");
      cookies[par.slice(0, i).trim()] = par.slice(i + 1);
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
  return async (ruta) => {
    const res = await fetch(base + ruta, { headers: { cookie: header() } });
    return { status: res.status, html: await res.text() };
  };
}

// ── Encargado de RHO ──
const rho = await sesion("demo.rho@cehta.cl", "Demo2026!");

const gastos = await rho("/gastos");
check("Gastos carga", gastos.status === 200);
check("columna Pagado en la grilla", gastos.html.includes(">Pagado<"));
check("banner positivo de editable", gastos.html.includes("Presupuesto editable"));

const ventas = await rho("/ventas");
check("Ventas con banner de editable", ventas.status === 200 && ventas.html.includes("Presupuesto editable"));

const bancos = await rho("/bancos");
check("Bancos carga", bancos.status === 200, `status ${bancos.status}, ${bancos.html.length} bytes`);
check("sección Avance por orden de compra", bancos.html.includes("Avance por orden de compra"));
// El doble conteo corregido: OC0005 debe mostrar $9.208.998, jamás $18.417.996
check(
  "OC0005 sin doble conteo",
  bancos.html.includes("9.208.998") && !bancos.html.includes("18.417.996"),
);
check("OC0017 como contrato en cuotas (53%, $45M)", bancos.html.includes("45.000.000"));

const panel = await rho("/");
check("dashboard del encargado carga", panel.status === 200);
check(
  "panel de avisos con resumen de OCs sin fecha",
  panel.html.includes("sin fecha de pago programada"),
);

const capex = await rho("/capex");
check("CAPEX carga", capex.status === 200);
// Los href del detalle se arman en el cliente: el payload RSC solo trae los
// cuid sueltos (ítems + presupuesto + empresa, sin distinguir). Se prueban
// candidatos hasta que uno rinda el caso bancable.
const candidatos = [...new Set(capex.html.match(/cms[a-z0-9]{20,}/g) ?? [])].slice(0, 6);
let cronogramaOk = false;
let probado = "";
for (const id of candidatos) {
  const detalle = await rho(`/capex/${id}`);
  if (detalle.status === 200 && detalle.html.includes("Cronograma de pago por etapas")) {
    cronogramaOk = true;
    probado = id;
    break;
  }
}
check(
  "caso bancable con cronograma de etapas",
  cronogramaOk,
  cronogramaOk ? probado : `ninguno de ${candidatos.length} candidatos`,
);

// ── Guido ve el panel del fondo con los avisos ──
const guido = await sesion("guido@cehta.cl", "Cehta2026!");
const panelGuido = await guido("/");
check("panel del fondo carga para Guido", panelGuido.status === 200);
check("avisos visibles en la vista del fondo", panelGuido.html.includes("Avisos de pago"));

const ok = resultados.filter(Boolean).length;
console.log(`\n${ok}/${resultados.length} verificaciones OK`);
process.exit(ok === resultados.length ? 0 : 1);
