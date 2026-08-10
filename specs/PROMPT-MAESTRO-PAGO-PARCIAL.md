# PROMPT MAESTRO — Pagar por partes, destrabar con criterio, y una pantalla de Bancos que se entienda

> Pedido literal: **«que cuando haga un abono se pueda liberar o no liberar los
> montos y colocar que el que se libera es el abono o monto total»**, y que la
> app sea **«ultra funcional, fácil, didáctica y simple de usar»**.
>
> Precisado con el usuario: quiere **las dos cosas** —pagar una factura por
> partes eligiendo si se transfiere el abono o el saldo total, Y poder
> destrabar a mano lo que hoy la app prohíbe—. Y lo que más le cuesta hoy es que
> **Bancos tiene demasiado en una pantalla** y que **falta que la app le diga
> qué sigue**.

## 0. El problema de fondo: «abono» significa dos cosas

Esto no es un detalle de copy, es la razón por la que el flujo no se entiende:

| Dónde | Qué llamamos «abono» | En el modelo |
|---|---|---|
| Tabla de movimientos | plata que **entra** (un depósito recibido) | `credit` |
| «Abonos por referencia» | un **pago parcial** contra una factura (plata que **sale**) | `debit` |

El pedido —«liberar el abono o el monto total»— usa el SEGUNDO sentido. Mientras
la misma palabra signifique las dos cosas en la misma pestaña, ninguna
explicación va a alcanzar.

**Regla de esta fase**: se separan los nombres antes de tocar el flujo.
- Plata que entra → **«Ingreso»** (o «Depósito recibido»).
- Pago parcial contra un documento → **«Cuota»** o **«Pago parcial»**.
- Reservar «abono» solo si queda inequívoco en su contexto.

Hay que revisar dónde impacta: `bancos-client.tsx` (columna Abono, diálogo de
alta, detalle de referencias), `guia.ts`, la nómina, y los scripts de
verificación que buscan esos textos.

## 1. Pagar por partes (el corazón del pedido)

Hoy liberar transfiere **el monto entero del movimiento**, sin opción. El caso
real es el de la Factura 541 del fondo: total $15.484.578, pagada en 4 abonos.

Al liberar, para cada movimiento seleccionado hay que poder decir **cuánto se
transfiere**:

```
Factura 541 · Total $15.484.578 · Ya pagado $10.000.000 · Falta $5.484.578

  ( ) Pagar una cuota de:  $ [ 5.000.000 ]
  (•) Pagar todo lo que falta: $5.484.578
```

### Lo que hay que resolver bien

1. **Dónde se guarda el monto liberado.** Un movimiento tiene su `debit`; si se
   transfiere otra cifra, ¿el movimiento cambia, se parte en dos, o el lote
   guarda su propio monto? Cada opción tiene consecuencias en el avance del
   documento (`avisos-core.ts` calcula `avanzado` sumando el `debit` de las
   filas pagadas), en la nómina, y en la bitácora. **Elegir una y sostenerla.**
2. **Que la Diferencia siga cuadrando.** El invariante de la pantalla es que el
   saldo de la última fila es la Diferencia del encabezado. Pagar por partes no
   puede romperlo.
3. **Que no se pueda pagar de más.** Si el saldo que falta es $5.484.578, una
   cuota de $9.000.000 tiene que rechazarse o avisar fuerte — hoy existe la
   marca `sobrepagado` justamente para detectar eso a posteriori.
4. **El monto se escribe a mano** → pasa por `parsearMonto`, con su propio
   mensaje si no cuadra.

## 2. Destrabar con criterio, no con un portazo

Hoy `motivoNoLiberable` (`tesoreria-core.ts`) **bloquea** dos casos:
- un **ingreso recibido**: liberarlo pondría en la nómina una orden de
  transferir hacia afuera plata que nos pagaron, con los datos de quien pagó;
- una **fila del registro de órdenes de compra**: pagaría el saldo entero de la
  orden, duplicando las cuotas que igual van a llegar por cartola.

