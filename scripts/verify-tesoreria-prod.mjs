/** Verificación final del módulo de tesorería en producción. */
const base = process.argv[2] ?? "https://presupuestos-cehta-nicolasrietta-1798s-projects.vercel.app";

const res = [];
const check = (n, c, d = "") => { res.push(c); console.log(`${c ? "✓" : "✗"} ${n}${d ? " — " + d : ""}`); };

async function login(email, password) {
  const cookies = {};
  const guardar = (r) => {
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const [par] = c.split(";"); const i = par.indexOf("=");
      cookies[par.slice(0, i).trim()] = par.slice(i + 1);
    }
  };
  const header = () => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  let r = await fetch(base + "/api/auth/csrf"); guardar(r);
  const { csrfToken } = await r.json();
  r = await fetch(base + "/api/auth/callback/credentials", {
    method: "POST", redirect: "manual",
    headers: { cookie: header(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, email, password }),
  });
  guardar(r);
  return header;
}

const texto = (h) => h.replace(/<!--[^>]*-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const guido = await login("guido@cehta.cl", "Cehta2026!");

// Panimávida en el selector y con su RUT
const html = await (await fetch(base + "/bancos?empresa=PANIMAVIDA", { headers: { cookie: guido() } })).text();
const t = texto(html);
check("PANIMAVIDA aparece como empresa", /PANIMAVIDA ENERGY SPA/.test(t));
check("PANIMAVIDA muestra su RUT", /78\.214\.693-9/.test(t));

// Descarga de Excel de movimientos
let r = await fetch(base + "/api/bancos/nomina?empresa=AFIS", { headers: { cookie: guido() } });
const buf = await r.arrayBuffer();
check("descarga el Excel de movimientos", r.status === 200 && buf.byteLength > 5000,
  `${Math.round(buf.byteLength / 1024)} KB`);
check("el archivo se llama según la empresa", /bancos-AFIS\.xlsx/.test(r.headers.get("content-disposition") ?? ""));

// Sin sesión no baja nada
r = await fetch(base + "/api/bancos/nomina?empresa=AFIS");
check("sin sesión no se puede descargar", r.status === 401, `status ${r.status}`);

// El resto de la app sigue viva
for (const p of ["/", "/ventas", "/gastos", "/capex", "/bancos"]) {
  const rr = await fetch(base + p, { headers: { cookie: guido() } });
  check(`${p} responde`, rr.status === 200, `status ${rr.status}`);
}

const fallos = res.filter((x) => !x).length;
console.log(fallos === 0 ? "\nTODO OK ✅" : `\n${fallos} FALLARON ❌`);
process.exit(fallos === 0 ? 0 : 1);
