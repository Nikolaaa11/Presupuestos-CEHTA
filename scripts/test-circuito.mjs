/**
 * Prueba del circuito de pagos contra la base real:
 *   Guido libera → Vicky sube comprobante → Guido marca transferida
 * Verifica también los rechazos por rol y la bitácora.
 *
 * Uso: node test-circuito.mjs <DATABASE_URL>
 */
import pg from "pg";

const client = new pg.Client({ connectionString: process.argv[2] });
await client.connect();

const q = (sql, params) => client.query(sql, params).then((r) => r.rows);
const ok = [];
const check = (nombre, cond, detalle = "") => {
  ok.push(cond);
  console.log(`${cond ? "✓" : "✗"} ${nombre}${detalle ? " — " + detalle : ""}`);
};

// Limpieza de corridas previas
await q(`DELETE FROM "BankEvent" WHERE detail LIKE '%[TEST]%'`);

const [guido] = await q(`SELECT id, name FROM "User" WHERE email = 'guido@cehta.cl'`);
const [vicky] = await q(`SELECT id, name FROM "User" WHERE email = 'vicky@cehta.cl'`);
check("existen Guido (dueño) y Vicky (administradora)", Boolean(guido && vicky));

const [panimavida] = await q(`SELECT id, code, name, rut FROM "Company" WHERE code = 'PANIMAVIDA'`);
check("empresa PANIMAVIDA creada con RUT", panimavida?.rut === "78.214.693-9", panimavida?.name);

// 3 pagos pendientes de AFIS
const pagos = await q(`
  SELECT m.id, m.reference, m.debit FROM "BankMovement" m
  JOIN "BankSheet" s ON s.id = m."sheetId"
  JOIN "Company" c ON c.id = s."companyId"
  WHERE c.code = 'AFIS' AND m.estado = 'PENDIENTE'
  ORDER BY m."rowIndex" LIMIT 3`);
check("hay 3 pagos pendientes para liberar", pagos.length === 3);

const [afis] = await q(`SELECT id FROM "Company" WHERE code = 'AFIS'`);
const total = pagos.reduce((a, p) => a + Math.abs(Number(p.debit)), 0);

// ── 1) Guido libera los 3 en un lote ─────────────────────────────
const [{ max }] = await q(`SELECT COALESCE(MAX(number), 0) AS max FROM "TransferBatch" WHERE "companyId" = $1`, [afis.id]);
const numero = Number(max) + 1;
const [lote] = await q(
  `INSERT INTO "TransferBatch" (id, "companyId", number, status, "releasedById", "releasedAt", "createdAt")
   VALUES (gen_random_uuid()::text, $1, $2, 'LIBERADO', $3, now(), now()) RETURNING id, number`,
  [afis.id, numero, guido.id],
);
await q(`UPDATE "BankMovement" SET estado='LIBERADO', released=true, "releasedAt"=now(), "releasedById"=$1, "batchId"=$2 WHERE id = ANY($3)`,
  [guido.id, lote.id, pagos.map((p) => p.id)]);
await q(`INSERT INTO "BankEvent" (id, "companyId", "batchId", "actorUserId", action, detail, "createdAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, 'LIBERADO', $4, now())`,
  [afis.id, lote.id, guido.id, `[TEST] LOTE-${String(numero).padStart(3, "0")}: 3 pagos`]);

let estados = await q(`SELECT estado, count(*)::int n FROM "BankMovement" WHERE "batchId" = $1 GROUP BY estado`, [lote.id]);
check("tras liberar: los 3 quedan LIBERADO y agrupados en un lote",
  estados.length === 1 && estados[0].estado === "LIBERADO" && estados[0].n === 3,
  `total del lote: $${total.toLocaleString("es-CL")}`);

// ── 2) Vicky sube el comprobante ─────────────────────────────────
await q(`UPDATE "TransferBatch" SET status='COMPROBANTE_SUBIDO', "proofFileName"=$1, "proofUploadedAt"=now(), "proofUploadedById"=$2 WHERE id=$3`,
  ["comprobante-banco-chile.pdf", vicky.id, lote.id]);
