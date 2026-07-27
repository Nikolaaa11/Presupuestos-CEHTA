import { requireFundAdmin } from "@/lib/authz";
import { ModulePlaceholder } from "@/components/module-placeholder";

export default async function ConfiguracionPage() {
  await requireFundAdmin();
  return (
    <ModulePlaceholder
      title="Configuración"
      description="Tipos de cambio (UF/USD), catálogo de categorías de gasto, umbrales de la matriz N1–N6 y gestión de usuarios. En construcción — Fase 5."
    />
  );
}
