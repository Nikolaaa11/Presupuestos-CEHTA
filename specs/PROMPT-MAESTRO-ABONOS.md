# Prompt maestro — Abonos por referencia y nómina en formato Santander

Fecha: 2026-08-14. Corrido por Claude Code. Origen: pedido del usuario con dos
Excel reales adjuntos (X24 Resintech, X25 Geist+Soltec+Cont).

## Qué pidió el usuario (ordenado)

1. "La pestaña en la pantalla inicial de banco debería crearse por el monto de
   abono… debería salir fecha, referencia, descripción, monto abono, datos
   bancarios, estado."
2. "Al descargar el excel de transferencias masivas debería tener los datos
   del documento adjunto."
3. "El total y abajo lo que se ha ido abonando y una celda de la diferencia o
   que se vaya descontando automático."

## Qué dicen los archivos adjuntos (verificado leyendo ambos)

Son el **formato oficial de carga masiva del Banco Santander**: una hoja con
13 columnas exactas (A–M):

| Col | Encabezado | Nota |
|---|---|---|
| A | Cuenta origen (obligatorio) | La cuenta Santander de la empresa pagadora (ej. 94278910) |
| B | Moneda origen (obligatorio) | CLP |
| C | Cuenta destino (obligatorio) | Cuenta del beneficiario |
| D | Moneda destino (obligatorio) | CLP |
| E | Código banco destino (oblig. si no Santander) | Código SBIF (1 Chile, 37 Santander, 12 Estado…) |
| F | RUT beneficiario (oblig. si no Santander) | Sin puntos ni guión, con DV: 760583634 |
| G | Nombre beneficiario | |
| H | Monto transferencia (obligatorio) | Número plano |
| I | Glosa personalizada transferencia (opcional) | |
| J | Correo beneficiario (opcional) | |
| K | Mensaje correo beneficiario | En los reales es fórmula `=I` |
| L | Glosa cartola originador | Fórmula `=I` |
| M | Glosa cartola beneficiario (solo si destino Santander) | "PROVEEDORES" |

Caso Resintech (X24): la **Factura 541** pagada en 4 ABONOS (3×$5.000.000 +
$484.578 = $15.484.578) — el mismo beneficiario repetido fila a fila. Ese es
exactamente el concepto de "abonos contra un total" del punto 3.

## Alcance de esta corrida

### A. Bancos, pantalla inicial: sección "Abonos por referencia"
Primera sección del módulo (antes de la tabla de planillas): agrupa los
egresos por referencia (Factura/OC/proveedor) y muestra por grupo **Total,
Abonado y Diferencia** (la diferencia se descuenta sola: es Total − Abonado
calculado server-side con Decimal). Cada grupo se expande a sus abonos con
las columnas pedidas: **fecha, referencia, descripción, monto del abono,
datos bancarios (RUT/banco/cuenta), estado**. Reusa la semántica dual ya
resuelta (registro de OC = total o saldo según estado; cartolas = abonos
efectivos) generalizada a cualquier referencia repetida, no solo `OC####`.

### B. Nómina de transferencias masivas = formato Santander exacto
`/api/bancos/nomina?lote=` pasa a generar la hoja **"Transferencias"** con
las 13 columnas A–M del formato adjunto, con:
- Encabezados idénticos (con sus saltos de línea y "(obligatorio)").
- Cuenta origen: nueva columna `Company.cuentaOrigen` (editable en
  Configuración por el admin del fondo). Vacía si no está configurada — la
  celda queda en blanco para completar en el banco, con aviso en el Resumen.
- Código banco destino: mapeo nombre→código SBIF (`src/lib/banco-codigos.ts`,
  puro y testeado). RUT sin puntos ni guión. K y L como fórmulas `=I`.
- M = "PROVEEDORES" (como en ambos archivos reales).

### C. Hoja "Control de abonos" con descuento automático
En el mismo Excel del lote: por cada referencia del lote, **Total** (del
registro si existe), **Abonado antes**, **Este lote**, y **Diferencia** como
FÓRMULA de Excel (`=B-C-D`) — si el usuario edita un monto en la planilla, la
diferencia se recalcula sola. Más la fila de totales del lote.

Se mantienen la hoja "Resumen" (trazabilidad: quién liberó/comprobante/
confirmó) y la advertencia de filas con datos incompletos.

## Fuera de alcance (declarado)
- Enviar el archivo al banco o integrarse con la API de Santander.
- Formatos de otros bancos (BCI/Estado…): el mapeo de códigos queda listo
  para extender, pero el layout generado es el de Santander adjunto.
