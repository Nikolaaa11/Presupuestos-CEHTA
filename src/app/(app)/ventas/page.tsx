import { requireUser } from "@/lib/authz";
import { ModulePlaceholder } from "@/components/module-placeholder";

export default async function VentasPage() {
  await requireUser();
  return (
    <ModulePlaceholder
      title="Presupuesto de Ventas"
      description="Grilla cliente × mes con tipo de venta (contrato / proyección a público / recurrente), totales por mes y pegado desde Excel. En construcción — Fase 2."
    />
  );
}
