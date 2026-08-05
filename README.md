# Presupuestos CEHTA

**🟢 En producción:** https://presupuestos-cehta-nicolasrietta-1798s-projects.vercel.app (deploy automático desde `main`)

Plataforma de presupuestos anuales del fondo **CEHTA Capital** (FIP CEHTA ESG / AFIS S.A.). Cada entidad del fondo carga su presupuesto del año **mes a mes** en tres módulos — **Ventas**, **Gastos** y **CAPEX** — y el fondo consolida, revisa y aprueba todo el portafolio.

> *"Así como tenemos una plataforma para meter el voucher de los gastos, necesitamos una plataforma donde los gerentes puedan entrar y cargar todo esto... y con este flujo, ir al banco y decirle: finánciame a 18 meses."* — mandato del directorio, jul-2026

## Las 10 entidades

AFIS (administradora) · FIP CEHTA ESG (fondo) · CENERGY · CSL · RHO · DTE · EVOQUE · REVTECH · TRONGKAI · PANIMAVIDA ENERGY SPA

## Qué hace

| Módulo | Concepto |
|---|---|
| **Ventas** | Matriz cliente × mes. Cada línea declara tipo: **contrato** (respaldada), **proyección a público** (estimada) o **recurrente** — el fondo ve de un vistazo cuánta venta está firmada vs proyectada. Pegado directo desde Excel. |
| **Gastos** | Matriz ítem × mes por categoría (personal, fijos, variables...). Subtotales por categoría. |
| **CAPEX** | Inversiones del año: monto (CLP/UF/USD), **mes en que se requiere**, plazo y fuente de financiamiento. Nivel de aprobación **N1–N6** calculado automáticamente por umbrales en UF (matriz LOA del fondo). |
| **Caso bancable** | Para cada *iniciativa* (nuevo negocio), las ventas y gastos vinculados generan el flujo mensual y la cobertura de la cuota — la hoja imprimible que el gerente lleva al banco. |
| **Ciclo de aprobación** | Dos manos, como el circuito de pagos: `BORRADOR → ENVIADO → (Vicky revisa) REVISADO → (Guido aprueba) APROBADO`, con `OBSERVADO ⇄` para devolver a edición. El dueño no revisa y **quien revisó no puede aprobar** (cuatro ojos, forzado en el server). Lo aprobado es un **snapshot inmutable**; reabrir crea la versión siguiente. Todo queda en audit log. |
| **Importación por Excel** | Los tres módulos del presupuesto se cargan por **plantilla Excel** descargable (botón "Importar Excel"). Upsert que **nunca borra**: actualiza líneas existentes y crea nuevas; celdas opcionales vacías no pisan lo existente; todo rechazo vuelve con **fila y motivo**. Las filas EJEMPLO de la plantilla se rechazan si no se editan. Defensa anti **bomba de descompresión** en todas las subidas (se lee el índice del ZIP antes de descomprimir). |
| **Avisos de pago** | Panel en el dashboard, calculado al entrar: órdenes de compra por vencer o vencidas (días de calendario), etapas de CAPEX del mes, y el resumen de OCs con saldo pendiente **sin fecha programada** (al ponerles fecha en Bancos, el aviso se activa solo). |
| **Pago por etapas** | Cada inversión CAPEX puede definir su **cronograma de desembolso en porcentajes** (30% al pedido, 70% contra entrega) con mes de vencimiento; la suma se valida ≤100% en transacción. En Bancos, la sección **Avance por orden de compra** mide qué % de cada OC ya se pagó, distinguiendo el registro de OCs (totales/saldos) de las cartolas (pagos efectivos). |
| **Gastos pagados** | Columna **Pagado** por línea de gasto (manual, con quién y cuándo; permitida aun con presupuesto aprobado) + **sugerencias** de calce contra los movimientos de Bancos del año del presupuesto — la confirmación es siempre de una persona. |
| **Guía por rol** | `/guia`: cada usuario ve su lugar en los dos circuitos ("te toca"), su día a día, lo que no puede hacer y por qué, y las preguntas del primer día. |
| **Ejecución real** | Los Excel del fondo traen PROYECTADO vs REAL por mes, así que cada línea de venta y gasto guarda ambas series. Las grillas tienen un selector **Presupuesto / Real / Variación** y el dashboard y el consolidado muestran lo ejecutado además de lo presupuestado. |
| **Consolidado** | Vista del fondo: semáforo de las 10 entidades, matriz mensual consolidada, mix contrato/proyección, pipeline CAPEX y **export Excel** (hoja por empresa + consolidado). |
| **Circuito de pagos** | Tres manos con responsabilidades separadas: **Guido (dueño) libera** los pagos y se crea un **lote**; **Vicky (administradora) sube el comprobante** de la transferencia; **Guido confirma "transferida"**. Del lote sale la **nómina bancaria en Excel** para carga masiva (RUT, nombre, banco, tipo y n° de cuenta, monto, correo, glosa), que marca las filas incompletas que el banco rechazaría. Todo queda en una **bitácora** append-only: quién, qué, cuándo y el valor anterior de cada campo editado. |
| **Bancos** | Cartolas y transferencias por empresa: **subida de planillas Excel** (detección automática de encabezados — soporta cartolas CC y detalles de transferencia), botón **Liberar/Liberado** por movimiento con auditoría (quién y cuándo), filtros pendientes/liberados, buscador y totales. Re-subir la misma hoja del mismo archivo la reemplaza (sin duplicados). |

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · Prisma 7 + PostgreSQL (`@prisma/adapter-pg`) · Auth.js v5 (credenciales + JWT) · decimal.js (jamás float para dinero) · SheetJS (export) · Vitest.

## Setup local

