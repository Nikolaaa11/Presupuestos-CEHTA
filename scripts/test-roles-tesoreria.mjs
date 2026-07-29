/**
 * Verifica los permisos del circuito de pagos contra la app corriendo.
 * Uso: node scripts/test-roles-tesoreria.mjs [baseUrl]
 */
const base = process.argv[2] ?? "http://localhost:3000";

const resultados = [];
const check = (nombre, cond, detalle = "") => {
  resultados.push(cond);
  console.log(`${cond ? "✓" : "✗"} ${nombre}${detalle ? " — " + detalle : ""}`);
};

async function login(email, password) {
  const cookies = {};
  const guardar = (r) => {
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const [par] = c.split(";");
      const i = par.indexOf("=");
      cookies[par.slice(0, i).trim()] = par.slice(i + 1);
    }
  };
  const header = () => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");

  let r = await fetch(base + "/api/auth/csrf");
  guardar(r);
  const { csrfToken } = await r.json();
  r = await fetch(base + "/api/auth/callback/credentials", {
    method: "POST", redirect: "manual",
    headers: { cookie: header(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, email, password }),
  });
  guardar(r);
  const conSesion = Object.keys(cookies).some((k) => k.includes("session-token"));
  return { header, conSesion };
}

const texto = (h) => h.replace(/<!--[^>]*-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

// Guido — dueño
const guido = await login("guido@cehta.cl", "Cehta2026!");
check("Guido (dueño) puede iniciar sesión", guido.conSesion);
if (guido.conSesion) {
  const html = await (await fetch(base + "/bancos?empresa=AFIS", { headers: { cookie: guido.header() } })).text();
  check("Guido ve casillas para seleccionar y liberar", (html.match(/type="checkbox"/g) ?? []).length > 5,
    `${(html.match(/type="checkbox"/g) ?? []).length} casillas`);
  check("Guido ve el botón de editar", /&gt;Editar&lt;|>Editar</.test(html));
  check("Guido ve la bitácora y la descarga de Excel", /bit.cora/i.test(texto(html)) && /bancos\/nomina/.test(html));
  check("la app avisa qué pagos no tienen datos bancarios", /falta /.test(texto(html)));
}

// Vicky — administradora
const vicky = await login("vicky@cehta.cl", "Cehta2026!");
check("Vicky (administradora) puede iniciar sesión", vicky.conSesion);
if (vicky.conSesion) {
  const html = await (await fetch(base + "/bancos?empresa=AFIS", { headers: { cookie: vicky.header() } })).text();
  const t = texto(html);
  check("Vicky NO ve casillas para liberar", (html.match(/tbody[\s\S]*?type="checkbox"/g) ?? []).length === 0);
  check("Vicky sí puede editar los datos bancarios", />Editar</.test(html));
  check("Vicky ve la bitácora", /bit.cora/i.test(t));
}

// Un gerente no debería poder liberar
const gerente = await login("demo.afis@cehta.cl", "Demo2026!");
if (gerente.conSesion) {
  const html = await (await fetch(base + "/bancos", { headers: { cookie: gerente.header() } })).text();
  check("el gerente NO ve casillas de liberación", (html.match(/tbody[\s\S]*?type="checkbox"/g) ?? []).length === 0);
}

const fallos = resultados.filter((x) => !x).length;
console.log(fallos === 0 ? "\nPERMISOS OK ✅" : `\n${fallos} FALLARON ❌`);
process.exit(fallos === 0 ? 0 : 1);
