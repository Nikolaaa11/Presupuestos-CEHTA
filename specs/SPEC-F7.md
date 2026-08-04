# SPEC F7 — Gastos pagados + banners de estado positivo (zona Codex)

Fase actual. Claude ya construyó el backend completo: schema (`ExpenseLine.paid/paidAt/paidById`),
el server action y la consulta de sugerencias. A Codex le toca SOLO la interfaz, dentro de su zona
(`src/app/(app)/gastos/**`, `src/app/(app)/ventas/**`). NO tocar `prisma/**`, `src/lib/**`,
`budget-actions.ts` ni `scripts/**` — si algo de eso parece necesitar un cambio, dejá un
comentario `// PROPUESTA:` y seguí.

## Contexto funcional

El dueño del fondo pidió: "en la plataforma de gastos, colocar lo que se paga". Se decidió:
marcado MANUAL por línea + sugerencia automática NO vinculante cruzada contra Bancos.
La sugerencia jamás marca sola — siempre confirma una persona.

## API ya disponible (no modificar, solo consumir)

```ts
// src/app/(app)/budget-actions.ts
marcarGastoPagado(lineId: string, paid: boolean): Promise<{ok:true}|{ok:false;error:string}>
// Permitido incluso con presupuesto APROBADO (marcar pagos es operar, no editar cifras).

// src/lib/avisos.ts  (server-only — llamar desde la PAGE, no desde el cliente)
sugerenciasPagoGastos(budgetId: string): Promise<SugerenciaPago[]>
// SugerenciaPago = { lineId, referencia, monto, fecha }  (monto/fecha como string/ISO)
```

En la consulta de la página de gastos, las líneas ahora traen también
`paid: boolean`, `paidAt: Date | null` (agregarlos al `select` si la página usa select explícito).

## Tarea 1 — Columna "Pagado" en la grilla de Gastos

En `src/app/(app)/gastos/expense-grid.tsx` (+ lo que haga falta en `page.tsx`):

- Nueva columna de metadata **"Pagado"** (4ª, después de Iniciativa) vía `renderMetadata`,
  sumando el header en `METADATA_HEADERS`.
- Checkbox SIEMPRE habilitado (no depende de `editable` — el presupuesto puede estar
  aprobado y los pagos ocurren después). Llama `marcarGastoPagado(line.id, checked)`;
  si devuelve `ok:false`, mostrar el error como ya lo hace la grilla (o `window.alert` si
  no hay canal de error a mano) y revertir el estado visual.
- Optimista: reflejar el cambio al tiro y revertir si falla.
- Línea marcada: check verde con tooltip nativo (`title`) "Pagado el {fecha}" si hay `paidAt`.

## Tarea 2 — Chip de sugerencia

- La página llama `sugerenciasPagoGastos(budget.id)` y pasa `sugerencias` a `ExpenseGrid`
  (convertí a `Map<lineId, SugerenciaPago>` para lookup O(1)).
- En una línea NO pagada con sugerencia: chip pequeño bajo el checkbox —
  «Calza con {referencia} · ${monto formateado}» y un botón "Confirmar" que llama
  `marcarGastoPagado(line.id, true)`.
- Formato de montos SIEMPRE con `formatMoney` de `@/lib/money`. Nada de `toLocaleString`.

## Tarea 3 — Banner positivo de editable (Ventas Y Gastos)

Hoy solo existe `ReadOnlyBanner` (cuando NO se puede editar). Falta el espejo:

- En `ventas/page.tsx` y `gastos/page.tsx`, cuando `editable === true`, mostrar un banner:
  `bg-ok-bg` con texto `text-ok`, borde `border-ok/30`:
  **"Presupuesto editable — podés modificar las cifras y enviarlo al fondo desde el Dashboard."**
- Mismo estilo de contenedor que ReadOnlyBanner (rounded-lg, px-4 py-3, text-sm font-medium).
- Podés extraer un componente compartido si queda más limpio (componente NUEVO en
  `src/components/` está dentro de tu zona).

## Reglas (las de siempre, AGENTS.md)

- Montos como string; formateo con `formatMoney`/`formatCell`; celdas con `cell-num`.
- Copy es-CL. Tokens de marca (nada de colores hardcodeados).
- `npm test`, `npm run build`, `npm run lint` en verde antes de terminar.
- NO commitear ni pushear: dejá el working tree; Claude revisa e integra.
