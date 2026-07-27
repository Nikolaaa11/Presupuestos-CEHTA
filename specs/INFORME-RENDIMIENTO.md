# Informe de rendimiento — Presupuestos CEHTA

Auditoría ejecutada bajo el protocolo de `PROMPT-MAESTRO-OPTIMIZACION.md`: **medir primero, optimizar después, re-medir y verificar**. Fecha: 28-07-2026.

Instrumentos creados (quedan en el repo, reejecutables):
- `scripts/bench-money.mjs` — costo real por render de la matemática de la grilla
- `scripts/count-queries.mjs` — queries y latencia por operación lógica contra la base real

---

## 1. Análisis de problemas de rendimiento

### 🔴 P1 — Recarga completa de la página en cada celda editada *(crítico)*

**Dónde:** `ventas/actions.ts` y `gastos/actions.ts` — `revalidatePath()` en `updateSalesLineMonths`, `updateSalesLineMeta`, `bulkUpdate*` y equivalentes de gastos.

**Por qué costaba:** en el App Router, `revalidatePath` no es una anotación barata: obliga al servidor a re-renderizar la ruta y re-consultar la base, y devuelve un payload RSC nuevo. La grilla ya aplicaba el cambio de forma optimista y revertía sola ante error, así que ese trabajo era **100 % descartable**.

**Evidencia medida:**

| | queries | tiempo servidor |
|---|---|---|
| Escritura real de la celda | 3 | 12,2 ms |
| Recarga que disparaba `revalidatePath` | +7 | +22,8 ms |
| **Total por celda** | **10** | **35,0 ms** |

En producción el golpe es mayor: la página completa mide **304 ms de mediana** (Chile → Vercel iad1 → base us-east-1). Cada celda confirmada pagaba ese viaje.

**Impacto a escala:** un gerente cargando un presupuesto típico (20 clientes × 12 meses = 240 celdas) generaba **2.400 queries y 8,4 s de trabajo de servidor**, más ~72 s acumulados de latencia de red.

---

### 🟠 P2 — Tres queries por carga cuyos datos nunca se leían

**Dónde:** `lib/budget.ts` → `getCurrentBudget`, con `include: { capexItem, category }` en las líneas.

**Por qué costaba:** Prisma emite **una query por relación incluida**. Las vistas nunca usaban esos objetos: `ventas/page.tsx` y `gastos/page.tsx` leen `capexItemId` (el escalar) y resuelven el nombre de categoría contra el catálogo, que ya viaja por separado.

**Evidencia:** 7 queries por carga, de las cuales 3 eran puro peso muerto. Además inflaban el payload RSC con objetos descartados.

---

### 🟠 P3 — El export Excel leía todo el fondo dos veces

**Dónde:** `api/export/consolidado/route.ts`.

**Por qué costaba:** llamaba a `getFundConsolidation()` (que carga las líneas de las 9 entidades) y **después** repetía un `company.findMany` con los mismos includes para el detalle por hoja.

**Evidencia:** 11 queries por descarga, con el dataset completo viajando dos veces por memoria.

---

### 🟡 P4 — O(n²) en el render de la grilla

**Dónde:** `sales-grid.tsx` / `expense-grid.tsx` — `data-meta-row={lines.findIndex(item => item.id === line.id)}` ejecutado **dentro del map de filas**.

**Evidencia:** 0,010 ms con 50 filas → 0,257 ms con 300 (×25 al sextuplicar los datos: crecimiento cuadrático confirmado). En absoluto es chico, pero es el patrón que revienta cuando el dataset crece, y el índice ya estaba disponible gratis en el `map`.

---

### 🟡 P5 — Agregados recalculados en cada render

**Dónde:** `amount-grid.tsx` — `categoryTotals(key)` hacía `filter` + suma completa por **cada fila de subtotal, en cada render**, sin memoizar. Y `groupKey`/`groupLabel`/`renderMetadata` se recreaban en cada render, invalidando el `useMemo` del ordenamiento (pagaba el costo de memoizar sin obtener el beneficio).

---

### 🟡 P6 — Un cambio de celda re-renderizaba toda la tabla

**Dónde:** `amount-grid.tsx` — `setLines` re-renderizaba las N filas × 12 inputs controlados, aunque solo una celda hubiera cambiado.

---

### 🟢 P7 — Índices ausentes en claves foráneas

**Dónde:** `SalesLine.capexItemId`, `ExpenseLine.capexItemId`, `ExpenseLine.categoryId`.

Postgres **no** indexa las FK automáticamente. El caso bancable consulta líneas por iniciativa y la configuración cuenta líneas por categoría: ambas hacían scan secuencial. Con los volúmenes de hoy es irrelevante; a 10.000 líneas no lo sería.

---

### ✅ Fugas de memoria: ninguna encontrada

Barrido de `addEventListener`, `setInterval`, `setTimeout`, observers y suscripciones: **cero coincidencias sin cleanup**. El cliente Prisma usa singleton con guarda de HMR. No hay caches sin evicción ni closures reteniendo datasets.

---

### ❌ Hipótesis descartadas por medición

Vale registrar lo que **no** era el problema, porque la intuición decía lo contrario:

