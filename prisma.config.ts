import "dotenv/config";
import { defineConfig } from "prisma/config";

// `prisma generate` (postinstall en Vercel) no se conecta a la base — solo lee
// el schema — pero la config se evalúa igual. Por eso DATABASE_URL cae a un
// placeholder si no existe: el build nunca debe depender de secretos.
// Los comandos que SÍ conectan (migrate deploy, db seed) exigen la variable real.
const url =
  process.env.DATABASE_URL?.trim() ||
  "postgres://placeholder:placeholder@localhost:5432/placeholder?sslmode=disable";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url,
    // Shadow DB: solo la usa `migrate dev` en local (servidor wasm la expone aparte).
    ...(process.env.SHADOW_DATABASE_URL
      ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
      : {}),
  },
});
