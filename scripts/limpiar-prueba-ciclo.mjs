/**
 * Deshace los datos que dejó la prueba manual del ciclo de aprobación:
 * la celda de $1.234.567 en RHO, y el paso por el circuito de RHO y AFIS.
 * Ambos vuelven a BORRADOR: la plataforma arranca con los presupuestos
 * editables por su encargado, que es el punto de todo este cambio.
 *
 * Uso: node scripts/limpiar-prueba-ciclo.mjs [DATABASE_URL]
 */
import pg from "pg";

const url = process.argv[2] ?? "postgres://postgres:postgres@127.0.0.1:51214/presupuestos?sslmode=disable";
const c = new pg.Client({ connectionString: url });
await c.connect();

const { rowCount: celdas } = await c.query(`
  UPDATE "ExpenseLine" e SET m01 = 0
  FROM "Budget" b, "Company" co
  WHERE e."budgetId" = b.id AND b."companyId" = co.id
    AND co.code = 'RHO' AND b.year = 2026 AND e.item = 'Administrativo' AND e.m01 = 1234567`);
console.log(`celda de prueba revertida: ${celdas}`);

const { rows: probados } = await c.query(`
  SELECT b.id, co.code FROM "Budget" b JOIN "Company" co ON co.id = b."companyId"
  WHERE co.code IN ('AFIS', 'RHO') AND b.year = 2026`);
for (const b of probados) {
  await c.query(`DELETE FROM "ApprovalEvent" WHERE "budgetId" = $1`, [b.id]);
  await c.query(`UPDATE "Budget" SET status = 'BORRADOR', "approvedAt" = NULL WHERE id = $1`, [b.id]);
  console.log(`${b.code} vuelto a BORRADOR y su bitácora de prueba borrada`);
}

const { rows } = await c.query(`
  SELECT co.code, b.year, b.status FROM "Budget" b
  JOIN "Company" co ON co.id = b."companyId" ORDER BY co.code, b.year`);
console.log("\nestado final:");
for (const r of rows) console.log(`  ${r.code.padEnd(9)} ${r.year}  ${r.status}`);
await c.end();
