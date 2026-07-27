# Presupuestos CEHTA

Plataforma de presupuestos anuales del fondo **CEHTA Capital** (FIP CEHTA ESG / AFIS S.A.). Cada entidad del fondo carga su presupuesto del año **mes a mes** en tres módulos — **Ventas**, **Gastos** y **CAPEX** — y el fondo consolida, revisa y aprueba todo el portafolio.

> *"Así como tenemos una plataforma para meter el voucher de los gastos, necesitamos una plataforma donde los gerentes puedan entrar y cargar todo esto... y con este flujo, ir al banco y decirle: finánciame a 18 meses."* — mandato del directorio, jul-2026

## Las 9 entidades

AFIS (administradora) · FIP CEHTA ESG (fondo) · CENERGY · CSL · RHO · DTE · EVOQUE · REVTECH · TRONGKAI

## Qué hace

| Módulo | Concepto |
|---|---|
| **Ventas** | Matriz cliente × mes. Cada línea declara tipo: **contrato** (respaldada), **proyección a público** (estimada) o **recurrente** — el fondo ve de un vistazo cuánta venta está firmada vs proyectada. Pegado directo desde Excel. |
| **Gastos** | Matriz ítem × mes por categoría (personal, fijos, variables...). Subtotales por categoría. |
| **CAPEX** | Inversiones del año: monto (CLP/UF/USD), **mes en que se requiere**, plazo y fuente de financiamiento. Nivel de aprobación **N1–N6** calculado automáticamente por umbrales en UF (matriz LOA del fondo). |
| **Caso bancable** | Para cada *iniciativa* (nuevo negocio), las ventas y gastos vinculados generan el flujo mensual y la cobertura de la cuota — la hoja imprimible que el gerente lleva al banco. |
| **Ciclo de aprobación** | `BORRADOR → ENVIADO → (OBSERVADO ⇄) → APROBADO`. Lo aprobado es un **snapshot inmutable**; reabrir crea la versión siguiente. Todo queda en audit log. |
| **Consolidado** | Vista del fondo: semáforo de las 9 entidades, matriz mensual consolidada, mix contrato/proyección, pipeline CAPEX y **export Excel** (hoja por empresa + consolidado). |

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · Prisma 7 + PostgreSQL (`@prisma/adapter-pg`) · Auth.js v5 (credenciales + JWT) · decimal.js (jamás float para dinero) · SheetJS (export) · Vitest.

## Setup local

```bash
npm install                 # instala y genera el cliente Prisma (postinstall)
cp .env.example .env        # revisá los valores
npm run db:dev              # levanta Postgres local de Prisma (terminal aparte, queda corriendo)
npm run db:apply            # aplica las migraciones (ver nota abajo)
npm run db:seed             # 9 empresas + 10 usuarios demo + presupuesto ejemplo
npm run dev                 # http://localhost:3000
```

> **Nota — migraciones en dev**: el schema engine de `prisma migrate dev` no conecta con el servidor wasm de `prisma dev`; por eso `npm run db:apply` aplica los SQL de `prisma/migrations/` vía driver pg. Para una migración nueva: editá `prisma/schema.prisma`, generá el SQL con `npx prisma migrate diff` y guardalo en `prisma/migrations/<timestamp>_<nombre>/migration.sql`, después `npm run db:apply`. En producción (Postgres real) funciona el flujo estándar `npx prisma migrate deploy`.

### Usuarios demo

| Usuario | Clave | Rol |
|---|---|---|
| `admin@cehta.cl` | `Cehta2026!` | Fondo (ve todo, aprueba, consolida, exporta) |
| `demo.cenergy@cehta.cl` | `Demo2026!` | Gerencia CENERGY (presupuesto ejemplo con iniciativa bancable) |
| `demo.rho@cehta.cl` | `Demo2026!` | Gerencia RHO (borrador a medio llenar) |
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
specs/             SPEC-F*.md — briefs por fase (contrato Claude ↔ Codex)
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
