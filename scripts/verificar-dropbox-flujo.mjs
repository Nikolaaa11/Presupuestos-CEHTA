/**
 * Verifica el arranque de la conexión con Dropbox contra el servidor real, sin
 * necesidad de que una persona apriete "Permitir".
 *
 * Lo que NO se puede automatizar es la pantalla de consentimiento: requiere la
 * sesión de Dropbox del dueño de la cuenta. Todo lo anterior sí.
 *
 * Uso: node scripts/verificar-dropbox-flujo.mjs [URL_BASE]
 */
const base = process.argv[2] ?? "http://localhost:3000";

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
    method: "POST", redirect: "manual",
    headers: { cookie: header(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl: base }),
  });
  guardar(r);
  return { header, guardar };
}

// ── 1) Sin sesión no se arranca la conexión ──
const anonimo = await fetch(`${base}/api/dropbox/conectar`, { redirect: "manual" });
check("sin sesión, conectar Dropbox da 401", anonimo.status === 401, `status ${anonimo.status}`);

// ── 2) Un rol que no es del fondo tampoco ──
const gerente = await sesion("demo.rho@cehta.cl", "Demo2026!");
const comoGerente = await fetch(`${base}/api/dropbox/conectar`, {
  headers: { cookie: gerente.header() }, redirect: "manual",
});
check(
  "un encargado de empresa recibe 403",
  comoGerente.status === 403,
  `status ${comoGerente.status}`,
);

// ── 3) El admin del fondo sí, y la URL sale bien armada ──
const admin = await sesion("admin@cehta.cl", "Cehta2026!");
const comoAdmin = await fetch(`${base}/api/dropbox/conectar`, {
  headers: { cookie: admin.header() }, redirect: "manual",
});
check("el admin del fondo es redirigido a Dropbox", comoAdmin.status === 302, `status ${comoAdmin.status}`);

const destino = comoAdmin.headers.get("location") ?? "";
const url = destino.startsWith("http") ? new URL(destino) : null;
check("la redirección apunta a dropbox.com", url?.host === "www.dropbox.com", url?.host ?? destino.slice(0, 60));

if (url) {
  const p = url.searchParams;
  check("pide permiso duradero (offline)", p.get("token_access_type") === "offline");
  check(
    "pide solo los 3 permisos de lectura",
    p.get("scope") === "account_info.read files.metadata.read files.content.read",
    p.get("scope") ?? "",
  );
  check(
    "no pide ningún permiso de escritura",
    !(p.get("scope") ?? "").includes(".write"),
  );
  check(
    "la dirección de retorno es la registrada",
    p.get("redirect_uri") === `${base}/api/dropbox/callback`,
    p.get("redirect_uri") ?? "",
  );
  check("manda un state contra suplantación", (p.get("state") ?? "").length >= 20);
  check("la cookie del state queda marcada httpOnly",
    (comoAdmin.headers.getSetCookie?.() ?? []).some((c) => c.startsWith("dropbox_state=") && /httponly/i.test(c)));

  // ── 4) ¿Dropbox acepta esta app y esta dirección de retorno? ──
  //
  // OJO: Dropbox rechaza con un 302 hacia /oauth2/authorize_error, no con un
  // 4xx. La primera versión de este chequeo daba el 302 por bueno y decía que
  // todo estaba bien mientras la conexión fallaba en la cara del usuario. Hay
  // que SEGUIR la redirección y mirar a dónde lleva.
  let paso = destino;
  let respuesta = await fetch(paso, { redirect: "manual" });
  for (let i = 0; i < 5 && respuesta.status >= 300 && respuesta.status < 400; i++) {
    const siguiente = respuesta.headers.get("location");
    if (!siguiente) break;
    paso = new URL(siguiente, paso).toString();
    if (paso.includes("authorize_error")) break; // ya sabemos que rechazó
    respuesta = await fetch(paso, { redirect: "manual" });
  }

  if (paso.includes("authorize_error")) {
    const detalle = decodeURIComponent(new URL(paso).searchParams.get("error_detail") ?? "");
    const esRedirect = /redirect_uri/i.test(detalle);
    check(
      "Dropbox acepta la app y la dirección de retorno",
      false,
      esRedirect
        ? `el redirect_uri NO está registrado en la app de Dropbox. Agregá exactamente: ${p.get("redirect_uri")}`
        : detalle.slice(0, 140),
    );
  } else {
    // Sin sesión de Dropbox termina en la pantalla de login, que es lo esperado:
    // significa que la app y la URL de retorno pasaron la validación.
    check(
      "Dropbox acepta la app y la dirección de retorno",
      /dropbox\.com/.test(paso) && !/authorize_error/.test(paso),
      `llegó a ${new URL(paso).pathname}`,
    );
  }
}

// ── 5) El callback rechaza un state que no coincide ──
const falso = await fetch(`${base}/api/dropbox/callback?code=x&state=inventado`, {
  headers: { cookie: admin.header() }, redirect: "manual",
});
const aDonde = falso.headers.get("location") ?? "";
check(
  "un state inventado no conecta nada",
  falso.status === 302 && aDonde.includes("dropbox=error"),
  aDonde.slice(0, 80),
);

const ok = resultados.filter(Boolean).length;
console.log(`\n${ok}/${resultados.length} verificaciones OK`);
process.exit(ok === resultados.length ? 0 : 1);
