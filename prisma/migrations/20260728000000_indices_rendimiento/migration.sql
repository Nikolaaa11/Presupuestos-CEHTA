-- Índices de rendimiento
-- Postgres NO indexa las claves foráneas automáticamente. Estas tres columnas
-- se usan en filtros reales: el caso bancable consulta líneas por iniciativa
-- (capexItemId) y la configuración cuenta líneas por categoría (categoryId),
-- que además se verifica al intentar borrar una categoría en uso.
-- IF NOT EXISTS mantiene la migración idempotente ante re-aplicaciones.

CREATE INDEX IF NOT EXISTS "SalesLine_capexItemId_idx" ON "SalesLine"("capexItemId");
CREATE INDEX IF NOT EXISTS "ExpenseLine_capexItemId_idx" ON "ExpenseLine"("capexItemId");
CREATE INDEX IF NOT EXISTS "ExpenseLine_categoryId_idx" ON "ExpenseLine"("categoryId");
