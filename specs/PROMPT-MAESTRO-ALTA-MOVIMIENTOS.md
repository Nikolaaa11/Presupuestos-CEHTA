# PROMPT MAESTRO — Agregar montos nuevos en Bancos

> Pedido literal: **«necesito que se puedan agregar nuevos montos en la pestaña
> de banco»**. Hoy Bancos solo sabe *subir una planilla*, *editar* una fila que
> ya existe y *borrar* la planilla entera. No hay forma de cargar un movimiento
> a mano: si llega una factura suelta, un pago que no vino en la cartola o un
> abono recibido fuera del Excel, no entra a la plataforma.

## 0. El resultado que se busca

Que Vicky, Guido o el encargado de una empresa puedan **agregar un movimiento
nuevo desde la pantalla de Bancos**, con su monto, y que ese movimiento entre al
circuito de pagos como cualquier otro: aparezca en la tabla, sume en los totales,
se pueda liberar, salga en la nómina del banco y quede en la bitácora.

## 1. Lo que ya existe (no reinventarlo)

| Pieza | Dónde | Qué hace |
|---|---|---|
| `editarMovimiento` | `src/app/(app)/bancos/actions.ts` | Edita campo a campo y registra cada cambio con su valor anterior |
| `normalizarMonto` | idem | `"$1.500.000"` / `"1500000,50"` → `"1500000.00"` |
| `EditorMovimiento` | `bancos-client.tsx` | Diálogo con todos los campos del movimiento |
| `requireAcceso(companyId, roles)` | `src/lib/tesoreria.ts` | Rol + alcance de empresa, en el servidor |
| `registrarBitacora` | idem | Bitácora append-only (`BankEvent`) |
| `motivoNoLiberable` | `src/lib/tesoreria-core.ts` | Qué NO puede entrar a un lote de transferencias |
| `ROLES_EDICION` | `src/lib/tesoreria.ts` | ADMINISTRADORA · DUENO · FUND_ADMIN · COMPANY_MANAGER |

La alta es **el hermano de `editarMovimiento`**: mismos campos, mismas reglas de
dinero, misma bitácora. Escribir la validación dos veces es la forma segura de
que se separen.

## 2. Decisiones de diseño que hay que tomar bien

### 2.1 ¿A qué planilla pertenece un movimiento cargado a mano?

Todo `BankMovement` cuelga de un `BankSheet` (`sheetId` es obligatorio). Un
movimiento manual **no puede ir dentro de una cartola importada**, por dos
razones concretas:

1. `deleteSheet` borra en cascada. Si alguien re-importa o borra la cartola
   "CC Santander", se lleva puesto el trabajo manual **sin avisar**.
2. `esPlanillaRegistroOC(sheet.name)` decide por el NOMBRE de la planilla si sus
   filas son registro de órdenes de compra. Meter altas manuales en una planilla
   llamada "Órdenes de compra RHO" haría que se lean como saldo de una orden:
   no serían liberables y contarían distinto en el avance.

**Regla**: las altas manuales van a una planilla propia por empresa, creada al
vuelo la primera vez (`Cargas manuales`), cuyo nombre **no** puede matchear
`esPlanillaRegistroOC`. Verificarlo con un test.

### 2.2 Egreso o abono, nunca ambiguo

El modelo tiene `debit` (egreso, lo que hay que pagar) y `credit` (abono, lo que
entra). Las filas del registro de OCs traen los dos a la vez, pero eso es una
particularidad de ese Excel — **en una carga a mano hay que elegir uno**, porque
la diferencia decide si el movimiento se puede transferir o no
(`motivoNoLiberable`: un abono recibido jamás se libera).

Formulario: selector **Egreso a pagar / Abono recibido** + un solo campo Monto.

### 2.3 El monto es obligatorio y positivo

Un movimiento sin monto no es un movimiento — es ruido que infla el contador de
pendientes. Rechazar `0`, vacío y negativo con un mensaje claro.
`normalizarMonto` ya devuelve `Math.abs`, así que el rechazo del cero hay que
hacerlo explícito **antes** de guardar.

### 2.4 Alta duplicada

