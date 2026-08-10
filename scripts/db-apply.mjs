// Aplica las migraciones SQL de prisma/migrations contra DATABASE_URL usando el driver pg.
// Necesario en dev local: el schema engine de Prisma no conecta con el servidor wasm de
// `prisma dev`, pero el driver pg sí. En producción (Postgres real) usar `prisma migrate deploy`.
import "dotenv/config";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "prisma", "migrations");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL no está definida");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
// Igual que db-deploy: sin el listener, los RAISE WARNING de una migración se
// pierden y el ✓ del log miente.
client.on("notice", (n) => console.log(`db-apply: [${n.severity}] ${n.message}`));
await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS _local_applied_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`);

const applied = new Set(
  (await client.query("SELECT name FROM _local_applied_migrations")).rows.map((r) => r.name),
);

const dirs = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

let ran = 0;
for (const dir of dirs) {
  if (applied.has(dir)) continue;
  const file = join(migrationsDir, dir, "migration.sql");
  if (!existsSync(file)) continue;
  const sql = readFileSync(file, "utf8");
  console.log(`→ aplicando ${dir}...`);
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO _local_applied_migrations (name) VALUES ($1)", [dir]);
    await client.query("COMMIT");
    ran++;
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(`✗ falló ${dir}: ${e.message}`);
    await client.end();
    process.exit(1);
  }
}

console.log(ran === 0 ? "Base de datos al día — nada que aplicar." : `✓ ${ran} migración(es) aplicada(s).`);
await client.end();
