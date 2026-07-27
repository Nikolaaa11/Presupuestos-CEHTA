import { requireFundAdmin } from "@/lib/authz";
import { ModulePlaceholder } from "@/components/module-placeholder";

export default async function ConsolidadoPage() {
  await requireFundAdmin();
  return (
    <ModulePlaceholder
      title="Consolidado del fondo"
      description="Ventas, gastos y flujo mensual de las 9 entidades, mix contrato vs proyección, pipeline CAPEX y export Excel. En construcción — Fase 5."
    />
  );
}
