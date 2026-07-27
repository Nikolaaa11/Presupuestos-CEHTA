import { requireUser } from "@/lib/authz";
import { ModulePlaceholder } from "@/components/module-placeholder";

export default async function CapexPage() {
  await requireUser();
  return (
    <ModulePlaceholder
      title="CAPEX del año"
      description="Inversiones con monto, mes requerido, plazo y fuente de financiamiento. Nivel de aprobación N1–N6 automático y caso bancable por iniciativa. En construcción — Fase 3."
    />
  );
}
