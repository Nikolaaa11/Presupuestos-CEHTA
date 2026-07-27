# SPEC F2 — Grillas de Ventas y Gastos

**Objetivo**: que un gerente cargue su presupuesto anual completo (ventas + gastos) en menos de 15 minutos sin tocar Excel. Leé `AGENTS.md` primero — las reglas de oro y las fronteras de archivos aplican a todo este spec.

## Alcance

- `src/app/(app)/ventas/` — página + grilla + server actions de líneas de venta
- `src/app/(app)/gastos/` — página + grilla + server actions de líneas de gasto
- `src/components/budget-grid/` — piezas compartidas entre ambas grillas

**Fuera de alcance** (NO construir): CAPEX (F3), enviar/aprobar presupuesto (F4), consolidado (F5), edición por parte del admin (no existe: admin es solo lectura).

## Infraestructura ya lista (consumir, no reinventar)

De `src/lib/budget.ts`:
- `resolveViewCompany(requestedCode?)` → `{ user, company, readOnly }` — manager: su empresa, editable; FUND_ADMIN: empresa de `?empresa=CODE`, solo lectura
- `getCurrentBudget(companyId)` → presupuesto vigente con `salesLines` (incl. `capexItem`), `expenseLines` (incl. `category` y `capexItem`), `capexItems`
- `ensureBudget()` → crea BORRADOR v1 si no existe (solo manager)
- `requireEditableBudget(budgetId)` → guard OBLIGATORIO al inicio de cada server action de escritura
- `canEditBudget(user, budget)`, `isEditableStatus(status)` — para decidir readOnly en UI
- Schemas Zod: `monthsPatchSchema`, `salesLineInputSchema`, `expenseLineInputSchema`, `cellAmountSchema`

De `src/lib/money.ts`: `MONTH_KEYS`, `MONTH_LABELS`, `lineTotal`, `monthlyTotals`, `formatMoney`, `formatCell`, `dec`.

De `src/lib/prisma.ts`: `prisma`. Los Decimal de Prisma se serializan a Client Components como **string** (`.toString()`) — hacé la conversión en la página server antes de pasar props.

## Server actions (crear `actions.ts` en cada módulo)

Todas devuelven `{ ok: true } | { ok: false, error: string }` y terminan con `revalidatePath("/ventas")` o `("/gastos")`.

### Ventas (`src/app/(app)/ventas/actions.ts`)
1. `startBudget()` — llama `ensureBudget()`; para el botón "Comenzar presupuesto".
2. `addSalesLine(budgetId)` — crea línea vacía (`client: "Nuevo cliente"`, `saleType: "PROYECCION_PUBLICO"`, sortOrder al final).
3. `updateSalesLineMeta(lineId, data)` — valida con `salesLineInputSchema.partial()`; verifica que la línea pertenezca a un budget editable (cargar línea → `requireEditableBudget(line.budgetId)`). Si viene `capexItemId`, verificar que el capex pertenece AL MISMO budget (integridad cross-tenant).
4. `updateSalesLineMonths(lineId, patch)` — valida con `monthsPatchSchema`; mismo guard.
5. `deleteSalesLine(lineId)` — mismo guard.
6. `bulkUpdateSalesMonths(budgetId, updates: { lineId, patch }[])` — para el pegado desde Excel; UN `requireEditableBudget`, valida cada patch, aplica en `prisma.$transaction`. Verificar que TODAS las líneas pertenezcan a ese budget.

### Gastos (`src/app/(app)/gastos/actions.ts`)
Simétrico: `addExpenseLine(budgetId)` (necesita `categoryId` default: la primera categoría por `sortOrder`), `updateExpenseLineMeta`, `updateExpenseLineMonths`, `deleteExpenseLine`, `bulkUpdateExpenseMonths`. La página pasa el catálogo `ExpenseCategory` (query `prisma.expenseCategory.findMany({ orderBy: { sortOrder: "asc" } })`).

## Páginas (server components)

