"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Carga masiva por Excel de un módulo del presupuesto (Ventas/Gastos/CAPEX).
 * Sube contra /api/presupuesto/upload y muestra el resultado completo:
 * creadas, actualizadas y CADA rechazo con su fila y motivo — la regla de la
 * fase es que nada se pierda en silencio.
 */

type Resultado = {
  ok: true;
  creadas: number;
  actualizadas: number;
  filasVacias: number;
  rechazos: { rowIndex: number; motivo: string }[];
  rechazosTotal: number;
  categoriasNuevas?: string[];
  hoja: string;
};

export function ImportarExcel({ modulo, year }: { modulo: "ventas" | "gastos" | "capex"; year: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  async function subir(e: React.FormEvent) {
    e.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError("Elegí un archivo Excel primero");
      return;
    }
    setSubiendo(true);
    setError(null);
    setResultado(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("modulo", modulo);
      form.set("año", String(year));
      const res = await fetch("/api/presupuesto/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No fue posible importar el archivo");
        if (Array.isArray(data.rechazos) && data.rechazos.length > 0) {
          setResultado({ ok: true, creadas: 0, actualizadas: 0, filasVacias: 0, rechazos: data.rechazos, rechazosTotal: data.rechazosTotal ?? data.rechazos.length, hoja: "" });
        }
      } else {
        setResultado(data);
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      }
    } catch {
      setError("No fue posible subir el archivo. Revisá tu conexión e intentalo de nuevo.");
    } finally {
      setSubiendo(false);
    }
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="rounded-lg border border-brand px-4 py-2 text-sm font-semibold text-brand transition hover:bg-lavender-bg"
      >
        Importar Excel
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-ink">Importar {modulo} {year} desde Excel</p>
        <button type="button" onClick={() => { setAbierto(false); setError(null); setResultado(null); }}
          className="text-xs text-ink-soft hover:text-ink">
          Cerrar
        </button>
      </div>

      <p className="mt-1 text-xs leading-relaxed text-ink-soft">
        Partí de la{" "}
        <a href={`/api/presupuesto/plantilla?modulo=${modulo}`} download className="font-semibold text-brand hover:text-brand-deep">
          plantilla de {modulo}
        </a>
        . La importación <strong>actualiza</strong> las líneas que ya existen (mismo nombre) y{" "}
        <strong>crea</strong> las nuevas — nunca borra nada, y no toca la ejecución real ni los pagos marcados. Acordate de borrar las filas de EJEMPLO.
      </p>

      <form onSubmit={subir} className="mt-3 flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          aria-label="Archivo Excel a importar"
          className="text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-lavender-bg file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand hover:file:bg-lavender-bg/70"
        />
        <button
          type="submit"
          disabled={subiendo}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-deep disabled:opacity-60"
        >
          {subiendo ? "Importando…" : "Importar"}
        </button>
      </form>

      {error && (
        <p className="mt-3 rounded-lg bg-danger-bg px-3.5 py-2.5 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {resultado && resultado.ok && (
        <div className="mt-3 space-y-2 text-sm" role="status">
          {(resultado.creadas > 0 || resultado.actualizadas > 0) && (
            <p className="rounded-lg bg-ok-bg px-3.5 py-2.5 text-ok">
              ✓ {resultado.creadas} línea(s) creada(s) · {resultado.actualizadas} actualizada(s)
              {resultado.filasVacias > 0 ? ` · ${resultado.filasVacias} fila(s) vacía(s) ignorada(s)` : ""}
              {resultado.categoriasNuevas?.length
                ? ` · categorías nuevas: ${resultado.categoriasNuevas.join(", ")}`
                : ""}
            </p>
          )}
          {resultado.rechazos.length > 0 && (
            <div className="rounded-lg bg-warn-bg px-3.5 py-2.5 text-warn">
              <p className="font-semibold">
                {resultado.rechazosTotal} fila(s) no entraron{resultado.rechazosTotal > resultado.rechazos.length ? ` (se muestran ${resultado.rechazos.length})` : ""}:
              </p>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs">
                {resultado.rechazos.map((r) => (
                  <li key={`${r.rowIndex}-${r.motivo}`}>
                    fila {r.rowIndex}: {r.motivo}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
