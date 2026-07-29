/**
 * Aplica las migraciones pendientes contra DATABASE_URL durante el build de Vercel.
 *
 * Por qué no `prisma migrate deploy`: la base de producción se levantó aplicando
 * los .sql con el driver pg (`db-apply.mjs`), así que el registro vive en
 * `_local_applied_migrations` y no en `_prisma_migrations`. `migrate deploy`
 * intentaría re-aplicar la migración inicial sobre una base con datos reales.
 * Este script considera aplicada una migración que figure en CUALQUIERA de las
 * dos tablas, de modo que funciona venga de donde venga la base.
 *
 * Concurrencia: los builds de preview y de producción pueden correr a la vez
 * contra la misma base. Un advisory lock los serializa; el segundo espera y
 * luego no encuentra nada pendiente.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "prisma", "migrations");

const url = process.env.DATABASE_URL;
if (!url || url.includes("127.0.0.1") || url.startsWith("postgres://placeholder")) {
  console.log("db-deploy: sin DATABASE_URL remota — se omite (build local o preview sin base).");
  process.exit(0);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

/**
 * Nombres ya aplicados, mirando los dos registros posibles. Deja constancia en
 * el log de cuál encontró: si un día el build falla por querer re-aplicar la
 * migración inicial, esta línea dice exactamente por qué.
 */
async function aplicadas() {
  const nombres = new Set();
  const consultas = [
    ["_local_applied_migrations", "SELECT name FROM _local_applied_migrations"],
    ["_prisma_migrations", "SELECT migration_name AS name FROM _prisma_migrations WHERE finished_at IS NOT NULL"],
  ];
  for (const [tabla, q] of consultas) {
    try {
      const { rows } = await client.query(q);
      for (const r of rows) nombres.add(r.name);
      console.log(`db-deploy: registro ${tabla} → ${rows.length} migración(es)`);
    } catch {
      console.log(`db-deploy: registro ${tabla} → no existe en esta base`);
    }
  }
  return nombres;
}

try {
  // 1) Lock: el número es arbitrario pero fijo para este proyecto.
  await client.query("SELECT pg_advisory_lock(48217734)");

  await client.query(`
    CREATE TABLE IF NOT EXISTS _local_applied_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const yaEstan = await aplicadas();
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const pendientes = dirs.filter((d) => !yaEstan.has(d));
  if (pendientes.length === 0) {
    console.log(`db-deploy: base al día (${dirs.length} migraciones registradas).`);
  }

  for (const dir of pendientes) {
    const file = join(migrationsDir, dir, "migration.sql");
    if (!existsSync(file)) continue;
    console.log(`db-deploy: aplicando ${dir}…`);
    try {
      await client.query("BEGIN");
      await client.query(readFileSync(file, "utf8"));
      await client.query(
        "INSERT INTO _local_applied_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING",
        [dir],
      );
      await client.query("COMMIT");
      console.log(`db-deploy: ✓ ${dir}`);
    } catch (e) {
      await client.query("ROLLBACK");
      console.error(`db-deploy: ✗ ${dir} — ${e.message}`);
      throw e;
    }
  }
} finally {
  try {
    await client.query("SELECT pg_advisory_unlock(48217734)");
  } catch {
    // la conexión ya se cayó; el lock muere con la sesión
  }
  await client.end();
}
