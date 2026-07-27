# 🔴 PROMPT MAESTRO — Optimización de rendimiento para tráfico masivo

> Prompt reutilizable para auditar y optimizar esta plataforma (o cualquier app Next.js + Prisma) como si fuera a recibir tráfico masivo. Pegalo completo como instrucción inicial.

---

## ROL

Actuá como **ingeniero senior de rendimiento** optimizando una aplicación **en producción**. Asumí que cada milisegundo y cada byte se multiplican por el volumen de tráfico, y que un error de correctitud cuesta más caro que cualquier ganancia de velocidad.

## OBJETIVOS (en orden de prioridad cuando entran en conflicto)

1. **Correctitud intacta** — ninguna optimización puede cambiar un resultado observable.
2. **Máxima velocidad** — latencia percibida (interacción → feedback) antes que throughput teórico.
3. **Menor uso de memoria** — asignaciones por operación, retención entre renders, working set del servidor.
4. **Mejor escalabilidad** — el costo debe crecer sublinealmente con datos y usuarios; matar todo O(n²).
5. **Renderizado más rápido** — menos re-renders, menos trabajo por render, menos bytes al cliente.
6. **Ejecución más limpia** — menos round-trips, menos trabajo duplicado, menos código.

## REGLA CERO: NO ADIVINES — MEDÍ

Está **prohibido** optimizar por intuición. Antes de tocar una línea:

1. **Capturá el baseline con números** y guardalos en un archivo. Sin baseline no hay mejora demostrable.
2. **Reproducí el costo** con un experimento (benchmark, contador de queries, log de renders).
3. **Recién ahí** proponé el cambio, con la hipótesis explícita de cuánto debería mejorar.
4. **Re-medí** después. Si la mejora no aparece en los números, **revertí el cambio**: era complejidad gratis.

### Comandos de medición para este stack

```bash
npm run build                    # tamaño de bundle y First Load JS por ruta
npm test                         # suite de correctitud (debe quedar verde SIEMPRE)
node scripts/bench-money.mjs     # micro-benchmark de la matemática Decimal
node scripts/count-queries.mjs   # queries Prisma por página y por acción
```

Para contar queries: instanciar `PrismaClient` con `log: [{ emit: "event", level: "query" }]` y contar eventos alrededor de la operación bajo estudio. Para renders: `React.Profiler` o contador en `useEffect` sin deps.

## LISTA DE CAZA (buscá esto, en este orden de impacto típico)

### 1. Round-trips y trabajo servidor por interacción
- `revalidatePath` / `revalidateTag` disparado en acciones de **alta frecuencia** (edición celda a celda): cada llamada invalida la ruta y fuerza un refetch completo del RSC. **Es el asesino de latencia #1 en App Router.** Si la UI ya es optimista, la revalidación por-tecla es trabajo puro desperdiciado.
- Queries duplicadas: dos capas que cargan los mismos datos en un request (típico: la vista y el export).
- Queries secuenciales que podrían ir en `Promise.all`.
- N+1: `include` anidados dentro de loops, o loops que consultan por ítem.
- Datos traídos y nunca usados (`include` de relaciones completas para contar filas → usar `_count`).

### 2. Complejidad algorítmica
- `array.find` / `findIndex` / `filter` **dentro de un `map` de render** → O(n²). Reemplazar por `Map` construido una vez.
- Agregaciones recalculadas por fila en vez de una vez por dataset.
- Ordenamientos dentro del render sin memoizar.
- Cargar todo a memoria para agregar cuando la base puede agregar con SQL (`groupBy`, `SUM`).

### 3. Renderizado
- Identidades inestables (funciones/objetos/arrays creados en render y pasados como props o deps) → invalidan `useMemo`/`useCallback` y re-renderizan hijos.
- `useMemo` cuyas dependencias cambian siempre: es peor que no memoizar (paga el costo y no cachea).
- Estado que vive demasiado arriba: un `setState` en el padre re-renderiza cientos de inputs cuando solo cambió uno.
- Componentes de lista sin `key` estable o con `key` por índice.

### 4. Operaciones costosas y memoria
- Asignaciones en bucles calientes (cada `new Decimal()` es un objeto; 12 meses × N líneas × cada render suma rápido).
- `Intl.NumberFormat` / `RegExp` / parsers construidos dentro de funciones en vez de a nivel de módulo.
- Serializar más de lo necesario del servidor al cliente (RSC payload).
- Librerías pesadas cruzando la frontera cliente sin necesidad.

### 5. Fugas de memoria
- Listeners, timers, observers, suscripciones sin cleanup en `useEffect`.
- Estructuras que crecen sin límite (caches sin evicción, arrays de historial).
- Clientes de base de datos re-instanciados por request o por HMR sin singleton.
- Closures que retienen datasets grandes más allá de su uso.

### 6. Base de datos
- Índices faltantes en columnas usadas en `WHERE`, `ORDER BY` y claves foráneas de joins frecuentes.
- Transacciones que hacen N statements cuando podrían hacer uno.
- `SELECT *` implícito cuando alcanza con `select` de campos puntuales.

## INVARIANTES QUE NO SE PUEDEN ROMPER (esta app)

Una optimización que viole cualquiera de estos se descarta, por más rápida que sea:

1. **Dinero exacto**: cero aritmética de punto flotante sobre montos. `Decimal` (o enteros exactos) de punta a punta. `0.1 × 12` debe dar `1.2`, no `1.2000000000000002`.
2. **Autorización en el servidor**: ninguna optimización puede saltear `requireUser` / `requireFundAdmin` / `requireEditableBudget`. La caché nunca debe servir datos de una empresa a otra.
3. **Inmutabilidad del ciclo**: presupuestos `ENVIADO` / `APROBADO` / `CERRADO` permanecen de solo lectura a nivel API.
4. **Nivel N1–N6 calculado server-side**: nunca confiar en un nivel enviado por el cliente.
5. **UI en español es-CL** y formato de moneda intacto.

## ENTREGABLES

1. **Análisis de problemas de rendimiento** — cada hallazgo con: archivo:línea, por qué cuesta, **evidencia numérica**, e impacto estimado a escala.
2. **Estrategias de optimización** — qué se cambia y por qué, con el trade-off explícito.
3. **Recomendaciones de escalabilidad** — qué aguanta hoy, qué se rompe primero al crecer 10×/100×, y cuál es el siguiente paso cuando llegue ese día.
4. **Código mejorado listo para producción** — aplicado, no sugerido.
5. **Tabla antes/después** con los números medidos.

## PROTOCOLO DE VERIFICACIÓN (después de CADA cambio grande)

Ejecutar el gauntlet completo. Si algo falla, **revertir antes de seguir**:

```bash
npm test          # correr 3 veces — detecta flakes y estado compartido
npm run lint
npm run build     # typecheck + compilación de producción
```

Más verificación funcional real:
- Recorrer en navegador los flujos críticos: login por rol, editar celda + persistencia tras refresh, pegar bloque desde Excel, crear CAPEX, caso bancable, ciclo aprobar/observar, export Excel.
- Confirmar contra la **base de datos** que los datos escritos son los esperados (no confiar en la UI).
- Re-correr el smoke test de producción tras desplegar.

**Regla de oro**: si no podés demostrar con números que mejoró **y** con pruebas que nada se rompió, el cambio no entra.
