# HANDOFF — Presupuestos CEHTA

> Actualizado: 2026-08-14. Para quien continúe el trabajo: una persona nueva,
> Guido/Vicky operando, o una sesión nueva de Claude/Codex. Complementa
> `README.md` (qué hace la app) y `AGENTS.md` (reglas para agentes) — acá está
> lo que no se deduce del código: estado, decisiones, operación y pendientes.

## 1. Estado en una línea

**En producción, con datos reales, verificada de punta a punta.**
https://presupuestos-cehta-nicolasrietta-1798s-projects.vercel.app
(deploy automático al pushear a `main` de `Nikolaaa11/Presupuestos-CEHTA`).

Datos reales cargados: 982+ movimientos bancarios (RHO, AFIS, CENERGY,
Panimávida), 93 órdenes de compra con avance de pago, presupuestos RHO
2025/2026 (ventas+gastos+114 ítems CAPEX con proyectado vs real), gastos AFIS
2026. Base Prisma Postgres **reclamada** (ya no vence).

## 2. Los dos circuitos (el corazón del diseño)

Todo lo importante de la plataforma es separación de funciones:

```
Presupuesto: BORRADOR ─envía→ ENVIADO ─revisa→ REVISADO ─aprueba→ APROBADO
              (encargado)     (Vicky)           (Guido)
Pagos:       PENDIENTE ─libera→ LIBERADO ─comprobante→ EN_TRANSFERENCIA ─confirma→ TRANSFERIDO
                        (Guido)           (Vicky)                        (Guido)
```

- Guido NO revisa presupuestos (si revisara firmaría los dos pasos); **quien
  revisó no puede aprobar** — guard de cuatro ojos en `reviewBudget`, chequea
  el último `ApprovalEvent REVISADO` incluso para `FUND_ADMIN`.
- OBSERVAR (con comentario obligatorio) devuelve a edición en cualquier etapa.
- Liberar N pagos crea un `TransferBatch` correlativo del que sale la
  **nómina bancaria Excel** (`/api/bancos/nomina?lote=`).
- Bitácoras append-only: `ApprovalEvent` (presupuesto) y `BankEvent` (pagos).

## 3. Usuarios (13, todos verificados en producción)

| Cuenta | Rol | Clave |
|---|---|---|
| `guido@cehta.cl` | DUENO — aprueba, libera, confirma | `Cehta2026!` |
| `vicky@cehta.cl` | ADMINISTRADORA — revisa, sube comprobantes | `Cehta2026!` |
| `admin@cehta.cl` | FUND_ADMIN — consolida, configura, destraba | `Cehta2026!` |
| `demo.<código>@cehta.cl` ×10 | COMPANY_MANAGER de cada entidad | `Demo2026!` |

⚠️ Claves de puesta en marcha: **cambiarlas antes de repartir accesos reales**
(hoy se cambian por SQL o seed; no hay UI de cambio de clave — ver pendientes).

## 4. Decisiones que no son obvias desde el código

1. **Dinero**: montos como string + `decimal.js` (`src/lib/money.ts`). Jamás
   float. Agregados server-side. La única excepción histórica (total de lotes)
   se corrigió.
2. **Semántica de las OCs (costó un hallazgo crítico)**: cada orden de compra
   vive en DOS fuentes con la misma referencia — la planilla de registro
   ("Órdenes de compra RHO/Panimávida": fila pagada = TOTAL de la orden; fila
   PENDIENTE = SALDO por pagar, ej. OC0017 = contrato en cuotas) y las
   cartolas (pagos efectivos). Sumarlas cuenta doble. La lógica correcta está
   en `agruparAvancesOC` (`src/lib/avisos-core.ts`) con tests de los casos
   reales OC0005/OC0017/OC0092.
3. **Los pendientes del registro de OCs no traen fecha** → los avisos de
   vencimiento no pueden dispararse solos; el panel resume "N OCs sin fecha
   por $X" y al ponerles fecha (Editar en Bancos) el aviso se activa.
4. **Importación Excel: la plantilla manda.** Nombres de columna tolerantes,
   presencia estricta (archivos parciales pisaban datos: Ene–Jun zeroaba
   jul–dic, capex sin Moneda convertía UF→CLP y rompía el nivel N1–N6).
   Celdas opcionales vacías NO pisan en updates. Filas "EJEMPLO" se rechazan.
   Upsert nunca borra; `r01-r12`, `paid` y vínculos quedan intactos.