- **La aritmética Decimal no es el cuello de botella.** Todo el cálculo de una grilla de 50 filas cuesta 0,67 ms por render; con 300 filas, 3,9 ms. Imperceptible.
- **decimal.js pesa 33,3 KB en el bundle cliente.** Se evaluó reemplazarlo por BigInt (exacto y nativo, ahorraría esos 33 KB). **Se decidió NO hacerlo**: el beneficio de CPU es nulo según lo medido, el chunk se cachea tras la primera carga, y mantener dos implementaciones de dinero pone en riesgo el invariante más importante del sistema. Optimización rechazada por costo/beneficio, no por olvido.

---

## 2. Estrategias de optimización aplicadas

| # | Cambio | Trade-off asumido |
|---|---|---|
| P1 | `revalidatePath` solo en cambios estructurales (crear presupuesto, agregar/eliminar línea) | El total anual pasó del header servidor a la grilla cliente para no quedar desactualizado. Las rutas son dinámicas con `staleTimes` apagado ⇒ al navegar se recarga fresco igual |
| P2 | Includes muertos eliminados de `getCurrentBudget` | Ninguno: los datos no se usaban |
| P3 | `getFundExportData()` — una lectura compartida por vista y export; categorías por catálogo | Una función más en la capa de datos a cambio de la mitad de queries |
| P4 | El índice de fila viaja como prop | Ninguno |
| P5 | Subtotales en una pasada memoizada; identidades estables con `useCallback` | Ninguno |
| P6 | Filas memoizadas con callbacks estables; el valor previo para el rollback lo aporta la fila | Más disciplina en las props: cualquier callback nuevo debe ser estable o rompe la memoización |
| P7 | Tres índices, migración idempotente | Escrituras marginalmente más caras a cambio de lecturas que escalan |

---

## 3. Resultados medidos (mismo entorno, antes → después)

| Operación | Antes | Después | Mejora |
|---|---|---|---|
| Carga de `/ventas` | 7 queries · 22,8 ms | **4 queries · 14,6 ms** | −43 % queries, −36 % tiempo |
| **Editar una celda** | 10 queries · 35,0 ms | **3 queries · 11,3 ms** | **−70 % queries, −68 % tiempo** |
| Export Excel | 11 queries · 24,9 ms | **6 queries · 19,3 ms** | −45 % queries |
| **Cargar un presupuesto (240 celdas)** | 2.400 queries · 8,4 s | **720 queries · 2,7 s** | **−70 %** |
| Round-trips de red por celda (producción) | 1 × ~300 ms | **0** | eliminado |
| Filas re-renderizadas por celda editada | N (todas) | **1** | −(N−1) |

---

## 4. Recomendaciones de escalabilidad

**Qué aguanta hoy sin tocar nada:** las 9 entidades con presupuestos de cientos de líneas y decenas de usuarios concurrentes. Con los números actuales sobra margen — la app está lejos de cualquier límite.

**Qué se rompe primero al crecer, en orden:**

1. **El consolidado a ~50+ entidades o ~10.000 líneas.** Hoy `loadFundBudgets` trae todas las líneas a memoria y agrega en Node. Es lo correcto a esta escala (permite reutilizar la misma lectura para el export). Cuando duela, la salida es agregar en SQL: `SUM(m01)…SUM(m12) GROUP BY companyId` devuelve 9 filas en vez de miles. **Señal para actuar:** el consolidado supera ~500 ms.
2. **El pool de conexiones en serverless.** Cada instancia Lambda abre su pool; con muchas concurrentes se agota el límite de Postgres. **Salida:** connection pooling (PgBouncer / Prisma Accelerate). **Señal:** errores de "too many connections".
3. **El pegado masivo.** `bulkUpdate` emite N `UPDATE` en una transacción; a 600+ celdas se nota. **Salida:** un único `UPDATE ... FROM (VALUES ...)`. **Señal:** pegar un bloque grande tarda más de 1 s.
4. **Grillas de más de ~500 filas.** El DOM con 500 × 12 inputs pesa. **Salida:** virtualización de filas. **Señal:** el scroll deja de ir fluido.

**Deuda deliberada, documentada:** decimal.js en el cliente (33 KB) y la agregación en memoria del consolidado. Ambas son decisiones conscientes a favor de la correctitud y la simplicidad, con el disparador de revisión escrito arriba.

---

## 5. Verificación ejecutada

- `npm test` — **23/23 en 3 corridas consecutivas** (detecta flakes y estado compartido)
- `npm run lint` — sin errores ni warnings
- `npm run build` — typecheck y compilación limpios
- **Navegador, contra la base real:**
  - Editar celda → total anual vivo pasa de $561.500.000 a $562.880.000 (exactamente +1.380.000) y la base guarda `8880000.00`
  - **Red: un `POST` de la acción y ningún `GET ?_rsc=` posterior** — la recarga por celda efectivamente desapareció
  - Pegado de bloque 2×3 desde Excel → aterriza exacto en las filas y meses correctos
  - Índices confirmados en la base (`SalesLine_capexItemId_idx`, `ExpenseLine_capexItemId_idx`, `ExpenseLine_categoryId_idx`)
- **Producción:** migración de índices aplicada y smoke test completo tras el despliegue

Ningún invariante fue tocado: dinero en `Decimal` de punta a punta, autorización server-side intacta en cada acción, inmutabilidad del ciclo de aprobación sin cambios.
