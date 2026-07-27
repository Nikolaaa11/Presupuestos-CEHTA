<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Presupuestos CEHTA — contrato para agentes (Claude Code + Codex)

En particular sobre Next 16: `params`/`searchParams` son **Promises** (usar `await`), Turbopack es default, y NO usamos `middleware.ts`/`proxy.ts` — la protección va en layouts y server actions.

## Qué es esta app

Plataforma de presupuestos anuales del fondo CEHTA. Cada una de las 9 entidades (AFIS, FIP, CENERGY, CSL, RHO, DTE, EVOQUE, REVTECH, TRONGKAI) carga su presupuesto del año **mes a mes** en 3 módulos: **Ventas** (cliente × mes, con tipo contrato/proyección), **Gastos** (ítem × mes por categoría) y **CAPEX** (inversiones con mes requerido, plazo y fuente de financiamiento). El fondo (FUND_ADMIN) consolida y aprueba. Spec de la fase actual: `specs/`.

## Stack y comandos

- Next.js 16 (App Router, Turbopack) + TypeScript estricto + Tailwind v4 (tokens de marca en `src/app/globals.css`)
- Prisma 7 (generator `prisma-client` → `src/generated/prisma`) + adaptador `@prisma/adapter-pg`
- Auth.js v5 (credenciales + JWT), sesión con `role`, `companyId`, `companyCode`

```bash
npm run dev        # dev server (requiere db:dev corriendo en otra terminal)
npm test           # vitest — lógica de dinero (DEBE quedar verde)
npm run build      # build + typecheck (DEBE pasar)
npm run lint       # eslint
npm run db:dev     # servidor Prisma Postgres local (puertos 51214/51215)
npm run db:apply   # aplica prisma/migrations vía driver pg (migrate dev NO funciona contra el server wasm local)
npm run db:seed    # seed demo (9 empresas, 10 usuarios)
```

Usuarios demo: `admin@cehta.cl`/`Cehta2026!` (FUND_ADMIN) · `demo.<código>@cehta.cl`/`Demo2026!` (COMPANY_MANAGER, ej. `demo.cenergy@cehta.cl`).

## Reglas de oro (no negociables)

1. **Dinero**: jamás `Float`/aritmética float sobre montos. Las cifras viajan como **string** y se calculan con `src/lib/money.ts` (Decimal). Totales y agregados se calculan **server-side**.
2. **Autorización en el servidor**: toda página llama `requireUser()`/`requireFundAdmin()` y todo server action de escritura empieza con `requireEditableBudget(budgetId)` o el guard que corresponda (`src/lib/authz.ts`, `src/lib/budget.ts`). La UI puede ocultar botones; la seguridad vive en el server action.
3. **Inmutabilidad**: presupuestos `ENVIADO`/`APROBADO`/`CERRADO` son de solo lectura. Solo `BORRADOR` y `OBSERVADO` se editan, y solo por el `COMPANY_MANAGER` dueño. `FUND_ADMIN` ve todo pero no edita líneas.
4. **Validación**: todo input pasa por Zod (schemas en `src/lib/budget.ts`). Los server actions devuelven `{ ok: true, ... } | { ok: false, error: string }` — nunca exponen errores crudos al cliente.
5. **UI en español es-CL**: copy, labels y errores en español chileno. Montos con `formatMoney`/`formatCell` de `src/lib/money.ts`. Celdas numéricas con clase `cell-num`.
6. **Marca Cehta**: usar los tokens de `globals.css` (`bg-brand`, `text-ink`, `border-line`, `bg-lavender-bg`, `bg-ok-bg`, `text-danger`, etc.). Nada de colores hardcodeados.
7. Después de mutar: `revalidatePath()` de la ruta afectada.

## Fronteras de archivos para Codex

**Codex NO toca** (zona de Claude/Fable — si necesitás un cambio acá, dejá un comentario `// PROPUESTA:` en tu código y seguí):
- `prisma/schema.prisma`, `prisma/migrations/**`, `prisma/seed.ts`
- `src/auth.ts`, `src/lib/{prisma,authz,money,capex,budget}.ts`
- `src/generated/**` (autogenerado), `scripts/**`, `AGENTS.md`, `CLAUDE.md`, `.env*`

**Codex SÍ es dueño de** (según el spec de la fase en `specs/`):
- `src/app/(app)/ventas/**`, `src/app/(app)/gastos/**` (F2: páginas, grillas, server actions)
- `src/components/**` nuevos que la fase necesite

## Flujo de trabajo

- Codex implementa el spec de la fase (`specs/SPEC-F*.md`) y **NO hace commits ni push** — deja los cambios en el working tree; Claude revisa, corrige y commitea.
- Antes de terminar una pasada: `npm test`, `npm run build` y `npm run lint` sin errores nuevos.
- Comentarios de código en español, solo donde expliquen una restricción no evidente.