5. **Zip bomb**: toda subida pasa por `revisarZip` (`src/lib/zip-safety.ts`)
   ANTES de SheetJS — un .xlsx de 9,5 MB puede declarar 2.800 MB
   descomprimidos y `sheetRows` no protege el XML.
6. **Marcar pagado es operativo, editar es planificar**: tildar gastos
   pagados / etapas pagadas se permite con presupuesto APROBADO (los pagos
   ocurren después de aprobar); editar cifras/etapas exige BORRADOR/OBSERVADO.
7. **Acciones de celda no revalidan** (UI optimista): `revalidatePath` en cada
   tecla causaba recarga completa. Solo los actions estructurales revalidan.
   Las filas de `amount-grid.tsx` están memoizadas: todo callback que baje a
   la fila DEBE ser estable.
8. **Sin middleware.ts**: Next 16 acá protege en layouts y server actions.
   `params`/`searchParams` son Promises.

### 4-bis. Abonos y nómina Santander (2026-08-14)

- **Pantalla inicial de Bancos = "Abonos por referencia"**: cada factura u
  orden con Total / Abonado / Diferencia (Decimal, server-side) y el detalle
  de cada abono (fecha, descripción, monto, datos bancarios, estado).
  Solo agrupan las referencias con NÚMERO — "Remuneración" ×80 armaba un
  falso grupo de $200M que encabezaba la pantalla.
- **La nómina del lote es el formato oficial del Santander** (13 columnas
  A–M, verificadas contra los archivos reales X24/X25 del fondo), con la
  cuenta origen configurable por empresa en `/configuracion`, código SBIF del
  banco destino, RUT sin puntos y K/L como fórmula `=I`. Más una hoja
  **Control de abonos** donde la Diferencia es fórmula `=B-C-D`: se descuenta
  sola al editar.
- **Nunca inventar un código de banco ni un RUT**: `codigoBanco` devuelve null
  si no reconoce (celda vacía + aviso en el Resumen) y `rutParaBanco` valida
  el dígito verificador. Un código válido pero equivocado manda la plata al
  banco que no es; una celda vacía solo obliga a completarla a mano.
- **No todo lo PENDIENTE es liberable** (`motivoNoLiberable`): un abono
  recibido pondría en la nómina una orden de transferir hacia afuera la plata
  que nos pagaron; una fila del registro de OC pagaría el saldo entero de la
  orden duplicando las cuotas.
- **Sobrepago**: si las cartolas superan el total que declara el registro
  (típico duplicado por re-importación), no se estira el total — se marca
  "pagado de más" para que alguien lo revise.

### 4-ter. Monto · Abono · Monto total (2026-08-15)

Las dos tablas de Bancos muestran las tres columnas con la resta al lado y la
suma abajo:

- **Detalle de cada referencia**: primera fila «Total del documento», después
  cada abono descontando, y el pie con Total / Abonado / Diferencia. El saldo
  fila a fila NO se calcula en la UI: viene de `conSaldoCorriente`
  (`avisos-core.ts`), donde vive la semántica dual de las OCs. Solo descuenta
  la fuente que manda en `avanzado` (`max(cartola, registro)`, no la suma) —
  descontar las dos restaría la misma plata dos veces. **Invariante testeado**:
  el saldo de la última fila === `pendiente` del grupo. Con sobrepago termina
  negativo a propósito: la fila donde cruza a cero es la duplicada.
- **Tabla de movimientos**: el corrido SÍ se calcula en el cliente (con
  Decimal), porque depende del filtro puesto — el pie tiene que cerrar con lo
  que se ve, no con filas ocultas.
- **Cada columna muestra su propio valor.** Las filas del registro de OCs traen
  débito Y crédito a la vez (saldo por pagar + lo ya abonado). El código viejo
  elegía uno (`esAbono ? credit : debit`) y escondía el otro; con una sola
  columna era invisible, con tres y un total la columna dejaba de sumar. Un
  total visible obliga a la columna a ser honesta.
- Los montos con centavos (7 de 1.098) hacen que la columna sumada a ojo pueda
  diferir en $1 del pie: el pie suma los Decimal exactos y redondea una sola
  vez. Es lo correcto — jamás redondear a mitad de cálculo.

### 4-quater. Alta manual de movimientos (2026-08-15)

