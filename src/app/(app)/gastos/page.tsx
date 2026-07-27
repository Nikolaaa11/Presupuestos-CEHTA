import { requireUser } from "@/lib/authz";
import { ModulePlaceholder } from "@/components/module-placeholder";

export default async function GastosPage() {
  await requireUser();
  return (
    <ModulePlaceholder
      title="Presupuesto de Gastos"
      description="Grilla ítem × mes por categoría (personal, fijos, variables), subtotales y vínculo a iniciativas CAPEX. En construcción — Fase 2."
    />
  );
}
