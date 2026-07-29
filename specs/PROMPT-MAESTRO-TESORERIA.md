# 🟣 PROMPT MAESTRO — Flujo de tesorería, lotes de transferencia y bitácora

> Especificación ejecutable del módulo Bancos v2. Fuente: instrucción del directorio (29-07-2026) + cédula RUT de PANIMAVIDA ENERGY SPA.

## 1. ROL

Actuás como ingeniero senior construyendo el **circuito de pagos** de un fondo de inversión: el camino que recorre una factura desde que el dueño autoriza pagarla hasta que la plata efectivamente salió del banco. Es dinero real de nueve empresas; la trazabilidad no es una funcionalidad, es el producto.

## 2. EL FLUJO (mandato textual)

> *"Guido (dueño la libera), Vicky (administradora) sube la transferencia, Guido (le coloca transferida)."*

Tres personas, tres momentos, **un movimiento no puede saltarse ninguno**:

```
PENDIENTE ──libera──▶ LIBERADO ──sube comprobante──▶ EN TRANSFERENCIA ──confirma──▶ TRANSFERIDO
   (nadie)             (Guido)         (Vicky)                          (Guido)
```

| Etapa | Quién | Qué hace | Qué queda registrado |
|---|---|---|---|
| **Liberar** | **Guido** (dueño) | Selecciona uno o varios pagos pendientes y los autoriza | Quién liberó, cuándo, y el **lote** que se formó |
| **Subir transferencia** | **Vicky** (administradora) | Adjunta el comprobante bancario del lote | Nombre del archivo, quién lo subió, cuándo |
| **Marcar transferida** | **Guido** (dueño) | Confirma que la plata salió | Quién confirmó, cuándo |

**Reglas duras:**
- Vicky **no puede** liberar ni marcar transferido. Guido **no sube** el comprobante (puede, por ser dueño, pero el flujo normal es de Vicky).
- No se puede marcar transferida una transferencia sin comprobante subido.
- No se puede subir comprobante de algo que no fue liberado.
- El `FUND_ADMIN` puede hacer todo (es el rol de administración de la plataforma), pero **queda igualmente registrado en la bitácora**.
- Retroceder un estado es posible solo para el dueño y **también se registra**.

## 3. LOTES DE TRANSFERENCIA

> *"que haga excel de transferencias masivas al liberar, es decir que guarde todas las que se están liberando"*

Cuando Guido libera **N pagos de una vez**, el sistema crea un **lote** que los agrupa. El lote es la unidad de trabajo de Vicky: un comprobante, una confirmación.

Cada lote guarda:
- Número correlativo por empresa (LOTE-001, LOTE-002…)
- Empresa, quién lo liberó y cuándo
- Los movimientos incluidos (con su monto congelado al momento de liberar)
- Total del lote
- Comprobante subido (archivo, quién, cuándo)
- Confirmación de transferencia (quién, cuándo)

**Excel de nómina bancaria**: descargable desde el lote, con las columnas que pide la banca chilena para carga masiva:

| RUT | Nombre / Razón social | Banco | Tipo de cuenta | N° de cuenta | Monto | Correo | Glosa / mensaje |
|---|---|---|---|---|---|---|---|

Más una hoja de resumen con el total, la cantidad de pagos y los datos de la empresa que paga.

## 4. BITÁCORA

Toda acción sobre un movimiento o un lote deja una línea inmutable: **quién, qué, cuándo, sobre qué, y el detalle**. Incluye:

- Liberar / deshacer liberación
- Subir comprobante / reemplazarlo
- Marcar transferida / revertir
- **Editar un movimiento** (guardando el valor anterior y el nuevo)
- Crear, importar o eliminar planillas

La bitácora se ve en la app (por movimiento y general de la empresa), y nunca se edita ni se borra.

## 5. EDICIÓN

> *"que se puedan subir y editar todo"*

Los movimientos son **editables**: fecha, referencia, descripción, monto (abono/egreso), RUT, banco, tipo y número de cuenta, correo, categoría y centro de negocio.

- Editar un movimiento **ya transferido** requiere ser dueño y queda marcado como corrección en la bitácora.
- Cada campo modificado genera su línea de bitácora con valor anterior → nuevo.
- La subida de planillas Excel sigue funcionando (con la protección anti-DoS y la preservación de estados ya implementadas).

## 6. EMPRESA NUEVA

**PANIMAVIDA ENERGY SPA** — RUT **78.214.693-9**
Giro: generación, transmisión y distribución de energía eléctrica
Dirección: Panimávida PC 3 Lote 3, Colbún
(Datos tomados de la cédula RUT, serie 202608515891, emitida 08-06-2026.)

Se incorpora como décima entidad del fondo, con su usuario de gerencia y disponible en todos los módulos. Aprovechando el dato, **todas las empresas pasan a tener RUT** en el sistema (lo necesita la nómina bancaria).

## 7. USUARIOS DEL CIRCUITO

| Usuario | Rol | Puede |
|---|---|---|
| `guido@cehta.cl` | **DUENO** | Liberar, marcar transferida, editar todo, ver bitácora |
| `vicky@cehta.cl` | **ADMINISTRADORA** | Subir comprobantes, editar datos bancarios, ver bitácora |
| `admin@cehta.cl` | FUND_ADMIN | Todo (administración de la plataforma) |
| `demo.<empresa>@cehta.cl` | COMPANY_MANAGER | Su empresa: ver y editar, sin liberar ni confirmar |

## 8. INVARIANTES

1. **Dinero en Decimal**, jamás float.
2. **Autorización server-side** en cada acción; el rol se valida en el servidor, no en la UI.
3. **La bitácora es append-only**: no hay update ni delete.
4. **Un movimiento pertenece a lo más a un lote abierto**; no se puede liberar dos veces.
5. El estado del movimiento y el del lote **nunca se contradicen**.
6. UI en español chileno, marca Cehta.

## 9. CRITERIOS DE ACEPTACIÓN

- [ ] Guido selecciona 3 pagos pendientes, los libera, y se crea **un lote** con los 3 y su total.
- [ ] Desde el lote se descarga el **Excel de nómina bancaria** con los datos de los 3 destinatarios.
- [ ] Vicky sube el comprobante del lote; los 3 movimientos pasan a **EN TRANSFERENCIA**.
- [ ] Vicky **no puede** liberar ni marcar transferida (el servidor lo rechaza aunque fuerce el request).
- [ ] Guido marca el lote como transferido; los 3 quedan **TRANSFERIDO**.
- [ ] No se puede marcar transferida sin comprobante.
- [ ] Editar el monto de un movimiento deja en la bitácora el valor anterior y el nuevo.
- [ ] La bitácora muestra las 6+ acciones del recorrido completo con nombre y hora.
- [ ] **PANIMAVIDA ENERGY SPA** aparece en el selector de empresas con su RUT.
- [ ] Se puede descargar un Excel de los movimientos de una empresa.
- [ ] Tests, lint y build en verde; verificado en producción.
