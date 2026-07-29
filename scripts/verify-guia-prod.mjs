/**
 * Comprueba que cada rol vea SU guía en producción, y no la de otro.
 * Uso: node scripts/verify-guia-prod.mjs [URL_BASE]
 */
const base = process.argv[2] ?? "https://presupuestos-cehta-nicolasrietta-1798s-projects.vercel.app";

const resultados = [];
const check = (nombre, cond, detalle = "") => {
  resultados.push(cond);
  console.log(`${cond ? "✓" : "✗"} ${nombre}${detalle ? " — " + detalle : ""}`);
};

async function guiaDe(email, password) {
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
  const res = await fetch(`${base}/guia`, { headers: { cookie: header() } });
  return { status: res.status, html: await res.text() };
}

const casos = [
  {
    quien: "el encargado de RHO",
    email: "demo.rho@cehta.cl",
    password: "Demo2026!",
    dice: "Encargado de empresa",
    hace: "Cargá tus ventas mes a mes",
    noHace: "Aprobá lo que ya está revisado",
  },
  {
    quien: "Victoria",
    email: "vicky@cehta.cl",
    password: "Cehta2026!",
    dice: "Administradora del fondo",
    hace: "Dale el visto bueno",
    noHace: "Aprobá lo que ya está revisado",
  },
  {
    quien: "Guido",
    email: "guido@cehta.cl",
    password: "Cehta2026!",
    dice: "Dueño del fondo",
    hace: "Aprobá lo que ya está revisado",
    noHace: "Cargá tus ventas mes a mes",
  },
  {
    quien: "el administrador",
    email: "admin@cehta.cl",
    password: "Cehta2026!",
    dice: "Administrador de la plataforma",
    hace: "Consolidá el fondo",
    noHace: "Cargá tus ventas mes a mes",
  },
];

for (const c of casos) {
  const { status, html } = await guiaDe(c.email, c.password);
  check(`${c.quien} abre su guía`, status === 200);
  check(`  y dice «${c.dice}»`, html.includes(c.dice));
  check(`  con su paso propio`, html.includes(c.hace));
  check(`  y sin los pasos de otro rol`, !html.includes(c.noHace));
}

const ok = resultados.filter(Boolean).length;
console.log(`\n${ok}/${resultados.length} verificaciones OK`);
process.exit(ok === resultados.length ? 0 : 1);
