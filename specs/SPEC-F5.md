# SPEC F5 — Consolidado del fondo (UI)

**Objetivo**: el directorio ve el portafolio completo en una pantalla. Leé `AGENTS.md` primero.

## Alcance

SOLO la UI de `src/app/(app)/consolidado/` (reemplazar el placeholder). La capa de datos YA EXISTE y no se toca:

- `getFundConsolidation(year)` de `src/lib/consolidation.ts` (server-only, lanza si no es FUND_ADMIN — la página además llama `requireFundAdmin()` primero). Tipos exportados: `FundConsolidation`, `ConsolidationRow`, `CapexPipelineItem`. **Todos los montos llegan como string.**
- Export Excel YA implementado en `GET /api/export/consolidado` — solo poné un link/botón.

**Fuera de alcance**: mutaciones (no hay ninguna — página 100% lectura), gráficos con librerías externas (NADA de recharts/chart.js — barras con divs o SVG inline), tocar `src/lib/**`.

## Página `/consolidado` (server component, año 2027 fijo con `BUDGET_YEAR` de lib/budget)

Orden de secciones:

1. **Header**: título "Consolidado del fondo {año}", subtítulo con FX vigente (`UF $39.200 · USD $950` desde `c.fx`), y botón `Exportar Excel` → `<a href="/api/export/consolidado" download>` estilo botón brand.

2. **KPIs del fondo** (4 cards como las del dashboard): Ventas anuales, Gastos anuales, Flujo anual (tone ok/danger), CAPEX total CLP. Debajo, chips del **mix de venta consolidado**: `Contrato X%` (ok), `Proyección Y%` (warn), `Recurrente Z%` (lavender).

3. **Gráfico mensual** (sin librerías): 12 grupos (Ene..Dic), cada uno con 2 barras verticales — Ventas (bg-brand) y Gastos (bg-lavender) — altura proporcional al máximo del año; bajo cada grupo el mes y el flujo del mes en texto chico (rojo si negativo). Alturas calculadas con Number() SOLO para proporciones visuales (los labels usan formatCell). Contenedor con altura fija (~200px), flex items-end.

4. **Tabla por empresa**: columnas Código (+v), Estado (StatusBadge), Ventas anual, Gastos anual, Flujo anual (rojo si negativo), CAPEX CLP, Mix (mini barra horizontal apilada de 3 segmentos con title=%). Fila final TOTAL FONDO en bg-brand-dark text-white. Empresas SIN_INICIAR con texto atenuado.

5. **Matriz mensual por empresa** (colapsable con `<details>` nativo por empresa): tabla 3 filas (Ventas/Gastos/Flujo) × 12 meses + Total, `cell-num`, flujo negativo en text-danger.

6. **Pipeline CAPEX**: tabla ordenada (ya viene ordenada por mes): Mes requerido, Empresa, Inversión (+ badge iniciativa), Monto (orig + CLP si difiere), Plazo/Fuente, Nivel (`LevelBadge`), Estado (`StatusBadge`), y si `isInitiative` link "Caso bancable →" a `/capex/{id}`. Fila total al pie con suma CLP (usar `c.totals.capexClp`).

## Reglas

- Montos SIEMPRE con `formatMoney`/`formatCell` (es-CL). Nada de `toLocaleString` a mano.
- Tokens de marca; tablas con el mismo estilo de las existentes (`border-line`, thead `bg-soft`, tfoot `bg-brand-dark text-white`).
- `LevelBadge` (`@/components/level-badge`) y `StatusBadge` (`@/components/status-badge`) ya existen.
- Responsive: tablas dentro de `overflow-x-auto`.
- Al terminar: `npm test`, `npm run lint` y `npm run build` (si el build falla SOLO por Google Fonts, dejalo anotado y seguí).

## Criterios de aceptación

1. `admin@cehta.cl` ve KPIs, mix, gráfico, tabla de 9 empresas con TOTAL, matrices colapsables y pipeline CAPEX con niveles.
2. `demo.rho@cehta.cl` NO puede entrar (redirect por requireFundAdmin).
3. El botón Excel descarga el archivo.
4. Cero dependencias nuevas en package.json.
