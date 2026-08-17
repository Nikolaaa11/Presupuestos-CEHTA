"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { desconectarDropbox } from "./actions";

/**
 * Estado de la conexión con Dropbox.
 *
 * La plataforma corre en un servidor y no puede leer `D:\Dropbox\…`. Lo que sí
 * puede es leer la nube de Dropbox, donde el cliente de escritorio ya subió
 * esos mismos archivos — por eso esta pantalla habla de "la cuenta", no de "la
 * carpeta del computador".
 */

export type EstadoDropbox = {
  credencialesListas: boolean;
  conectado: boolean;
  cuentaNombre: string | null;
  cuentaEmail: string | null;
  esEquipo: boolean;
  carpetaRaiz: string | null;
  conectadoPor: string | null;
  conectadoEl: string | null;
};

export function DropboxPanel({
  estado,
  aviso,
}: {
  estado: EstadoDropbox;
  aviso: { tipo: "ok" | "error"; texto: string } | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  function desconectar() {
    if (!window.confirm("¿Desconectar Dropbox? La plataforma deja de ver los archivos hasta que vuelvas a conectar.")) return;
    setError(null);
    startTransition(async () => {
      const r = await desconectarDropbox();
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-brand">Dropbox</h2>
        {estado.conectado && (
          <span className="rounded-full bg-ok-bg px-2.5 py-0.5 text-xs font-semibold text-ok">Conectado</span>
        )}
      </div>

      <p className="mt-1 text-xs leading-relaxed text-ink-soft">
        Conectá la cuenta de Dropbox del fondo para que la plataforma vea los Excel de la carpeta
        del grupo. Lee la <strong>nube</strong> de Dropbox, que es donde tu Dropbox de escritorio ya
        subió esos archivos — el servidor no puede abrir una carpeta de tu computador.
      </p>

      {aviso && (
        <p
          className={`mt-4 rounded-lg px-3.5 py-2.5 text-sm ${
            aviso.tipo === "ok" ? "bg-ok-bg text-ok" : "bg-danger-bg text-danger"
          }`}
          role={aviso.tipo === "ok" ? "status" : "alert"}
        >
          {aviso.texto}
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-lg bg-danger-bg px-3.5 py-2.5 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {!estado.credencialesListas ? (
        <div className="mt-4 rounded-lg bg-warn-bg px-3.5 py-3 text-sm text-warn">
          <p className="font-semibold">Faltan las credenciales de la app de Dropbox.</p>
          <p className="mt-1 text-xs leading-relaxed">
            Hay que crear una app en dropbox.com/developers/apps y cargar{" "}
            <code className="cell-num">DROPBOX_APP_KEY</code> y{" "}
            <code className="cell-num">DROPBOX_APP_SECRET</code> en las variables de entorno. Sin
            eso, este botón no puede existir.
          </p>
        </div>
      ) : !estado.conectado ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <a
            href="/api/dropbox/conectar"
            className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-deep"
          >
            Conectar Dropbox
          </a>
          <span className="text-xs text-ink-soft">
            Te va a llevar a Dropbox para autorizar. Solo pedimos permiso de <strong>lectura</strong>.
          </span>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-soft">Cuenta</dt>
              <dd className="text-ink">
                {estado.cuentaNombre ?? "—"}
                {estado.cuentaEmail && <span className="text-ink-soft"> · {estado.cuentaEmail}</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-soft">Tipo</dt>
              <dd className="text-ink">{estado.esEquipo ? "Dropbox Business (equipo)" : "Cuenta personal"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-soft">Carpeta que se sincroniza</dt>
              <dd className="text-ink">
                {estado.carpetaRaiz ?? <span className="text-warn">todavía sin elegir</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-soft">Conectó</dt>
              <dd className="text-ink">
                {estado.conectadoPor ?? "—"}
                {estado.conectadoEl && <span className="text-ink-soft"> · {estado.conectadoEl}</span>}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <a
              href="/api/dropbox/conectar"
              className="rounded-lg border border-brand px-4 py-2 text-sm font-semibold text-brand transition hover:bg-lavender-bg"
            >
              Reconectar
            </a>
            <button
              type="button"
              onClick={desconectar}
              disabled={pendiente}
              className="rounded-lg px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-danger-bg hover:text-danger disabled:opacity-60"
            >
              {pendiente ? "Desconectando…" : "Desconectar"}
            </button>
          </div>
          <p className="text-xs leading-relaxed text-ink-soft">
            Desconectar borra el permiso guardado acá. Para que Dropbox también olvide la app,
            entrá a tu cuenta → Seguridad → Aplicaciones conectadas.
          </p>
        </div>
      )}
    </section>
  );
}
