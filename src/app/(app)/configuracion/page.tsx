import { prisma } from "@/lib/prisma";
import { requireFundAdmin } from "@/lib/authz";
import { BUDGET_YEAR } from "@/lib/budget";
import { APPROVAL_LEVELS } from "@/lib/capex";
import { FxForm, CategoriesManager, CuentasOrigenManager } from "./config-forms";
import { DropboxPanel, type EstadoDropbox } from "./dropbox-panel";
import { credencialesConfiguradas, CONEXION_ID } from "@/lib/dropbox";

const FX_DEFAULT = { ufToClp: "39200", usdToClp: "950" };

const fechaHora = (d: Date) =>
  new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);

export default async function ConfiguracionPage({
  searchParams,
}: {
  searchParams: Promise<{ dropbox?: string; motivo?: string }>;
}) {
  await requireFundAdmin();
  const { dropbox, motivo } = await searchParams;

  const [fx, categories, companies, conexion] = await Promise.all([
    prisma.fxRate.findUnique({ where: { year: BUDGET_YEAR } }),
    prisma.expenseCategory.findMany({
      orderBy: { sortOrder: "asc" },
      include: { _count: { select: { lines: true } } },
    }),
    prisma.company.findMany({
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, cuentaOrigen: true },
    }),
    prisma.dropboxConnection.findUnique({
      where: { id: CONEXION_ID },
      // El token cifrado NUNCA se selecciona: no tiene por qué salir de la base
      // a un componente, ni siquiera de servidor.
      select: {
        cuentaNombre: true, cuentaEmail: true, esEquipo: true, carpetaRaiz: true,
        conectadoEl: true, conectadoPor: { select: { name: true } },
      },
    }),
  ]);

  const estadoDropbox: EstadoDropbox = {
    credencialesListas: credencialesConfiguradas(),
    conectado: Boolean(conexion),
    cuentaNombre: conexion?.cuentaNombre ?? null,
    cuentaEmail: conexion?.cuentaEmail ?? null,
    esEquipo: conexion?.esEquipo ?? false,
    carpetaRaiz: conexion?.carpetaRaiz ?? null,
    conectadoPor: conexion?.conectadoPor?.name ?? null,
    conectadoEl: conexion ? fechaHora(conexion.conectadoEl) : null,
  };

  const aviso =
    dropbox === "conectado"
      ? { tipo: "ok" as const, texto: "Dropbox quedó conectado. El siguiente paso es elegir la carpeta que se sincroniza." }
      : dropbox === "error"
        ? { tipo: "error" as const, texto: motivo ?? "No se pudo conectar con Dropbox." }
        : null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-ink">Configuración</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Parámetros del fondo — solo administración AFIS/FIP
        </p>
      </header>

      <FxForm
        year={BUDGET_YEAR}
        ufToClp={fx?.ufToClp.toString() ?? FX_DEFAULT.ufToClp}
        usdToClp={fx?.usdToClp.toString() ?? FX_DEFAULT.usdToClp}
      />

      <CategoriesManager
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          isSystem: c.isSystem,
          lines: c._count.lines,
        }))}
      />

      <DropboxPanel estado={estadoDropbox} aviso={aviso} />

      <CuentasOrigenManager companies={companies} />

      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-brand">
          Matriz de aprobación CAPEX (N1–N6)
        </h2>
        <p className="mt-1 text-xs text-ink-soft">
          Umbrales de la política del fondo. El nivel se calcula automáticamente al cargar cada
          inversión, convirtiendo el monto a UF con el tipo de cambio vigente. Edición de umbrales:
          fase 2.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="bg-soft text-left text-xs uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="px-4 py-2.5">Nivel</th>
                <th className="px-4 py-2.5">Aprueba</th>
                <th className="px-4 py-2.5">Rango</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {APPROVAL_LEVELS.map((l) => (
                <tr key={l.level}>
                  <td className="px-4 py-2.5 font-semibold text-brand">N{l.level}</td>
                  <td className="px-4 py-2.5 text-ink">{l.approver}</td>
                  <td className="px-4 py-2.5 text-ink-soft">{l.range}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-dashed border-line bg-white p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">
          Usuarios (fase 2)
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">
          Hoy operan los 10 usuarios demo (uno por empresa + administración del fondo). El alta de
          usuarios reales con invitación por correo está planificada para la fase 2 — la estructura
          de roles ya lo soporta.
        </p>
      </section>
    </div>
  );
}