`ventas/page.tsx` y `gastos/page.tsx`:
1. `const { user, company, readOnly } = await resolveViewCompany((await searchParams).empresa)`
2. `const budget = await getCurrentBudget(company.id)`
3. Sin presupuesto: manager → card "Comenzar presupuesto {AÑO}" con form action `startBudget`; admin → estado vacío informativo.
4. Con presupuesto: serializar Decimals a string y renderizar la grilla client. `editable = !readOnly && isEditableStatus(budget.status)`. Si no es editable, banner: "Presupuesto {estado} — solo lectura".
5. Header del módulo: título, `StatusBadge`, total anual grande (`formatMoney`), y para admin un `<select>` de empresa (navega con `?empresa=`).

## Grilla (client component compartido en `src/components/budget-grid/`)

Diseño tipo planilla, mejor que Excel para este caso:

- **Columnas**: fija(s) de metadata + Ene..Dic (`MONTH_LABELS`) + **Total** (calculada client-side con `lineTotal`, solo display).
- **Ventas** metadata: Cliente (input text), Tipo (select: Contrato / Proyección público / Recurrente — chips de color: `bg-ok-bg text-ok` contrato, `bg-warn-bg text-warn` proyección, `bg-lavender-bg text-brand` recurrente), Canal (text), Iniciativa (select con capexItems `isInitiative` del budget; opción "—").
- **Gastos** metadata: Categoría (select del catálogo), Ítem (text), Iniciativa (ídem ventas). Filas agrupadas visualmente por categoría con subtotal por categoría (client-side).
- **Fila de totales** al pie: suma por mes de todas las líneas (client-side para reactividad; el server recalcula igual en F4/F5).
- **Celdas de monto**: input text alineado derecha (`cell-num`), muestra `formatCell` cuando no está en foco y el valor crudo al editar. Acepta `1234567`, `1.234.567` y `1234567,5` → normalizar a string `"1234567.5"` antes de mandar al action.
- **Guardado**: optimistic update en estado local + `onBlur`/Enter dispara el action correspondiente (solo si cambió). Indicador sutil "Guardando… / Guardado ✓ / Error" en el header de la grilla. En error: revertir la celda y mostrar el mensaje del action.
- **Pegar desde Excel** (REQUISITO): `onPaste` en una celda de monto parsea TSV multi-fila/multi-columna (`\t` y `\n`), aplica desde la celda ancla hacia abajo/derecha solo sobre columnas de meses, actualiza estado local y llama `bulkUpdate*Months` con todos los patches. Ignorar celdas no numéricas.
- **Agregar línea**: botón "+ Agregar línea" al pie (action + focus en la nueva). **Eliminar**: ícono por fila con `confirm()` nativo.
- Teclado: Enter → celda de abajo; Tab nativo. (Flechas: nice-to-have, no requisito.)
- Sin librerías de grilla externas (nada de AG Grid/TanStack): tabla HTML + estado React controlado alcanza y pesa menos.

## Criterios de aceptación

1. `demo.cenergy@cehta.cl` ve sus 6 líneas de venta y 8 de gasto con totales correctos, TODO read-only (está ENVIADO) con banner.
2. `demo.rho@cehta.cl` puede: agregar línea, editar cliente/tipo/canal, editar celdas mes a mes, pegar un bloque 3×4 desde Excel, borrar línea — y todo persiste tras F5/refresh.
3. `demo.csl@cehta.cl` (sin presupuesto) ve "Comenzar presupuesto", lo crea y queda en grilla vacía editable.
4. `admin@cehta.cl` ve /ventas?empresa=CENERGY y /gastos?empresa=RHO en solo lectura, con selector de empresa; NUNCA puede mutar (los actions se lo impiden aunque fuercen el request).
5. Un manager NO puede editar líneas de otra empresa aunque conozca los IDs (guard server-side — probalo con curl si querés).
6. `npm test`, `npm run build`, `npm run lint` en verde.

## Pistas Next 16 / React 19

- `searchParams` es Promise: `async function Page({ searchParams }: { searchParams: Promise<{ empresa?: string }> })`.
- Server actions: archivo con `"use server"` arriba; importalos en el client component.
- `useTransition` o estado propio para el indicador de guardado; NO `useFormState` (deprecado — es `useActionState`, y para esto ni hace falta: llamá el action directo).
