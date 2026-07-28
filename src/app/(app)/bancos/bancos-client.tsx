"use client";

import { memo, useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Decimal from "decimal.js";
import { formatCell, formatMoney } from "@/lib/money";
import { setMovementReleased, deleteSheet } from "./actions";

export type SheetView = {
  id: string;
  name: string;
  sourceFile: string;
  uploadedBy: string;
  createdAt: string;
  total: number;
  pending: number;
};

export type MovementView = {
  id: string;
  date: string | null;
  entryDate: string | null;
  reference: string | null;
  description: string | null;
  credit: string;
  debit: string;
  categoryGeneral: string | null;
  businessCenter: string | null;
  rut: string | null;
  bankName: string | null;
  accountNumber: string | null;
  docType: string | null;
  docNumber: string | null;
  email: string | null;
  link: string | null;
  released: boolean;
  releasedBy: string | null;
  releasedAt: string | null;
};

type Filter = "todos" | "pendientes" | "liberados";

const fmtDate = (iso: string | null) =>
  iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : "—";

// ─────────────────────────── Fila de movimiento ───────────────────────────

const MovementRow = memo(function MovementRow({
  m,
  onToggle,
}: {
  m: MovementView;
  onToggle: (movement: MovementView, released: boolean) => void;
}) {
  const amountIsCredit = Number(m.credit) !== 0;
  const amount = amountIsCredit ? m.credit : m.debit;

  return (
    <tr className={`border-b border-line/70 align-top ${m.released ? "bg-ok-bg/30" : "hover:bg-soft/60"}`}>
      <td className="whitespace-nowrap px-3 py-2.5 text-sm text-ink">{fmtDate(m.date ?? m.entryDate)}</td>
      <td className="max-w-56 px-3 py-2.5">
        <p className="truncate text-sm font-medium text-ink" title={m.reference ?? undefined}>
          {m.reference ?? "—"}
        </p>
        {(m.docType || m.docNumber) && (
          <p className="text-xs text-ink-soft">{[m.docType, m.docNumber].filter(Boolean).join(" ")}</p>
        )}
      </td>
      <td className="max-w-72 px-3 py-2.5">
        <p className="text-sm leading-snug text-ink" title={m.description ?? undefined}>
          {m.description ?? "—"}
        </p>
        {(m.categoryGeneral || m.businessCenter) && (
          <p className="mt-0.5 text-xs text-ink-soft">
            {[m.categoryGeneral, m.businessCenter].filter(Boolean).join(" · ")}
          </p>
        )}
      </td>
      <td className={`cell-num whitespace-nowrap px-3 py-2.5 text-sm font-semibold ${amountIsCredit ? "text-ok" : "text-ink"}`}>
        {amountIsCredit ? "+" : ""}
        {formatCell(amount) || "0"}
      </td>
      <td className="max-w-48 px-3 py-2.5 text-xs text-ink-soft">
        {m.bankName && <p className="truncate">{m.bankName}</p>}
        {m.accountNumber && <p className="cell-num truncate text-left">{m.accountNumber}</p>}
        {m.rut && <p className="truncate">{m.rut}</p>}
        {!m.bankName && !m.accountNumber && !m.rut && "—"}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        <button
          type="button"
          onClick={() => onToggle(m, !m.released)}
          aria-pressed={m.released}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
            m.released
              ? "bg-ok text-white hover:opacity-85"
              : "border border-brand bg-white text-brand hover:bg-lavender-bg"
          }`}
          title={m.released ? "Clic para volver a pendiente" : "Marcar como liberado"}
        >
          {m.released ? "Liberado ✓" : "Liberar"}
        </button>
        {m.released && (m.releasedBy || m.releasedAt) && (
          <p className="mt-1 text-[10px] leading-tight text-ink-soft">
            {[m.releasedBy, m.releasedAt].filter(Boolean).join(" · ")}
          </p>
        )}
      </td>
    </tr>
  );
});

// ─────────────────────────── Componente principal ───────────────────────────

export function BancosClient({
  companyCode,
  sheets,
  selectedSheetId,
  movements: initialMovements,
}: {
  companyCode: string;
  sheets: SheetView[];
  selectedSheetId: string | null;
  movements: MovementView[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [movements, setMovements] = useState(initialMovements);
  const [source, setSource] = useState(initialMovements);
  if (initialMovements !== source) {
    setSource(initialMovements);
    setMovements(initialMovements);
  }

  const [filter, setFilter] = useState<Filter>("todos");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const sheetsFilterRef = useRef<HTMLInputElement>(null);

  const stats = useMemo(() => {
    let pending = 0;
    let pendingAmount = new Decimal(0);
    let releasedCount = 0;
    let releasedAmount = new Decimal(0);
    for (const m of movements) {
      const amount = new Decimal(m.debit).abs().plus(new Decimal(m.credit).abs());
      if (m.released) {
        releasedCount++;
        releasedAmount = releasedAmount.plus(amount);
      } else {
        pending++;
        pendingAmount = pendingAmount.plus(amount);
      }
    }
    return { pending, pendingAmount, releasedCount, releasedAmount };
  }, [movements]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return movements.filter((m) => {
      if (filter === "pendientes" && m.released) return false;
      if (filter === "liberados" && !m.released) return false;
      if (!q) return true;
      return [m.reference, m.description, m.rut, m.bankName, m.categoryGeneral, m.businessCenter]
        .some((v) => v?.toLowerCase().includes(q));
    });
  }, [movements, filter, search]);

  /**
   * El snapshot para el rollback lo aporta la propia fila (que ya tiene el
   * movimiento completo): así el callback no depende del estado ni de un ref,
   * se mantiene estable para la memoización, y al fallar se restaura el
   * movimiento TAL CUAL estaba —incluidos releasedBy/releasedAt originales—
   * en vez de solo invertir el booleano.
   */
  const onToggle = useCallback((before: MovementView, released: boolean) => {
    setError(null);
    setMovements((current) =>
      current.map((m) =>
        m.id === before.id
          ? { ...m, released, releasedBy: released ? "vos" : null, releasedAt: released ? "recién" : null }
          : m,
      ),
    );
    startTransition(async () => {
      const result = await setMovementReleased(before.id, released);
      if (!result.ok) {
        setMovements((current) => current.map((m) => (m.id === before.id ? before : m)));
        setError(result.error);
      }
    });
  }, []);

  function selectSheet(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("planilla", id);
    router.push(`${pathname}?${params.toString()}`);
  }

  async function onUpload(event: React.FormEvent) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setUploadMsg("Elegí un archivo Excel primero.");
      return;
    }
    setUploading(true);
    setUploadMsg(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("companyCode", companyCode);
      const sheetsFilter = sheetsFilterRef.current?.value?.trim();
      if (sheetsFilter) form.set("sheets", sheetsFilter);

      const res = await fetch("/api/bancos/upload", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) {
        setUploadMsg(json.error ?? "Error al subir la planilla");
      } else {
        const detail = json.created
          .map((c: { sheet: string; movements: number }) => `${c.sheet}: ${c.movements} movimientos`)
          .join(" · ");
        setUploadMsg(`Planilla cargada ✓ — ${detail}`);
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      }
    } catch {
      setUploadMsg("Error de conexión al subir la planilla");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Subir planilla */}
      <form
        onSubmit={onUpload}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-4"
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-soft">Subir planilla (.xlsx)</span>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-lavender-bg file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand hover:file:bg-lavender/40"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-soft">Hojas (opcional, ej: CC Santander, CC BICE)</span>
          <input
            ref={sheetsFilterRef}
            type="text"
            placeholder="todas las hojas reconocibles"
            className="w-64 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </label>
        <button
          type="submit"
          disabled={uploading}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-deep disabled:opacity-60"
        >
          {uploading ? "Procesando…" : "Subir a " + companyCode}
        </button>
        {uploadMsg && (
          <p className={`text-sm ${uploadMsg.includes("✓") ? "text-ok" : "text-danger"}`}>{uploadMsg}</p>
        )}
      </form>

      {sheets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-white p-10 text-center">
          <p className="text-sm text-ink-soft">
            No hay planillas cargadas para esta empresa. Subí la primera con el formulario de arriba.
          </p>
        </div>
      ) : (
        <>
          {/* Selector de planillas */}
          <div className="flex flex-wrap gap-2">
            {sheets.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => selectSheet(s.id)}
                className={`rounded-lg border px-3.5 py-2 text-left transition ${
                  s.id === selectedSheetId
                    ? "border-brand bg-lavender-bg"
                    : "border-line bg-white hover:border-lavender"
                }`}
              >
                <p className="text-sm font-semibold text-ink">{s.name}</p>
                <p className="text-xs text-ink-soft">
                  {s.total} movs ·{" "}
                  {(s.id === selectedSheetId ? stats.pending : s.pending) > 0
                    ? `${s.id === selectedSheetId ? stats.pending : s.pending} pendientes`
                    : "todo liberado"}{" "}
                  · {s.createdAt}
                </p>
              </button>
            ))}
          </div>

          {/* Resumen + filtros */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3">
            <div className="flex flex-wrap gap-5 text-sm">
              <span>
                <span className="text-xs uppercase tracking-wide text-ink-soft">Pendientes </span>
                <strong className="text-warn">{stats.pending}</strong>
                <span className="text-ink-soft"> · {formatMoney(stats.pendingAmount, "CLP")}</span>
              </span>
              <span>
                <span className="text-xs uppercase tracking-wide text-ink-soft">Liberados </span>
                <strong className="text-ok">{stats.releasedCount}</strong>
                <span className="text-ink-soft"> · {formatMoney(stats.releasedAmount, "CLP")}</span>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar proveedor, RUT, descripción…"
                className="w-60 rounded-lg border border-line px-3 py-1.5 text-sm outline-none focus:border-brand"
              />
              {(["todos", "pendientes", "liberados"] as Filter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition ${
                    filter === f ? "bg-brand text-white" : "border border-line text-ink-soft hover:bg-soft"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="rounded-lg bg-danger-bg px-3.5 py-2.5 text-sm text-danger">{error}</p>}

          {/* Tabla de movimientos */}
          <section className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-max border-collapse text-left">
                <thead className="bg-soft text-xs font-semibold uppercase tracking-wide text-ink-soft">
                  <tr>
                    <th className="border-b border-line px-3 py-3">Fecha</th>
                    <th className="border-b border-line px-3 py-3">Referencia</th>
                    <th className="border-b border-line px-3 py-3">Descripción</th>
                    <th className="border-b border-line px-3 py-3 text-right">Monto</th>
                    <th className="border-b border-line px-3 py-3">Datos bancarios</th>
                    <th className="border-b border-line px-3 py-3">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-10 text-center text-sm text-ink-soft">
                        Sin movimientos {filter !== "todos" ? `(filtro: ${filter})` : ""}
                      </td>
                    </tr>
                  )}
                  {visible.map((m) => (
                    <MovementRow key={m.id} m={m} onToggle={onToggle} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-line px-4 py-2 text-xs text-ink-soft">
              {visible.length} de {movements.length} movimientos
            </p>
          </section>

          {/* Eliminar planilla */}
          {selectedSheetId && (
            <div className="flex justify-end">
              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  if (deleting) return;
                  if (!window.confirm("¿Eliminar esta planilla completa con todos sus movimientos?")) return;
                  setDeleting(true);
                  startTransition(async () => {
                    const result = await deleteSheet(selectedSheetId);
                    setDeleting(false);
                    if (!result.ok) setError(result.error);
                    else {
                      // Conserva ?empresa= (el admin no debe rebotar a otra empresa)
                      const params = new URLSearchParams(searchParams.toString());
                      params.delete("planilla");
                      router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
                    }
                  });
                }}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-danger-bg hover:text-danger"
              >
                {deleting ? "Eliminando…" : "Eliminar planilla seleccionada"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