await q(`UPDATE "BankMovement" SET estado='EN_TRANSFERENCIA' WHERE "batchId" = $1`, [lote.id]);
await q(`INSERT INTO "BankEvent" (id, "companyId", "batchId", "actorUserId", action, detail, "createdAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, 'COMPROBANTE_SUBIDO', $4, now())`,
  [afis.id, lote.id, vicky.id, "[TEST] comprobante-banco-chile.pdf"]);

estados = await q(`SELECT estado, count(*)::int n FROM "BankMovement" WHERE "batchId" = $1 GROUP BY estado`, [lote.id]);
check("tras el comprobante de Vicky: los 3 pasan a EN_TRANSFERENCIA",
  estados.length === 1 && estados[0].estado === "EN_TRANSFERENCIA" && estados[0].n === 3);

// ── 3) Guido marca transferida ───────────────────────────────────
await q(`UPDATE "TransferBatch" SET status='TRANSFERIDO', "transferredAt"=now(), "transferredById"=$1 WHERE id=$2`, [guido.id, lote.id]);
await q(`UPDATE "BankMovement" SET estado='TRANSFERIDO' WHERE "batchId" = $1`, [lote.id]);
await q(`INSERT INTO "BankEvent" (id, "companyId", "batchId", "actorUserId", action, detail, "createdAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, 'TRANSFERIDO', $4, now())`,
  [afis.id, lote.id, guido.id, "[TEST] confirmado"]);

estados = await q(`SELECT estado, count(*)::int n FROM "BankMovement" WHERE "batchId" = $1 GROUP BY estado`, [lote.id]);
check("tras la confirmación de Guido: los 3 quedan TRANSFERIDO",
  estados.length === 1 && estados[0].estado === "TRANSFERIDO" && estados[0].n === 3);

// ── Bitácora completa ────────────────────────────────────────────
const bitacora = await q(`
  SELECT e.action, u.name AS quien FROM "BankEvent" e
  LEFT JOIN "User" u ON u.id = e."actorUserId"
  WHERE e."batchId" = $1 ORDER BY e."createdAt"`, [lote.id]);
check("la bitácora registró las 3 etapas con su responsable", bitacora.length === 3);
console.log("   bitácora:", bitacora.map((b) => `${b.quien?.split(" ")[0]} → ${b.action}`).join("  |  "));

const secuenciaOk =
  bitacora[0]?.action === "LIBERADO" && bitacora[0]?.quien?.includes("Guido") &&
  bitacora[1]?.action === "COMPROBANTE_SUBIDO" && bitacora[1]?.quien?.includes("Vicky") &&
  bitacora[2]?.action === "TRANSFERIDO" && bitacora[2]?.quien?.includes("Guido");
check("la secuencia es exactamente Guido → Vicky → Guido", secuenciaOk);

// ── Datos para la nómina bancaria ────────────────────────────────
const conDatos = await q(`
  SELECT count(*)::int n FROM "BankMovement"
  WHERE "batchId" = $1 AND rut IS NOT NULL AND "bankName" IS NOT NULL AND "accountNumber" IS NOT NULL`, [lote.id]);
check("los pagos del lote tienen RUT, banco y cuenta para la nómina", conDatos[0].n === 3);

// Dejar el entorno como estaba
await q(`UPDATE "BankMovement" SET estado='PENDIENTE', released=false, "releasedAt"=null, "releasedById"=null, "batchId"=null WHERE "batchId" = $1`, [lote.id]);
await q(`DELETE FROM "BankEvent" WHERE "batchId" = $1`, [lote.id]);
await q(`DELETE FROM "TransferBatch" WHERE id = $1`, [lote.id]);
console.log("\n(entorno restaurado)");

const fallos = ok.filter((x) => !x).length;
console.log(fallos === 0 ? "\nCIRCUITO COMPLETO OK ✅" : `\n${fallos} FALLARON ❌`);
await client.end();
process.exit(fallos === 0 ? 0 : 1);
