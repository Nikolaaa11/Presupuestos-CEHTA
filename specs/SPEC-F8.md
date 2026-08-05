# SPEC F8 — Botón "Importar Excel" en Ventas y Gastos (zona Codex)

Fase 2 de importación. Claude ya construyó TODO el backend y el componente:
- `/api/presupuesto/plantilla?modulo=ventas|gastos|capex` (GET, descarga la plantilla)
- `/api/presupuesto/upload` (POST, importa con upsert — solo gerencia con presupuesto editable)
- `src/components/budget-grid/importar-excel.tsx` — componente cliente COMPLETO
  (botón, form, resultado con rechazos por fila). NO modificarlo.
- Referencia de integración ya hecha: `src/app/(app)/capex/page.tsx` (líneas ~125-129).

A Codex le toca SOLO montar el componente en sus dos páginas.

## Tarea única

En `src/app/(app)/ventas/page.tsx` y `src/app/(app)/gastos/page.tsx`:

1. Importar: `import { ImportarExcel } from "@/components/budget-grid/importar-excel";`
2. Cuando `editable === true`, renderizar `<ImportarExcel modulo="ventas" year={year} />`
   (o `modulo="gastos"`), alineado a la derecha, entre el banner de estado y la grilla —
   mismo patrón que capex/page.tsx:

```tsx
{editable && (
  <div className="flex justify-end">
    <ImportarExcel modulo="ventas" year={year} />
  </div>
)}
```

`year` ya existe en ambas páginas (viene de `resolveYear`). Nada más: el componente
maneja plantilla, subida, errores y refresh solo.

## Reglas

- NO tocar `importar-excel.tsx`, `src/lib/**`, `src/app/api/**` ni capex.
- `npx tsc --noEmit` y `npm run lint` en verde. NO commitear.
