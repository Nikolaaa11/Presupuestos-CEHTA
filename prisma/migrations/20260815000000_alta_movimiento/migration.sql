-- Alta manual de movimientos en Bancos.
-- Todo idempotente: db-deploy.mjs corre esto dentro de una transacción y puede
-- reintentarse sobre una base que ya lo tiene.

-- 1) La bitácora necesita poder decir "agregó un movimiento" sin disfrazarlo
--    de edición.
--    ADD VALUE dentro de la transacción que abre db-deploy.mjs es válido desde
--    PostgreSQL 12 SIEMPRE que el valor nuevo no se USE en la misma transacción.
--    Acá solo se declara; el primer uso ocurre en otra sesión. Prod y local son 17.
ALTER TYPE "BankAction" ADD VALUE IF NOT EXISTS 'MOVIMIENTO_AGREGADO';

-- 2) Planilla de cargas manuales, marcada por columna y no por su nombre.
ALTER TABLE "BankSheet" ADD COLUMN IF NOT EXISTS "manual" BOOLEAN NOT NULL DEFAULT false;

-- 3) El nombre reservado tiene que quedar libre ANTES de que exista la planilla
--    manual. Una planilla importada que ya se llame así (la validación de
--    upload/route.ts solo frena subidas futuras) chocaría contra el índice
--    único del paso 4 y dejaría el alta rota para siempre en esa empresa.
UPDATE "BankSheet"
   SET name = name || ' (importada)'
 WHERE name = 'Cargas manuales' AND manual = false;

-- 4) Una sola planilla por (empresa, nombre). Cierra la carrera de dos altas
--    simultáneas creando dos planillas homónimas — que además hacía fallar la
--    descarga por empresa, porque SheetJS no admite dos hojas con el mismo
--    nombre en un libro.
--
--    Los duplicados preexistentes se RENOMBRAN, no se ignoran. La versión
--    anterior de esta migración envolvía el CREATE INDEX en un
--    `EXCEPTION WHEN unique_violation` que se tragaba el fallo: el índice no se
--    creaba, la migración quedaba marcada como aplicada, ningún deploy volvía a
--    intentarlo, y schema.prisma declaraba una unicidad que la base no tenía.
--    Un índice que "a veces no está" es peor que no tenerlo: el código de arriba
--    confía en él.
WITH d AS (
  SELECT id,
         name || ' (' || (ROW_NUMBER() OVER (PARTITION BY "companyId", name
                                             ORDER BY "createdAt", id) - 1)::text || ')' AS nuevo,
         ROW_NUMBER() OVER (PARTITION BY "companyId", name ORDER BY "createdAt", id) AS n
    FROM "BankSheet"
)
UPDATE "BankSheet" s SET name = d.nuevo FROM d WHERE s.id = d.id AND d.n > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "BankSheet_companyId_name_key"
  ON "BankSheet" ("companyId", "name");

-- 5) Autor de la carga manual: sin este dato no hay con qué comparar para el
--    guard de cuatro ojos (quien origina un pago no lo libera).
ALTER TABLE "BankMovement" ADD COLUMN IF NOT EXISTS "createdById" TEXT;

DO $$
BEGIN
  ALTER TABLE "BankMovement"
    ADD CONSTRAINT "BankMovement_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "BankMovement_createdById_idx" ON "BankMovement" ("createdById");

-- 6) La bitácora deja de borrarse a sí misma.
--    BankEvent.movementId y .batchId eran ON DELETE CASCADE: `deshacerLiberacion`
--    escribía LIBERACION_DESHECHA con el batchId y en la línea siguiente borraba
--    el lote, y la cascada se llevaba ese evento y todos los LIBERADO del lote.
--    Una bitácora append-only no puede depender de que el objeto siga vivo.
ALTER TABLE "BankEvent" DROP CONSTRAINT IF EXISTS "BankEvent_movementId_fkey";
ALTER TABLE "BankEvent"
  ADD CONSTRAINT "BankEvent_movementId_fkey"
  FOREIGN KEY ("movementId") REFERENCES "BankMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BankEvent" DROP CONSTRAINT IF EXISTS "BankEvent_batchId_fkey";
ALTER TABLE "BankEvent"
  ADD CONSTRAINT "BankEvent_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "TransferBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 7) Cinturón: si algo de lo anterior no quedó, que el deploy se caiga acá y no
--    que la base y el schema queden divergiendo en silencio.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE tablename = 'BankSheet'
                    AND indexname = 'BankSheet_companyId_name_key') THEN
    RAISE EXCEPTION 'Falta el índice único BankSheet(companyId,name): la migración no puede darse por aplicada';
  END IF;
END $$;
