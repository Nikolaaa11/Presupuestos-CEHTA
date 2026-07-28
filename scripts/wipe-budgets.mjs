// Borra TODOS los presupuestos (ventas, gastos, capex, eventos — en cascada),
// conservando la infraestructura: empresas, usuarios, categorías y tipos de cambio.
// Pedido del directorio 28-07-2026: la plataforma pasa de datos demo a datos reales.
// Uso: DATABASE_URL=... node scripts/wipe-budgets.mjs
import "dotenv/config";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const before = await client.query(`
  SELECT (SELECT count(*) FROM "Budget")::int AS presupuestos,
         (SELECT count(*) FROM "SalesLine")::int AS ventas,
         (SELECT count(*) FROM "ExpenseLine")::int AS gastos,
         (SELECT count(*) FROM "CapexItem")::int AS capex,
         (SELECT count(*) FROM "ApprovalEvent")::int AS eventos
`);
console.log("Antes:", JSON.stringify(before.rows[0]));

await client.query(`DELETE FROM "Budget"`); // cascada: líneas, capex, eventos

const after = await client.query(`
  SELECT (SELECT count(*) FROM "Budget")::int AS presupuestos,
         (SELECT count(*) FROM "Company")::int AS empresas,
         (SELECT count(*) FROM "User")::int AS usuarios,
         (SELECT count(*) FROM "ExpenseCategory")::int AS categorias
`);
console.log("Después:", JSON.stringify(after.rows[0]), "— empresas/usuarios/categorías intactos");
await client.end();
