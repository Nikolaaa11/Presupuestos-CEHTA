-- Aprobación en dos pasos del presupuesto:
--   BORRADOR → ENVIADO → REVISADO (Victoria) → APROBADO (Guido)
-- Cualquiera de los dos puede OBSERVAR y devolverlo a edición.

ALTER TYPE "BudgetStatus" ADD VALUE IF NOT EXISTS 'REVISADO' BEFORE 'OBSERVADO';
ALTER TYPE "ApprovalAction" ADD VALUE IF NOT EXISTS 'REVISADO' BEFORE 'OBSERVADO';

-- Los presupuestos que se cargaron desde los Excel entraron como APROBADO,
-- lo que impedía a los encargados editarlos. Vuelven a BORRADOR para que
-- recorran el ciclo: el encargado los completa, Victoria revisa, Guido aprueba.
UPDATE "Budget" SET status = 'BORRADOR', "approvedAt" = NULL
WHERE status = 'APROBADO' AND "approvedAt" IS NULL;