```bash
npm install                 # instala y genera el cliente Prisma (postinstall)
cp .env.example .env        # revisá los valores
npm run db:dev              # levanta Postgres local de Prisma (terminal aparte, queda corriendo)
npm run db:apply            # aplica las migraciones (ver nota abajo)
npm run db:seed             # 10 empresas + usuarios (incluye Guido y Vicky)
npm run dev                 # http://localhost:3000
```

> **Nota — migraciones en dev**: el schema engine de `prisma migrate dev` no conecta con el servidor wasm de `prisma dev`; por eso `npm run db:apply` aplica los SQL de `prisma/migrations/` vía driver pg. Para una migración nueva: editá `prisma/schema.prisma`, generá el SQL con `npx prisma migrate diff` y guardalo en `prisma/migrations/<timestamp>_<nombre>/migration.sql`, después `npm run db:apply`. En producción (Postgres real) funciona el flujo estándar `npx prisma migrate deploy`.

### Datos cargados (de los Excel del fondo)

| Origen | Módulo |
|---|---|
| CC Santander (821) · CC BICE (65) | Bancos — cartolas de RHO |
| AFIS (45) · CEnergy (51) | Bancos — detalles de transferencia |
| OCRho (98) · OCPani (18) | Bancos — órdenes de compra (pagada = liberada) |
| FlujoII | Ventas (ABONOS) y Gastos (EGRESOS) de RHO, 2025 y 2026, con proyectado y real |
| Prog1–Prog5 | CAPEX de RHO (114 ítems: cartera de proyectos, boletas, programas) |
| Hoja1 (Transferencia detalle) | Gastos recurrentes de AFIS 2026 |

Para reimportar (ambos scripts son idempotentes):

```bash
npx tsx scripts/import-bancos.ts          # cartolas y transferencias
npx tsx scripts/import-excel-completo.ts  # FlujoII, programas, OCs y Hoja1
```

### Usuarios demo

| Usuario | Clave | Rol |
|---|---|---|
| `admin@cehta.cl` | `Cehta2026!` | Fondo (ve todo, aprueba, consolida, exporta) |
| `guido@cehta.cl` | `Cehta2026!` | **Dueño** — libera pagos y confirma transferencias |
| `vicky@cehta.cl` | `Cehta2026!` | **Administradora** — sube los comprobantes de transferencia |
| `demo.rho@cehta.cl` | `Demo2026!` | Gerencia RHO (presupuestos 2025 y 2026, CAPEX, cartolas y OCs) |
| `demo.afis@cehta.cl` | `Demo2026!` | Gerencia AFIS (gastos 2026 y transferencias por liberar) |
| `demo.cenergy@cehta.cl` | `Demo2026!` | Gerencia CENERGY (transferencias por liberar) |
| `demo.<código>@cehta.cl` | `Demo2026!` | Gerencias AFIS, FIP, CSL, DTE, EVOQUE, REVTECH, TRONGKAI |

Cada gerencia ve **solo su empresa**; la autorización vive en el servidor (guards en cada página y server action), no en la UI.

## Scripts

| Script | Qué hace |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | Vitest — lógica de dinero, matriz N1–N6, caso bancable |
| `npm run lint` | ESLint |
| `npm run db:dev` | Servidor Postgres local de Prisma (puertos 51214/51215) |
| `npm run db:apply` | Aplica `prisma/migrations/*.sql` vía driver pg |
| `npm run db:seed` | Seed demo idempotente |

## Deploy (Vercel + Neon)

1. Creá un Postgres en [Neon](https://neon.tech) (o Supabase) y copiá la connection string.
2. En Vercel: importá este repo, seteá `DATABASE_URL`, `AUTH_SECRET` (generá uno con `npx auth secret`) y `AUTH_TRUST_HOST=true`.
3. Migraciones en prod: `npx prisma migrate deploy` (una vez, con `DATABASE_URL` de prod) y `npx prisma db seed` si querés los usuarios demo.
4. Deploy. El `postinstall` genera el cliente Prisma en el build.

## Estructura

```
prisma/            schema + migrations + seed
src/lib/           money.ts (Decimal es-CL) · capex.ts (matriz N1-N6, overrun)
                   bankable.ts (caso bancable) · consolidation.ts (fondo)
                   budget.ts (ciclo + guards) · authz.ts · prisma.ts
src/app/(app)/     dashboard · ventas · gastos · capex (+[id] caso bancable)
                   consolidado · configuracion · budget-actions.ts (aprobación)
src/app/login/     autenticación
src/components/    grillas, badges, paneles de aprobación
specs/             prompts maestros y briefs por fase (contrato Claude ↔ Codex)
AGENTS.md          reglas para agentes de código (Codex las lee automático)
```

## Gobernanza CAPEX (matriz LOA)

| Nivel | Aprueba | Umbral |
|---|---|---|
| N1 | Gerente operativo | ≤ UF 500 |
| N2 | GM portfolio co | UF 500–2.500 |
| N3 | Directorio portfolio co | UF 2.500–10.000 |
| N4 | Comité Inversiones FIP | UF 10.000–50.000 |
| N5 | Directorio AFIS | UF 50.000–200.000 |
| N6 | Asamblea de Aportantes | > UF 200.000 |

Cost overrun: +10% re-aprueba mismo nivel; +25% sube un nivel (informativo en fase 1).

## Roadmap

- **Fase 2 (próxima)**: comparación presupuesto vs real (integración plataforma de vouchers), re-forecasts intra-año (la estructura de versiones ya lo soporta), workflow multi-firma N1–N6, usuarios reales con invitaciones, tasa de interés en el caso bancable, selector multi-año.

---

Construido por **Claude (Fable 5) + Codex** orquestados — arquitectura, dinero y seguridad por Claude; grillas y UI por Codex bajo spec y revisión.
