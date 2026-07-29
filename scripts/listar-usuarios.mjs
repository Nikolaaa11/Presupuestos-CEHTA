/**
 * Lista los usuarios de la plataforma y comprueba que cada uno entra
 * de verdad en producción. La contraseña no está en la base (va con hash):
 * se prueba la que corresponde a su tipo de cuenta.
 *
 * Uso: node scripts/listar-usuarios.mjs [DATABASE_URL] [URL_BASE]
 */
import pg from "pg";

const url = process.argv[2] ?? "postgres://postgres:postgres@127.0.0.1:51214/presupuestos?sslmode=disable";
const base = process.argv[3] ?? "https://presupuestos-cehta-nicolasrietta-1798s-projects.vercel.app";

const c = new pg.Client({ connectionString: url });
await c.connect();
const { rows } = await c.query(`
  SELECT u.email, u.name, u.role, co.code, co.name AS empresa
  FROM "User" u LEFT JOIN "Company" co ON co.id = u."companyId"
  ORDER BY
    CASE u.role WHEN 'FUND_ADMIN' THEN 1 WHEN 'DUENO' THEN 2 WHEN 'ADMINISTRADORA' THEN 3 ELSE 4 END,
    co.code NULLS FIRST`);
await c.end();

/** Las cuentas del fondo usan Cehta2026!; las de gerencia, Demo2026!. */
const claveDe = (email) => (email.startsWith("demo.") ? "Demo2026!" : "Cehta2026!");

async function entra(email, password) {
  const cookies = {};
  const guardar = (r) => {
    for (const ck of r.headers.getSetCookie?.() ?? []) {
      const [par] = ck.split(";");
      const i = par.indexOf("=");
      cookies[par.slice(0, i).trim()] = par.slice(i + 1);
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
    const home = await fetch(base + "/", { headers: { cookie: header() } });
    const html = await home.text();
    return home.status === 200 && !html.includes("Ingresar");
  } catch {
    return false;
  }
}

console.log(`Comprobando ${rows.length} cuentas en ${base}\n`);
console.log("ROL              EMAIL                          CLAVE        EMPRESA        ENTRA");
console.log("─".repeat(92));

let fallos = 0;
for (const u of rows) {
  const clave = claveDe(u.email);
  const ok = await entra(u.email, clave);
  if (!ok) fallos++;
  console.log(
    `${u.role.padEnd(16)} ${u.email.padEnd(30)} ${clave.padEnd(12)} ${(u.code ?? "— fondo —").padEnd(14)} ${ok ? "✓" : "✗"}`,
  );
}

console.log(`\n${rows.length - fallos}/${rows.length} cuentas entran correctamente.`);
process.exit(fallos === 0 ? 0 : 1);