Antes Bancos solo sabía importar un Excel, editar una fila y borrar la planilla.
Ahora hay **«+ Agregar movimiento»**: una factura suelta, un pago que todavía no
aparece en el banco, un abono que entró. Nace `PENDIENTE` y entra al circuito
como cualquier otro.

- **La planilla manual se identifica por COLUMNA (`BankSheet.manual`), no por su
  nombre.** En este módulo el nombre no es una llave: la subida reemplaza
  planillas con `deleteMany({ name })` y `esPlanillaRegistroOC` clasifica por
  nombre. Un Excel con una hoja llamada «Cargas manuales» se llevaba en cascada
  todo lo cargado a mano —lo único que no se puede reimportar— devolviendo
  `{ok:true}`. Ahora la subida la rechaza con 422 y el `deleteMany` filtra por
  `manual: false`.
- **Id determinístico `manual_<companyId>`** + `@@unique([companyId, name])`: dos
  altas simultáneas no pueden crear dos planillas homónimas, que además hacían
  fallar la descarga por empresa (un libro Excel no admite dos hojas iguales).
- **Cuatro ojos sobre lo cargado a mano**: `liberarPagos` rechaza los
  movimientos cuyo `createdById` es quien libera, **sin exención para
  FUND_ADMIN** — mismo criterio que revisar/aprobar el presupuesto. Por eso
  existe `BankMovement.createdById`.
- **`parsearMonto` reemplaza a `normalizarMonto`** (`src/lib/tesoreria-core.ts`).
  El viejo no fallaba: adivinaba mal en silencio. Verificado ejecutándolo:
  `"1,234.56"` → 1,23 (÷1000), `"250000000.555"` → 250.000.000.555 (×1000),
  `"-350.000"` → 350.000 sin signo, y `"abc"`/`"(1.500)"`/`"5%"` → 0. El nuevo o
  entiende o dice por qué no, y la validación va **dentro del Zod** para salir
  por la rama `ZodError` — si no, `failure()` lo convierte en «No fue posible
  completar la operación» y el motivo no llega nunca.
- **La bitácora dejó de borrarse a sí misma.** `BankEvent.movementId/batchId`
  eran `ON DELETE CASCADE`: `deshacerLiberacion` escribía el evento y en la
  línea siguiente borraba el lote, y la cascada se llevaba ese evento y todos
  los `LIBERADO` del lote. Ahora son `SetNull` y cada `detail` se escribe
  autosuficiente (referencia + monto exacto + fecha) para seguir siendo legible
  sin la fila.
- **El movimiento se ve al guardarlo**: la tabla muestra UNA planilla por vez y
  el alta va a otra, así que el action devuelve `sheetId` y la UI navega. Sin
  eso el usuario guardaba, no veía nada y lo cargaba de nuevo — el duplicado lo
  generaba la propia navegación.
- **Duplicado**: se compara por empresa + referencia normalizada + monto, **sin
  exigir la misma fecha** (el pago que llega después por cartola trae otra).
  Nunca bloquea: muestra los existentes con planilla, fecha y estado, y pide un
  segundo clic.
- **Un abono recibido no se libera** y ya no rompe el lote: `seleccionables`
  los excluye, porque `liberarPagos` aborta el lote entero al toparse con el
  primero y un solo abono impedía liberar los 20 pagos legítimos.
- **Fuera de alcance, documentado**: el abono manual NO descuenta en «Abonos por
  referencia» (esa pantalla se arma solo con `debit`); no se pueden cargar
  movimientos ya pagados; no hay borrado individual de movimientos.

## 5. Operación

```bash
npm run dev        # requiere npm run db:dev en otra terminal (puerto 51214)
npm run db:apply   # migraciones en dev (migrate dev NO funciona contra el wasm local)
npm test           # 145 tests — DEBE quedar verde
npm run build      # corre scripts/db-deploy.mjs y despues next build
```

- **Migraciones en producción: solas.** El build de Vercel ejecuta
  `scripts/db-deploy.mjs` (advisory lock; reconoce `_prisma_migrations` de
  prod Y `_local_applied_migrations` de dev — sin eso reintentaría la
  migración inicial sobre datos reales). Escribir el SQL idempotente
  (`IF NOT EXISTS`, `DO $$ ... EXCEPTION`).
