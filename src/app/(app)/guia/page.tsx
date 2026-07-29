import Link from "next/link";
import { requireUser } from "@/lib/authz";
import { guiaDe, CIRCUITO_PRESUPUESTO, CIRCUITO_PAGOS, type Etapa } from "@/lib/guia";

export const metadata = { title: "Guía · Presupuestos CEHTA" };

/**
 * Guía de uso personalizada: cada persona ve lo que le toca a ella, no el
 * manual entero. El rol sale de la sesión, así que nadie tiene que elegir
 * "soy administradora" en un desplegable ni leer instrucciones ajenas.
 */
export default async function GuiaPage() {
  const user = await requireUser();
  const guia = guiaDe(user.role);
  const primerNombre = user.name?.split(" ")[0] ?? "";

  return (
    <div className="mx-auto max-w-4xl">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-brand">
          Guía de uso · {guia.rol}
        </p>
        <h1 className="mt-2 text-3xl font-bold leading-tight text-ink">
          {primerNombre ? `Hola ${primerNombre}.` : "Tu lugar en el circuito."}{" "}
          <span className="text-ink-soft">Esto es lo que te toca.</span>
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-soft">{guia.resumen}</p>
      </header>

      {/* ── Circuitos, con la etapa de esta persona resaltada ── */}
      <section className="mt-10">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Los dos circuitos</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Circuito
            titulo="Presupuesto anual"
            etapas={CIRCUITO_PRESUPUESTO}
            rolActual={user.role}
          />
          <Circuito titulo="Pago a proveedores" etapas={CIRCUITO_PAGOS} rolActual={user.role} />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-ink-soft">
          En los dos circuitos, quien prepara no es quien autoriza y quien autoriza no es quien
          ejecuta. No es burocracia: es lo que hace que una cifra aprobada tenga respaldo.
        </p>
      </section>

      {/* ── Pasos ── */}
      <section className="mt-12">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Tu día a día</h2>
        <ol className="mt-4 space-y-3">
          {guia.pasos.map((paso, i) => (
            <li
              key={paso.titulo}
              className="flex gap-4 rounded-xl border border-line bg-white p-5"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-lavender-bg text-xs font-bold text-brand">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-ink">{paso.titulo}</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-soft">{paso.detalle}</p>
                {paso.href && (
                  <Link
                    href={paso.href}
                    className="mt-2 inline-block text-xs font-semibold text-brand hover:text-brand-deep"
                  >
                    Ir a la sección →
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Lo que no le toca ── */}
      <section className="mt-12">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">
          Lo que no vas a poder hacer, y por qué
        </h2>
        <p className="mt-2 text-sm text-ink-soft">
          Si buscás un botón y no está, probablemente sea por acá.
        </p>
        <div className="mt-4 overflow-hidden rounded-xl border border-line bg-white">
          {guia.noLeToca.map((item, i) => (
            <div
              key={item.que}
              className={`flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-baseline sm:gap-6 ${
                i > 0 ? "border-t border-line" : ""
              }`}
            >
              <p className="shrink-0 text-sm font-semibold text-ink sm:w-64">{item.que}</p>
              <p className="text-sm leading-relaxed text-ink-soft">{item.quien}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Preguntas ── */}
      <section className="mt-12">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">
          Lo que se pregunta el primer día
        </h2>
        <div className="mt-4 space-y-2">
          {guia.preguntas.map((f) => (
            <details key={f.p} className="group rounded-xl border border-line bg-white px-5 py-4">
              <summary className="cursor-pointer list-none text-sm font-semibold text-ink marker:hidden">
                <span className="mr-2 text-brand transition group-open:rotate-90 inline-block">›</span>
                {f.p}
              </summary>
              <p className="mt-2 pl-5 text-sm leading-relaxed text-ink-soft">{f.r}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="mt-12 rounded-xl bg-lavender-bg px-5 py-4">
        <p className="text-sm leading-relaxed text-brand-dark">
          <strong>Todo queda registrado.</strong> Cada envío, revisión, aprobación, observación,
          liberación y transferencia guarda quién lo hizo, cuándo y con qué comentario. El historial
          no se edita ni se borra.
        </p>
      </footer>
    </div>
  );
}

/** Dibuja un circuito y marca cuál de las etapas es responsabilidad de quien mira. */
function Circuito({
  titulo,
  etapas,
  rolActual,
}: {
  titulo: string;
  etapas: Etapa[];
  rolActual: string;
}) {
  // El administrador de la plataforma puede operar todas las etapas: resaltarlas
  // todas no diría nada, así que para él no se resalta ninguna.
  const resalta = (rol: string) => rol !== "" && rol === rolActual;

  return (
    <div className="rounded-xl border border-line bg-white p-5">
      <p className="text-sm font-bold text-ink">{titulo}</p>
      <ul className="mt-4 space-y-0">
        {etapas.map((e, i) => {
          const mio = resalta(e.rol);
          return (
            <li key={e.estado}>
              <div
                className={`rounded-lg px-3 py-2 ${mio ? "bg-lavender-bg" : ""}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-sm font-semibold ${mio ? "text-brand-dark" : "text-ink"}`}>
                    {e.estado}
                  </span>
                  {mio && (
                    <span className="shrink-0 rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                      Te toca
                    </span>
                  )}
                </div>
                {e.responsable !== "—" && (
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {e.responsable} {e.accion}
                  </p>
                )}
              </div>
              {i < etapas.length - 1 && (
                <div className="ml-6 h-3 w-px bg-line" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