Los dos motivos siguen siendo ciertos. Lo que cambia es la respuesta: en vez de
prohibir, **explicar y dejar decidir**, con dos condiciones no negociables:

- La confirmación es **explícita y por movimiento**, con el motivo a la vista.
  Nada de un «forzar todo» global.
- Queda en la **bitácora** que se liberó forzando el aviso, con el motivo. Si
  después la plata sale mal, tiene que poder reconstruirse quién lo decidió.

Y el guard de **cuatro ojos** (quien carga un movimiento a mano no lo libera)
**no se destraba**: ese no es un aviso, es una regla del directorio.

## 3. Bancos, en pasos

Hoy la pestaña tiene, todo junto: subir planilla · descargar Excel · agregar
movimiento · ver bitácora · abonos por referencia · lotes de transferencia ·
selector de planillas · barra de filtros y búsqueda · tabla de ~100 filas ·
eliminar planilla. Es la pantalla más importante del fondo y es la más cargada.

Reorganizar alrededor de **lo que la persona vino a hacer**, no de las tablas
que existen. Al menos:
- **Qué me toca hoy** arriba: lo accionable para el rol que mira.
- **Los documentos y su avance** (lo que hoy es «Abonos por referencia»).
- **Los movimientos** con sus filtros.
- **Los lotes** y la bitácora, disponibles pero fuera del camino principal.

Sin perder nada de lo que ya funciona: los totales al pie, el corrido, el orden
determinístico, los avisos de datos bancarios faltantes.

## 4. Que la app diga qué sigue

Después de cada acción, decir **qué pasó, qué falta y quién lo hace**. Hoy los
avisos son correctos pero secos («Pagos liberados»). Deberían cerrar el
circuito: «Se creó el LOTE-004 con 3 pagos por $8.400.000. Ahora Vicky descarga
la nómina, transfiere y sube el comprobante.»

Vale también para los estados vacíos y para los bloqueos: un botón deshabilitado
tiene que decir por qué lo está.

## 5. Reglas de oro que aplican (AGENTS.md)

1. **Dinero**: `Decimal`, nunca float. Montos como string. Totales server-side.
2. **Autorización en el servidor**: `requireAcceso` en todo action de escritura.
3. **Zod** para todo input; `{ok:true}|{ok:false,error}`; el motivo tiene que
   llegar textual (ojo con la lista blanca de `failure()`).
4. **UI en español es-CL**, tokens de marca, `cell-num` en celdas numéricas.
5. **Bitácora append-only**; `detail` autosuficiente.
6. `revalidatePath("/bancos")` después de mutar.

## 6. Criterios de aceptación

- [ ] Al liberar, se puede elegir entre pagar una cuota (monto a mano) o el
      saldo total del documento, y el monto transferido es el elegido.
- [ ] La nómina del banco lleva el monto que se liberó, no otro.
- [ ] El avance del documento y la Diferencia siguen cuadrando después de pagar
      por partes (el invariante de la última fila se mantiene).
- [ ] No se puede pagar más que el saldo sin un aviso explícito.
- [ ] Un ingreso recibido y una fila de registro de OC se pueden liberar
      **solo** confirmando el aviso, y eso queda en la bitácora.
- [ ] Cuatro ojos sigue sin excepción.
- [ ] «Abono» ya no significa dos cosas distintas en la misma pantalla.
- [ ] Bancos separa lo accionable de lo consultable.
- [ ] Cada acción termina diciendo qué sigue y quién lo hace.
- [ ] `npm test`, `npm run build`, `npx eslint src scripts` verdes.
- [ ] Verificado contra el servidor real y contra producción tras el deploy.

## 7. Revisión adversarial obligatoria

Buscar específicamente:
- Un camino donde se transfiera un monto distinto del que se ve en pantalla.
- Un pago parcial que descuadre el avance o la Diferencia.
- Un sobrepago que pase sin aviso.
- Un bloqueo destrabado que NO quede en la bitácora.
- Cuatro ojos evadible por el camino nuevo.
- Una regresión en lo que ya andaba: liberar normal, nómina, importación,
  abonos por referencia, alta manual.