- **DATABASE_URL de producción** está como variable sensible en Vercel (no se
  puede leer; `vercel env rm/add` para cambiarla — la API dio 403).
- **Tras `prisma generate`**: reiniciar el dev server (caché de Turbopack).
- **Si hay un worktree de Claude en `.claude/worktrees/`**, vive DENTRO del repo
  y tanto vitest como eslint lo escanean: los conteos se duplican y aparecen
  cientos de errores que no son de tu árbol. Correr
  `npx vitest run --exclude "**/.claude/**"` y `npx eslint src scripts`.
- La base local (`prisma dev`) se cae entre sesiones: relanzar y esperar el
  puerto 51214.

## 6. Verificación (el hábito del proyecto)

Nada se declara terminado sin verificarlo contra el server real:

| Script (`scripts/`) | Qué verifica |
|---|---|
| `verify-ciclo-prod.mjs` | Aprobación a dos manos en producción (9 checks) |
| `verify-guia-prod.mjs` | Guía por rol: cada uno ve lo suyo (16 checks) |
| `verify-avisos-prod.mjs` | Avisos, avance OC sin doble conteo, etapas (14) |
| `verify-import-prod.mjs` | Plantillas, botón, EJEMPLO, guard de rol (6) — no muta datos |
| `verify-abonos-prod.mjs` | Abonos por referencia y cuenta origen (5) — no muta datos |
| `test-alta-movimiento.mjs` | E2E local del alta manual (8 checks, limpia tras sí) |
| `test-nomina-santander.mjs` | E2E local de la nómina Santander (12 checks, limpia tras sí) |
| `test-import-presupuesto.mjs` | E2E local de importación (19 checks, limpia tras sí) |
| `qa-datos.mjs` | Invariantes de datos contra la base (11 checks) |
| `listar-usuarios.mjs` | Las 13 cuentas entran de verdad |

Además: revisión adversarial multi-agente antes de cada deploy grande
(encontró y corrigió 1 DoS real, doble conteo de OCs, pérdidas silenciosas de
datos en imports, zip bomb — el patrón se repite: los tests propios pasan y
la revisión igual encuentra cosas).

## 7. Cómo se trabaja (Fable + Codex)

- **Fable/Claude**: schema, migraciones, `src/lib/**`, `src/app/api/**`,
  circuitos (bancos/capex/budget-actions), scripts, seguridad, commits.
- **Codex CLI** (`codex exec --full-auto --skip-git-repo-check "..."`):
  UI acotada sobre specs escritos (`specs/SPEC-F*.md`). No commitea; su diff
  se revisa SIEMPRE antes de integrar. Fronteras en `AGENTS.md`.

## 8. Pendientes conocidos (en orden de valor)

1. **Cambio de clave + usuarios reales**: hoy son cuentas demo con claves
   compartidas por rol. Falta UI de gestión de usuarios (alta, clave, roles).
2. **Fechas de pago de las OCs**: los avisos de vencimiento están listos pero
   duermen hasta que las OCs pendientes tengan fecha (se cargan con Editar en
   Bancos, o agregando fecha a la planilla de registro y re-subiéndola).
3. **Datos bancarios incompletos**: la mayoría de los pagos importados no
   traen RUT/banco/cuenta — el banco los rechazaría. La UI lo marca
   («⚠ falta…»); alguien tiene que completarlos.
4. **Multi-firma CAPEX N1–N6**: el nivel se calcula y muestra; el flujo de
   firmas por nivel (N4 = comité FIP, etc.) no está implementado.
5. **Dominio propio** (hoy URL de Vercel) y monitoreo de errores (Sentry o
   similar).
6. Presupuestos de las otras 7 entidades: la plataforma está lista; faltan
   los datos (ahora pueden cargarlos ellos mismos por Excel).

## 9. Dónde está cada cosa

- Especificaciones e informes: `specs/` (prompts maestros, spec de cada fase,
  informe de rendimiento).
- Documentos de contexto FUERA del repo (working dir padre): prompt maestro
  original, transcripción del audio del directorio, `DATOS-PRODUCCION.md`
  (URL de claim ya usada, datos de la base), prompt de avisos/pagos.
- Guía de usuario viva: `/guia` en la app (texto en `src/lib/guia.ts`).
- Flujo visual (artifact privado, compartible): "Cómo funciona Presupuestos
  CEHTA" en claude.ai/code/artifacts.
