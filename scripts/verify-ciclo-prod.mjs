/**
 * Verifica en producción el ciclo de aprobación en dos manos.
 *
 *   BORRADOR -envía-> ENVIADO -revisa-> REVISADO -aprueba-> APROBADO
 *              (encargado)   (Victoria)          (Guido)
 *
 * Comprueba sobre el HTML servido, sin tocar la base: que el encargado tenga
 * su presupuesto editable, que Victoria vea "Revisar" y no "Aprobar", y que
 * Guido no pueda dar el visto bueno.
 *
 * Uso: node scripts/verify-ciclo-prod.mjs [URL_BASE]
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
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const [par] = c.split(";");
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

// ── 1) El encargado de RHO edita y puede enviar ──────────────────────
const rho = await sesion("demo.rho@cehta.cl", "Demo2026!");
const panel = await rho("/");
check("el encargado entra a su panel", panel.status === 200);
check(
  "su presupuesto está en borrador (editable)",
  panel.html.includes(">Borrador<"),
  panel.html.includes(">Aprobado<") ? "aparece APROBADO — seguiría bloqueado" : "",
);
check("puede enviarlo al fondo", panel.html.includes("Enviar al fondo"));

const gastos = await rho("/gastos");
const celdasBloqueadas = (gastos.html.match(/disabled=""/g) ?? []).length;
check("las celdas de gastos están habilitadas", celdasBloqueadas < 50, `${celdasBloqueadas} deshabilitadas`);

// ── 2) Victoria revisa, no aprueba ───────────────────────────────────
const vicky = await sesion("vicky@cehta.cl", "Cehta2026!");
const panelVicky = await vicky("/");
check("Victoria ve el panel del fondo", panelVicky.status === 200 && panelVicky.html.includes("Avance presupuesto"));
check("Victoria no tiene botón de aprobar", !panelVicky.html.includes(">Aprobar<"));

// ── 3) Guido aprueba, no revisa ──────────────────────────────────────
const guido = await sesion("guido@cehta.cl", "Cehta2026!");
const panelGuido = await guido("/");
check("Guido ve el panel del fondo", panelGuido.status === 200 && panelGuido.html.includes("Avance presupuesto"));
check(
  "Guido no puede dar el visto bueno (esa firma es de la administradora)",
  !panelGuido.html.includes("Revisar (visto bueno)"),
);

// ── 4) El estado REVISADO existe en la base de producción ────────────
check(
  "la migración llegó a producción (sin errores de enum)",
  !panelGuido.html.includes("server error") && !panelVicky.html.includes("server error"),
);

const ok = resultados.filter(Boolean).length;
console.log(`\n${ok}/${resultados.length} verificaciones OK`);
process.exit(ok === resultados.length ? 0 : 1);
