"use client";

import { memo, useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Decimal from "decimal.js";
import { formatCell, formatMoney } from "@/lib/money";
import {
  liberarPagos,
  deshacerLiberacion,
  registrarComprobante,
  marcarTransferida,
  revertirTransferencia,
  editarMovimiento,
  deleteSheet,
} from "./actions";

export type SheetView = {
  id: string; name: string; sourceFile: string; uploadedBy: string;
  createdAt: string; total: number; pending: number;
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
  accountType: string | null;
  email: string | null;
  estado: string;
  lote: string | null;
};

export type LoteView = {
  id: string; numero: string; status: string; pagos: number; total: string;
  liberadoPor: string; liberadoEl: string;
  comprobante: string | null; comprobantePor: string | null;
  transferidoPor: string | null; transferidoEl: string | null;
  nota: string | null;
};

export type BitacoraEntry = { id: string; quien: string; accion: string; detalle: string | null; cuando: string };

/** Avance de una orden de compra: los montos llegan YA formateados del server. */
export type AvanceOCView = {
  referencia: string;
  total: string;
  avanzado: string;
  pendiente: string;
  porcentaje: number;
  proximoPago: string | null;
  movimientos: number;
  completa: boolean;
};

type Permisos = { libera: boolean; comprobante: boolean; edita: boolean };
type Filtro = "todos" | "pendientes" | "liberados" | "en_transferencia" | "transferidos";

const ESTADO_CHIP: Record<string, string> = {
  PENDIENTE: "bg-soft text-ink-soft border-line",
  LIBERADO: "bg-warn-bg text-warn border-warn/30",
  EN_TRANSFERENCIA: "bg-lavender-bg text-brand-dark border-lavender",
  TRANSFERIDO: "bg-ok-bg text-ok border-ok/30",
};
const ESTADO_TEXTO: Record<string, string> = {
  PENDIENTE: "Pendiente", LIBERADO: "Liberado",
  EN_TRANSFERENCIA: "En transferencia", TRANSFERIDO: "Transferido",
};
const LOTE_TEXTO: Record<string, string> = {
  LIBERADO: "Esperando comprobante", COMPROBANTE_SUBIDO: "Comprobante subido", TRANSFERIDO: "Transferido",
};

const fmtFecha = (iso: string | null) =>
  iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : "—";
const montoDe = (m: MovementView) =>
  new Decimal(m.debit).abs().isZero() ? new Decimal(m.credit).abs() : new Decimal(m.debit).abs();

/** Qué le falta al movimiento para que el banco acepte la transferencia. */
const faltaDatos = (m: MovementView) =>
  [!m.rut && "RUT", !m.bankName && "banco", !m.accountNumber && "cuenta"].filter(Boolean).join(", ");

/** Un abono (ingreso) no se "paga": el badge de pagable solo aplica a egresos. */
const esAbonoDe = (m: MovementView) => !new Decimal(m.credit).abs().isZero();

// ─────────────────────────── Fila ───────────────────────────

const MovementRow = memo(function MovementRow({
  m, seleccionado, puedeSeleccionar, puedeEditar, onSeleccionar, onEditar,
}: {
  m: MovementView;
  seleccionado: boolean;
  puedeSeleccionar: boolean;
  puedeEditar: boolean;
  onSeleccionar: (id: string, valor: boolean) => void;
  onEditar: (m: MovementView) => void;
}) {
  const esAbono = Number(m.credit) !== 0;
  return (
    <tr className={`border-b border-line/70 align-top ${seleccionado ? "bg-lavender-bg/40" : "hover:bg-soft/60"}`}>
      <td className="px-3 py-2.5">
        {puedeSeleccionar && m.estado === "PENDIENTE" ? (
          <input
            type="checkbox"
            checked={seleccionado}
            onChange={(e) => onSeleccionar(m.id, e.target.checked)}
            aria-label={`Seleccionar ${m.reference ?? "movimiento"}`}
            className="h-4 w-4 accent-brand"
          />
        ) : null}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-sm text-ink">{fmtFecha(m.date ?? m.entryDate)}</td>
      <td className="max-w-52 px-3 py-2.5">
        <p className="truncate text-sm font-medium text-ink" title={m.reference ?? undefined}>{m.reference ?? "—"}</p>
        {m.rut && <p className="text-xs text-ink-soft">{m.rut}</p>}
      </td>
      <td className="max-w-64 px-3 py-2.5">
        <p className="text-sm leading-snug text-ink">{m.description ?? "—"}</p>
        {(m.categoryGeneral || m.businessCenter) && (
          <p className="mt-0.5 text-xs text-ink-soft">{[m.categoryGeneral, m.businessCenter].filter(Boolean).join(" · ")}</p>
        )}
      </td>
      <td className={`cell-num whitespace-nowrap px-3 py-2.5 text-sm font-semibold ${esAbono ? "text-ok" : "text-ink"}`}>
        {esAbono ? "+" : ""}{formatCell(esAbono ? m.credit : m.debit) || "0"}
      </td>
      <td className="max-w-44 px-3 py-2.5 text-xs text-ink-soft">
        {m.bankName && <p className="truncate">{m.bankName}</p>}
        {m.accountNumber && <p className="cell-num truncate text-left">{m.accountNumber}</p>}
        {faltaDatos(m) ? (
          <p className="text-warn" title="El banco rechaza la transferencia sin estos datos">
            ⚠ falta {faltaDatos(m)}
          </p>
        ) : (
          !esAbonoDe(m) &&
          m.estado === "PENDIENTE" && (
            <p className="font-medium text-ok" title="RUT, banco y cuenta completos — el banco acepta la transferencia">
              ✓ se puede pagar
            </p>
          )
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${ESTADO_CHIP[m.estado]}`}>
          {ESTADO_TEXTO[m.estado] ?? m.estado}
        </span>
        {m.lote && <p className="mt-1 text-[10px] text-ink-soft">{m.lote}</p>}
      </td>
      <td className="px-2 py-2.5 text-right">
        {puedeEditar && (
          <button
            type="button"
            onClick={() => onEditar(m)}
            className="rounded px-2 py-1 text-xs font-medium text-brand hover:bg-lavender-bg"
          >
            Editar
          </button>
        )}
      </td>
    </tr>
  );
});

// ─────────────────────────── Componente principal ───────────────────────────

export function BancosClient({
  companyCode, sheets, selectedSheetId, movements: initial, lotes, avancesOC, bitacora, permisos, quienSoy,
}: {
  companyCode: string;
  sheets: SheetView[];
  selectedSheetId: string | null;
  movements: MovementView[];
  lotes: LoteView[];
  avancesOC: AvanceOCView[];
  bitacora: BitacoraEntry[];
  permisos: Permisos;
  quienSoy: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [movements, setMovements] = useState(initial);
  const [source, setSource] = useState(initial);
  if (initial !== source) { setSource(initial); setMovements(initial); }

  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busqueda, setBusqueda] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editando, setEditando] = useState<MovementView | null>(null);
  const [verBitacora, setVerBitacora] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const hojasRef = useRef<HTMLInputElement>(null);

  const stats = useMemo(() => {
    const acc = { pendientes: 0, montoPendiente: new Decimal(0), liberados: 0, enTransferencia: 0, transferidos: 0 };
    for (const m of movements) {
      const monto = montoDe(m);
      if (m.estado === "PENDIENTE") { acc.pendientes++; acc.montoPendiente = acc.montoPendiente.plus(monto); }
      else if (m.estado === "LIBERADO") acc.liberados++;
      else if (m.estado === "EN_TRANSFERENCIA") acc.enTransferencia++;
      else acc.transferidos++;
    }
    return acc;
  }, [movements]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const porEstado: Record<Filtro, (m: MovementView) => boolean> = {
      todos: () => true,
      pendientes: (m) => m.estado === "PENDIENTE",
      liberados: (m) => m.estado === "LIBERADO",
      en_transferencia: (m) => m.estado === "EN_TRANSFERENCIA",
      transferidos: (m) => m.estado === "TRANSFERIDO",
    };
    return movements.filter((m) => {
      if (!porEstado[filtro](m)) return false;
      if (!q) return true;
      return [m.reference, m.description, m.rut, m.bankName, m.categoryGeneral, m.businessCenter]
        .some((v) => v?.toLowerCase().includes(q));
    });
  }, [movements, filtro, busqueda]);

  const seleccionables = visibles.filter((m) => m.estado === "PENDIENTE");
  const totalSeleccionado = useMemo(
    () => movements.filter((m) => seleccion.has(m.id)).reduce((a, m) => a.plus(montoDe(m)), new Decimal(0)),
    [movements, seleccion],
  );
  const incompletosSeleccionados = useMemo(
    () => movements.filter((m) => seleccion.has(m.id) && faltaDatos(m)).length,
    [movements, seleccion],
  );

  const onSeleccionar = useCallback((id: string, valor: boolean) => {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (valor) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  function correr(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, exito?: string) {
    setError(null); setAviso(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
      else { setAviso(exito ?? "Listo"); setSeleccion(new Set()); router.refresh(); }
    });
  }

  async function onSubirPlanilla(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { setError("Elegí un archivo Excel primero."); return; }
    setSubiendo(true); setError(null); setAviso(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("companyCode", companyCode);
      const hojas = hojasRef.current?.value?.trim();
      if (hojas) form.set("sheets", hojas);
      const res = await fetch("/api/bancos/upload", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Error al subir la planilla");
      else {
        setAviso(`Planilla cargada: ${json.created.map((c: { sheet: string; movements: number }) => `${c.sheet} (${c.movements})`).join(" · ")}`);
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      }
    } catch { setError("Error de conexión al subir la planilla"); }
    finally { setSubiendo(false); }
  }

  const irAPlanilla = (id: string) => {
    const p = new URLSearchParams(searchParams.toString());
    p.set("planilla", id);
    router.push(`${pathname}?${p.toString()}`);
  };

  return (
    <div className="space-y-4">
      {/* Subir planilla + descargas */}
      <form onSubmit={onSubirPlanilla} className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-soft">Subir planilla (.xlsx)</span>
          <input ref={fileRef} type="file" accept=".xlsx,.xls"
            className="text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-lavender-bg file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-soft">Hojas (opcional)</span>
          <input ref={hojasRef} type="text" placeholder="todas las reconocibles"
            className="w-52 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" />
        </label>
        <button type="submit" disabled={subiendo}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-deep disabled:opacity-60">
          {subiendo ? "Procesando…" : `Subir a ${companyCode}`}
        </button>
        <a href={`/api/bancos/nomina?empresa=${companyCode}`} download
          className="rounded-lg border border-brand px-4 py-2 text-sm font-semibold text-brand hover:bg-lavender-bg">
          Descargar Excel
        </a>
        <button type="button" onClick={() => setVerBitacora((v) => !v)}
          className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink-soft hover:bg-soft">
          {verBitacora ? "Ocultar bitácora" : "Ver bitácora"}
        </button>
      </form>

      {error && <p className="rounded-lg bg-danger-bg px-3.5 py-2.5 text-sm text-danger" role="alert">{error}</p>}
      {aviso && <p className="rounded-lg bg-ok-bg px-3.5 py-2.5 text-sm text-ok" role="status">{aviso}</p>}

      {/* Bitácora */}
      {verBitacora && (
        <section className="rounded-xl border border-line bg-white">
          <h2 className="border-b border-line px-5 py-3 text-sm font-bold uppercase tracking-wide text-brand">
            Bitácora — quién hizo qué y cuándo
          </h2>
          {bitacora.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-soft">Todavía no hay movimientos registrados.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-line/70 overflow-y-auto">
              {bitacora.map((e) => (
                <li key={e.id} className="px-5 py-2.5 text-sm">
                  <span className="font-medium text-ink">{e.quien}</span>{" "}
                  <span className="text-ink-soft">{e.accion} · {e.cuando}</span>
                  {e.detalle && <p className="mt-0.5 text-xs text-ink-soft">{e.detalle}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Avance por orden de compra — el "pago por etapas" de tesorería:
          cada OC se paga en varios movimientos; acá se ve qué % ya avanzó */}
      {avancesOC.length > 0 && (
        <section className="rounded-xl border border-line bg-white">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-brand">
              Avance por orden de compra
            </h2>
            <span className="text-xs text-ink-soft">
              {avancesOC.filter((a) => !a.completa).length} con saldo pendiente ·{" "}
              {avancesOC.filter((a) => a.completa).length} completas
            </span>
          </div>
          <ul className="max-h-[28rem] divide-y divide-line/70 overflow-y-auto">
            {avancesOC.map((a) => (
              <li key={a.referencia} className="px-5 py-3">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="min-w-20 text-sm font-semibold text-ink">{a.referencia}</span>
                  <span className={`text-sm font-bold ${a.completa ? "text-ok" : "text-brand"}`}>
                    {a.porcentaje}%
                  </span>
                  <span className="cell-num text-xs text-ink-soft">
                    {a.avanzado} de {a.total}
                  </span>
                  {!a.completa && (
                    <span className="cell-num text-xs font-medium text-warn">
                      pendiente {a.pendiente}
                    </span>
                  )}
                  {a.proximoPago && !a.completa && (
                    <span className="text-xs text-ink-soft">próximo pago {a.proximoPago}</span>
                  )}
                  <span className="ml-auto text-xs text-ink-soft">{a.movimientos} mov.</span>
                </div>
                <div
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-soft"
                  role="progressbar"
                  aria-valuenow={a.porcentaje}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Avance de ${a.referencia}`}
                >
                  <div
                    className={`h-full rounded-full ${a.completa ? "bg-ok" : "bg-brand"}`}
                    style={{ width: `${Math.min(a.porcentaje, 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Lotes de transferencia */}
      {lotes.length > 0 && (
        <section className="rounded-xl border border-line bg-white">
          <h2 className="border-b border-line px-5 py-3 text-sm font-bold uppercase tracking-wide text-brand">
            Lotes de transferencia
          </h2>
          <ul className="divide-y divide-line/70">
            {lotes.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    {l.numero} · {l.pagos} pago(s) · {formatMoney(l.total, "CLP")}
                    <span className={`ml-2 rounded-full border px-2 py-0.5 text-xs font-medium ${
                      l.status === "TRANSFERIDO" ? ESTADO_CHIP.TRANSFERIDO
                        : l.status === "COMPROBANTE_SUBIDO" ? ESTADO_CHIP.EN_TRANSFERENCIA : ESTADO_CHIP.LIBERADO}`}>
                      {LOTE_TEXTO[l.status] ?? l.status}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    Liberado por {l.liberadoPor} · {l.liberadoEl}
                    {l.comprobante && ` — comprobante “${l.comprobante}” por ${l.comprobantePor}`}
                    {l.transferidoEl && ` — transferido por ${l.transferidoPor} · ${l.transferidoEl}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <a href={`/api/bancos/nomina?lote=${l.id}`} download
                    className="rounded-lg border border-brand px-3 py-1.5 text-xs font-semibold text-brand hover:bg-lavender-bg">
                    Nómina Excel
                  </a>
                  {permisos.comprobante && l.status !== "TRANSFERIDO" && (
                    <label className="cursor-pointer rounded-lg bg-lavender-bg px-3 py-1.5 text-xs font-semibold text-brand hover:opacity-90">
                      {l.comprobante ? "Reemplazar comprobante" : "Subir transferencia"}
                      <input type="file" className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) correr(() => registrarComprobante(l.id, f.name), `Comprobante de ${l.numero} registrado`);
                          e.target.value = "";
                        }} />
                    </label>
                  )}
                  {permisos.libera && l.status === "COMPROBANTE_SUBIDO" && (
                    <button type="button" onClick={() => correr(() => marcarTransferida(l.id), `${l.numero} marcado como transferido`)}
                      className="rounded-lg bg-ok px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
                      Marcar transferida
                    </button>
                  )}
                  {permisos.libera && l.status === "LIBERADO" && (
                    <button type="button"
                      onClick={() => { if (window.confirm(`¿Deshacer la liberación de ${l.numero}?`)) correr(() => deshacerLiberacion(l.id), `${l.numero} devuelto a pendiente`); }}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-danger-bg hover:text-danger">
                      Deshacer
                    </button>
                  )}
                  {permisos.libera && l.status === "TRANSFERIDO" && (
                    <button type="button"
                      onClick={() => { if (window.confirm(`¿Revertir la transferencia de ${l.numero}?`)) correr(() => revertirTransferencia(l.id), `${l.numero} revertido`); }}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-warn-bg hover:text-warn">
                      Revertir
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sheets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-white p-10 text-center">
          <p className="text-sm text-ink-soft">No hay planillas cargadas. Subí la primera con el formulario de arriba.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {sheets.map((s) => (
              <button key={s.id} type="button" onClick={() => irAPlanilla(s.id)}
                className={`rounded-lg border px-3.5 py-2 text-left transition ${
                  s.id === selectedSheetId ? "border-brand bg-lavender-bg" : "border-line bg-white hover:border-lavender"}`}>
                <p className="text-sm font-semibold text-ink">{s.name}</p>
                <p className="text-xs text-ink-soft">
                  {s.total} movs · {(s.id === selectedSheetId ? stats.pendientes : s.pending) > 0
                    ? `${s.id === selectedSheetId ? stats.pendientes : s.pending} por liberar` : "sin pendientes"}
                </p>
              </button>
            ))}
          </div>

          {/* Barra de acción del dueño */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span><span className="text-xs uppercase tracking-wide text-ink-soft">Por liberar </span>
                <strong className="text-warn">{stats.pendientes}</strong>
                <span className="text-ink-soft"> · {formatMoney(stats.montoPendiente, "CLP")}</span></span>
              <span className="text-xs text-ink-soft">
                {stats.liberados} liberados · {stats.enTransferencia} en transferencia · {stats.transferidos} transferidos
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar proveedor, RUT…" aria-label="Buscar movimientos"
                className="w-52 rounded-lg border border-line px-3 py-1.5 text-sm outline-none focus:border-brand" />
              {(["todos", "pendientes", "liberados", "en_transferencia", "transferidos"] as Filtro[]).map((f) => (
                <button key={f} type="button" onClick={() => setFiltro(f)} aria-pressed={filtro === f}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    filtro === f ? "bg-brand text-white" : "border border-line text-ink-soft hover:bg-soft"}`}>
                  {f === "en_transferencia" ? "en transferencia" : f}
                </button>
              ))}
            </div>
          </div>

          {permisos.libera && seleccion.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand bg-lavender-bg px-4 py-3">
              <div className="text-sm text-brand-dark">
                <p>
                  <strong>{seleccion.size}</strong> pago(s) seleccionado(s) ·{" "}
                  <strong>{formatMoney(totalSeleccionado, "CLP")}</strong>
                </p>
                {incompletosSeleccionados > 0 && (
                  <p className="mt-0.5 text-xs text-warn">
                    ⚠ {incompletosSeleccionados} sin RUT, banco o cuenta — el banco los rechaza.
                    Completalos con “Editar” antes de llevar la nómina.
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setSeleccion(new Set())}
                  className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-soft">
                  Limpiar
                </button>
                <button type="button"
                  onClick={() => {
                    if (!window.confirm(`¿Liberar ${seleccion.size} pago(s) por ${formatMoney(totalSeleccionado, "CLP")}? Se creará un lote de transferencia.`)) return;
                    correr(async () => {
                      const r = await liberarPagos([...seleccion]);
                      return r.ok ? { ok: true } : r;
                    }, "Pagos liberados: se creó el lote y ya podés descargar la nómina");
                  }}
                  className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-deep">
                  Liberar y crear lote
                </button>
              </div>
            </div>
          )}

          {/* Tabla */}
          <section className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-max border-collapse text-left">
                <thead className="bg-soft text-xs font-semibold uppercase tracking-wide text-ink-soft">
                  <tr>
                    <th className="border-b border-line px-3 py-3">
                      {permisos.libera && seleccionables.length > 0 && (
                        <input type="checkbox" aria-label="Seleccionar todos los pendientes visibles"
                          checked={seleccionables.length > 0 && seleccionables.every((m) => seleccion.has(m.id))}
                          onChange={(e) => setSeleccion(e.target.checked ? new Set(seleccionables.map((m) => m.id)) : new Set())}
                          className="h-4 w-4 accent-brand" />
                      )}
                    </th>
                    <th className="border-b border-line px-3 py-3">Fecha</th>
                    <th className="border-b border-line px-3 py-3">Referencia</th>
                    <th className="border-b border-line px-3 py-3">Descripción</th>
                    <th className="border-b border-line px-3 py-3 text-right">Monto</th>
                    <th className="border-b border-line px-3 py-3">Datos bancarios</th>
                    <th className="border-b border-line px-3 py-3">Estado</th>
                    <th className="border-b border-line px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {visibles.length === 0 && (
                    <tr><td colSpan={8} className="px-6 py-10 text-center text-sm text-ink-soft">Sin movimientos con este filtro</td></tr>
                  )}
                  {visibles.map((m) => (
                    <MovementRow key={m.id} m={m} seleccionado={seleccion.has(m.id)}
                      puedeSeleccionar={permisos.libera} puedeEditar={permisos.edita}
                      onSeleccionar={onSeleccionar} onEditar={setEditando} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-line px-4 py-2 text-xs text-ink-soft">
              {visibles.length} de {movements.length} movimientos · sesión de {quienSoy}
            </p>
          </section>

          {permisos.edita && selectedSheetId && (
            <div className="flex justify-end">
              <button type="button"
                onClick={() => {
                  if (!window.confirm("¿Eliminar esta planilla completa con todos sus movimientos?")) return;
                  correr(() => deleteSheet(selectedSheetId), "Planilla eliminada");
                }}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-danger-bg hover:text-danger">
                Eliminar planilla seleccionada
              </button>
            </div>
          )}
        </>
      )}

      {editando && (
        <EditorMovimiento
          m={editando}
          onCerrar={() => setEditando(null)}
          onGuardar={(datos) => {
            correr(() => editarMovimiento(editando.id, datos), "Movimiento actualizado (queda en la bitácora)");
            setEditando(null);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────── Editor ───────────────────────────

function EditorMovimiento({
  m, onCerrar, onGuardar,
}: {
  m: MovementView;
  onCerrar: () => void;
  onGuardar: (datos: Record<string, string>) => void;
}) {
  const [f, setF] = useState({
    date: m.date ?? "", reference: m.reference ?? "", description: m.description ?? "",
    debit: m.debit, credit: m.credit, rut: m.rut ?? "", bankName: m.bankName ?? "",
    accountNumber: m.accountNumber ?? "", accountType: m.accountType ?? "", email: m.email ?? "",
    categoryGeneral: m.categoryGeneral ?? "", businessCenter: m.businessCenter ?? "",
  });
  const campo = "w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand";
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold text-ink">Editar movimiento</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Cada cambio queda registrado en la bitácora con su valor anterior.
          {m.estado === "TRANSFERIDO" && " Este pago ya fue transferido: se registrará como corrección."}
        </p>
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="flex flex-col gap-1"><span className="text-xs text-ink-soft">Fecha</span>
            <input type="date" value={f.date} onChange={set("date")} className={campo} /></label>
          <label className="flex flex-col gap-1 md:col-span-2"><span className="text-xs text-ink-soft">Referencia / proveedor</span>
            <input value={f.reference} onChange={set("reference")} className={campo} /></label>
          <label className="flex flex-col gap-1 md:col-span-3"><span className="text-xs text-ink-soft">Descripción</span>
            <input value={f.description} onChange={set("description")} className={campo} /></label>
          <label className="flex flex-col gap-1"><span className="text-xs text-ink-soft">Egreso (a pagar)</span>
            <input value={f.debit} onChange={set("debit")} inputMode="decimal" className={`${campo} cell-num`} /></label>
          <label className="flex flex-col gap-1"><span className="text-xs text-ink-soft">Abono</span>
            <input value={f.credit} onChange={set("credit")} inputMode="decimal" className={`${campo} cell-num`} /></label>
          <label className="flex flex-col gap-1"><span className="text-xs text-ink-soft">RUT</span>
            <input value={f.rut} onChange={set("rut")} className={campo} /></label>
          <label className="flex flex-col gap-1"><span className="text-xs text-ink-soft">Banco</span>
            <input value={f.bankName} onChange={set("bankName")} className={campo} /></label>
          <label className="flex flex-col gap-1"><span className="text-xs text-ink-soft">Tipo de cuenta</span>
            <input value={f.accountType} onChange={set("accountType")} placeholder="Cuenta Corriente" className={campo} /></label>
          <label className="flex flex-col gap-1"><span className="text-xs text-ink-soft">N° de cuenta</span>
            <input value={f.accountNumber} onChange={set("accountNumber")} className={`${campo} cell-num`} /></label>
          <label className="flex flex-col gap-1 md:col-span-2"><span className="text-xs text-ink-soft">Correo</span>
            <input value={f.email} onChange={set("email")} className={campo} /></label>
          <label className="flex flex-col gap-1"><span className="text-xs text-ink-soft">Categoría</span>
            <input value={f.categoryGeneral} onChange={set("categoryGeneral")} className={campo} /></label>
          <label className="flex flex-col gap-1 md:col-span-2"><span className="text-xs text-ink-soft">Centro de negocio</span>
            <input value={f.businessCenter} onChange={set("businessCenter")} className={campo} /></label>
        </div>
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={() => onGuardar(f)}
            className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-deep">Guardar cambios</button>
          <button type="button" onClick={onCerrar}
            className="rounded-lg border border-line px-5 py-2 text-sm font-medium text-ink-soft hover:bg-soft">Cancelar</button>
        </div>
      </div>
    </div>
  );
}
