# PROMPT MAESTRO — Sincronizar la plataforma con Dropbox

> Pedido literal: **«que las carpetas siempre la plataforma tenga la opción de
> sincronizar con dropbox y ir actualizando los excels del mismo»**, sobre
> `D:\Dropbox\Dropbox\0. FIP.GUIDO\2. AFIS S.A\2. ADMINISTRATIVO\1. Finazas\0.Administrativa_Grupo Cehta`

## 0. La restricción que define todo el diseño

**La plataforma corre en Vercel. No puede leer `D:\` — nunca.** El servidor está
en un datacenter, no en el computador de Nicolás; no hay ninguna configuración
que le dé acceso a esa letra de unidad.

Lo que **sí** funciona, y es lo que hay que construir:

```
D:\Dropbox\Dropbox\…              (el computador de Nicolás)
        │  ya lo sincroniza la app de escritorio de Dropbox
        ▼
   Dropbox (la nube)  ◀──── API HTTP ────  la plataforma en Vercel
```

Esa carpeta **ya está en la nube de Dropbox** — `D:\Dropbox\Dropbox\...` es la
carpeta de sincronización del cliente de escritorio. Así que la plataforma
habla con la **API de Dropbox**, no con el disco. El resultado para Nicolás es
exactamente el que pidió: guarda un Excel en esa carpeta, y la plataforma lo ve.

**Dependencia que NO puede resolver un agente**: hay que crear una app en
`dropbox.com/developers/apps` desde la cuenta del fondo y cargar su **App key**
y **App secret** en Vercel. Eso lo tiene que hacer Nicolás; el resto es nuestro.
Sin esas credenciales la funcionalidad no puede existir, así que la fase empieza
por dejarle el paso a paso escrito y la pantalla lista para pegarlas.

## 1. Qué hay realmente en esa carpeta

Inventariado sobre el disco (no estimado):

| | |
|---|---|
| **PDF** | 3.351 |
| **Excel** | 253 (221 `.xlsx` + 32 `.xls`) |
| Imágenes | ~260 (jpg/jpeg/heic/png) |
| Word | 44 · CSV 26 · PPT 2 |

Y la estructura de primer nivel **calza con las entidades de la plataforma**:

| Carpeta | Entidad | xlsx |
|---|---|---|
| `01_Administradora de Fondos` | **AFIS** | 42 |
| `02_Cehta Capital` | **FIP** (confirmar) | 2 |
| `03_Climate Smart Leasing Spa` | **CSL** | 13 |
| `04_RHO Generación` | **RHO** | 24 |
| `04_RHO Generación/01_Panimavida` | **PANIMAVIDA** | (dentro de RHO) |
| `05_DTE` | **DTE** | 26 |
| `06_Revtech` | **REVTECH** | 32 |
| `07_Evoque Energy Spa` | **EVOQUE** | 59 |
| `08_Trongkai` | **TRONGKAI** | 24 |
| `09_Consulting & Energy Ltda` | **CENERGY** | 24 |
| `10_JP_Ciclo SPA` · `11- JP_FIP Ciclo` · `Manuel Rendiciones` | **sin entidad** | 6 |

Las subcarpetas se repiten por empresa: `Banco`, `Contable`, `F-29`, `Legal`,
`Transferencias`, `Remuneraciones`, `Rendición`, `RRHH`, `Proveedores`,
`Honorarios`. **`Banco` y `Transferencias` son exactamente lo que consume el
módulo Bancos** — ahí está `CC Bancos VA 25.06.2026.xlsx`, el archivo del que
salieron las cartolas que hoy están cargadas.

## 2. El riesgo central: sincronizar no es importar

Importar 253 planillas automáticamente sobre una base con **plata real y pagos
liberados** es la forma más rápida de romper este proyecto. Lo que ya sabemos,
documentado en `HANDOFF.md` y pagado con hallazgos:

- La subida de planillas **reemplaza por nombre de hoja** (`deleteMany`) y no
  preserva `estado` ni `batchId`: re-importar una cartola **rompe el circuito de
  pagos** de lo que ya se liberó.
- Un Excel parcial (solo Ene–Jun) **zeroaba** jul–dic en los presupuestos.
- Las cartolas traen su **fila de totales**, que llegó a ser liberable por
  $1.744.717.286.
- Un archivo puede ser una bomba de descompresión (`revisarZip`).

**Regla de la fase**: la sincronización **propone**, una persona **confirma**.
Nada que toque plata entra solo. El automatismo es para *detectar y preparar*,
no para *aplicar*.

## 3. Alcance

### Adentro
1. **Conectar Dropbox** desde `/configuracion` (solo admin del fondo): OAuth con
   `refresh_token` de larga duración, guardado cifrado. Mostrar estado, cuenta
   conectada y carpeta raíz elegida.
2. **Elegir la carpeta raíz** y **mapear carpeta → entidad**, editable, con el
   mapeo de arriba como propuesta inicial. Las carpetas sin entidad se ignoran
   explícitamente y se dicen.
3. **Explorar** lo que hay: por empresa y subcarpeta, solo Excel, con fecha de
   modificación y tamaño. Que Nicolás VEA lo que la plataforma ve.
4. **Detectar cambios** de forma incremental con el **cursor** de Dropbox
   (`files/list_folder/continue`): qué archivos son nuevos o cambiaron desde la
   última mirada. Esto es «ir actualizando».
5. **Importar bajo confirmación**: desde la lista de cambios, elegir un archivo
   y mandarlo al importador que ya existe (Bancos o presupuesto), con la
   previsualización y el reporte de rechazos que ya funcionan.
6. **Bitácora**: qué archivo, qué versión (`rev` de Dropbox), quién lo importó y
   con qué resultado.

### Afuera (esta fase no lo hace)
- **Escribir en la carpeta de Dropbox de Nicolás.** Ni las nóminas ni nada.
  Requiere permiso de escritura y un pedido explícito; es otra conversación.
- Importar PDFs, imágenes o Word.
- Importar automático sin confirmación humana.
- Sincronizar carpetas de entidades que no existen en la plataforma.

## 4. Lo que hay que resolver bien

1. **Los secretos.** `App key`/`secret` y el `refresh_token` del fondo son
   credenciales que dan acceso a TODA la carpeta financiera del grupo. Nunca en
   el repo, nunca en un log, nunca en el cliente. Definir dónde viven y cómo se
   revocan.
2. **Qué archivo va a qué módulo.** `Banco/…/cartola.xlsx` → Bancos;
   `Transferencias/2026.08.04.xlsx` → ¿Bancos?; `Contable`, `F-29`,
   `Remuneraciones` → hoy no tienen destino. Decidir por carpeta, no por
   adivinanza sobre el nombre, y dejar sin destino lo que no lo tenga.
3. **Volumen y límites.** 253 Excel, y la API de Dropbox tiene rate limits y
   los archivos hay que descargarlos para leerlos. Vercel tiene tope de tiempo y
   de memoria por invocación. `revisarZip` y los topes del importador siguen
   valiendo para todo lo que baje.
4. **Idempotencia.** Sincronizar dos veces no puede duplicar nada. El `rev` de
   Dropbox identifica la versión exacta de un archivo: guardarlo.
5. **Qué pasa si Nicolás renombra o mueve una carpeta.** Que no se pierda el
   mapeo en silencio.

## 5. Reglas de oro que aplican (AGENTS.md)

1. **Dinero**: Decimal, nunca float; totales server-side.
2. **Autorización en el servidor**: conectar/desconectar Dropbox y disparar una
   importación es de administración del fondo. Un `COMPANY_MANAGER` no puede
   importar a otra empresa por ningún camino.
3. **Zod** en todo input; `{ok:true}|{ok:false,error}`; el motivo llega textual.
4. **UI en español es-CL**, tokens de marca.
5. **Bitácora append-only**, `detail` autosuficiente.

## 6. Criterios de aceptación

- [ ] Desde `/configuracion` se conecta una cuenta de Dropbox y se ve conectada.
- [ ] Se elige la carpeta raíz y se ve el mapeo carpeta → entidad, editable.
- [ ] La plataforma lista los Excel por empresa con su fecha de modificación.
- [ ] Después de guardar un Excel nuevo en la carpeta, aparece como «cambió»
      sin tener que reconfigurar nada.
- [ ] Importar desde ahí da el mismo resultado que subir el archivo a mano.
- [ ] Ninguna importación ocurre sin que una persona la confirme.
- [ ] Los secretos no aparecen en el repo, ni en logs, ni en el HTML.
- [ ] Si Dropbox no está configurado, la app funciona exactamente como hoy.
- [ ] `npm test`, `npm run build`, `npx eslint src scripts` verdes.
- [ ] Verificado contra el servidor real y contra producción tras el deploy.

## 7. Revisión adversarial obligatoria

- Un camino donde un rol importe a una empresa que no le corresponde.
- Un token o secreto que termine en el cliente, en un log o en la bitácora.
- Una importación que pise pagos liberados o presupuestos aprobados.
- Un archivo de Dropbox que evite `revisarZip` o los topes del importador.
- Una sincronización que duplique movimientos al correrse dos veces.
- Un fallo de Dropbox (token vencido, 429, carpeta borrada) que deje la
  pantalla colgada o la app rota.