El riesgo real es el doble clic y el "lo cargué ayer y no me acuerdo". Dos
defensas:
- Botón deshabilitado mientras se envía.
- Antes de guardar, buscar en la MISMA empresa un movimiento con igual
  referencia + igual monto + igual fecha. Si existe: **no bloquear** (puede ser
  legítimo: dos cuotas iguales el mismo día), pero **avisar y pedir confirmación
  explícita**.

### 2.5 Bitácora

Acción nueva `MOVIMIENTO_AGREGADO` en el enum `BankAction`, con su etiqueta en
`ETIQUETA_ACCION` ("agregó un movimiento"). Migración idempotente:

```sql
ALTER TYPE "BankAction" ADD VALUE IF NOT EXISTS 'MOVIMIENTO_AGREGADO';
```

`db-deploy.mjs` envuelve cada migración en `BEGIN/COMMIT`. En PostgreSQL ≥ 12
`ADD VALUE` dentro de una transacción está permitido **siempre que el valor
nuevo no se USE en la misma transacción** — acá no se usa, solo se declara.
Producción y local son PostgreSQL 17.

## 3. Reglas de oro que aplican (AGENTS.md)

1. **Dinero**: `Decimal`, nunca float. El monto viaja como string.
2. **Autorización en el servidor**: el server action empieza por
   `requireAcceso(companyId, ROLES_EDICION)`. Ocultar el botón no es seguridad.
   Un `COMPANY_MANAGER` no puede cargar movimientos en otra empresa —
   comprobarlo con la empresa de destino, no con la que dice el cliente.
3. **Zod** para todo input; el action devuelve `{ok:true}|{ok:false,error}` y
   nunca filtra el error crudo.
4. **UI en español es-CL**, tokens de marca de `globals.css`, `cell-num` en las
   celdas numéricas.
5. `revalidatePath("/bancos")` después de mutar.

## 4. Alcance

**Adentro**: server action `agregarMovimiento`, planilla `Cargas manuales`,
diálogo de alta en la pantalla de Bancos, enum + migración, etiqueta de
bitácora, tests, verificación contra el servidor real, guía de usuario.

**Afuera** (no tocar en esta fase): importación por Excel, circuito de
liberación, nómina bancaria, presupuestos.

## 5. Criterios de aceptación

- [ ] Desde `/bancos` hay un botón visible para agregar un movimiento.
- [ ] El movimiento aparece en la tabla, en la planilla `Cargas manuales`, en
      estado `PENDIENTE`, y suma en los totales de Monto/Abono/Monto total.
- [ ] Un egreso con RUT, banco y cuenta completos muestra «✓ se puede pagar» y
      se puede liberar; un abono recibido **no** se puede liberar.
- [ ] La bitácora dice quién lo agregó, cuándo y con qué monto.
- [ ] Un `COMPANY_MANAGER` no puede cargar en una empresa que no es la suya
      (probado contra el server action, no contra la UI).
- [ ] Monto 0 / vacío / no numérico → error claro, no se guarda nada.
- [ ] Un posible duplicado avisa y exige confirmación.
- [ ] `npm test`, `npm run build`, `npm run lint` verdes.
- [ ] Verificado contra el servidor real y contra producción después del deploy.

## 6. Cómo se verifica (el hábito del proyecto)

Nada se declara terminado sin correrlo contra el servidor real. Script nuevo
`scripts/test-alta-movimiento.mjs`: crea, comprueba en la tabla y en la
bitácora, prueba los rechazos (monto 0, empresa ajena, rol sin permiso) y
**limpia lo que creó**. Más los cinco scripts de regresión de producción.

## 7. Revisión adversarial obligatoria antes del deploy

El patrón se repite en este proyecto: los tests propios pasan y la revisión
igual encuentra cosas. Buscar específicamente:

- Un rol que pueda escribir en una empresa que no le corresponde.
- Un monto que se guarde como float, se redondee mal o pierda centavos.
- Un movimiento manual que se cuele como registro de OC y rompa el avance.
- Una alta que quede huérfana o se borre en cascada sin dejar rastro.
- Un duplicado silencioso que infle el pendiente.
- Cualquier camino donde la bitácora NO registre la alta.
