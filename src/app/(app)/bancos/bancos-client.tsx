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

/** Un abono individual (transferencia parcial), YA formateado del server. */
export type AbonoView = {
  id: string;
  fecha: string;
  descripcion: string | null;
  monto: string;
  /** Esta fila descuenta del total (plata efectivamente abonada). */
  abona: boolean;
  /** Saldo del documento después de esta fila — se descuenta solo. */
  saldo: string;
  datosBancarios: string;
  estado: string;
  esRegistro: boolean;
};

/** Grupo de abonos por referencia: Total, Abonado, Diferencia y el detalle. */
export type GrupoAbonosView = {
  referencia: string;
  total: string;
  abonado: string;
  diferencia: string;
  porcentaje: number;
  completa: boolean;
  /** Las cartolas pagaron más de lo que declara la orden. */
  sobrepagado: boolean;
  excedente: string;
  movimientos: number;
  abonos: AbonoView[];
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
  m, acumulado, seleccionado, puedeSeleccionar, puedeEditar, onSeleccionar, onEditar,
}: {
  m: MovementView;
  /** Monto total corrido hasta esta fila, ya formateado (ver `corrida`). */
  acumulado: string;
  seleccionado: boolean;
  puedeSeleccionar: boolean;
  puedeEditar: boolean;
  onSeleccionar: (id: string, valor: boolean) => void;
  onEditar: (m: MovementView) => void;
}) {
  // Cada columna muestra SU propio valor. Las filas del registro de órdenes de
  // compra traen las dos cosas a la vez (débito = saldo por pagar, crédito =
  // lo ya abonado): decidir "es abono o es egreso" escondía uno de los dos
  // detrás de un guion, y entonces la columna no sumaba lo que dice su pie.
  const tieneMonto = !new Decimal(m.debit).isZero();
  const tieneAbono = !new Decimal(m.credit).isZero();
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
      {/* Monto (egreso) · Abono (ingreso) · Monto total (el corrido) */}
      <td className="cell-num whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-ink">
        {tieneMonto ? formatCell(m.debit) : <span className="font-normal text-ink-soft">—</span>}
      </td>
      <td className="cell-num whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-ok">
        {/* "+" porque en la cartola un abono es plata que ENTRA. Que además
            descuente del corrido lo dice el encabezado, no el signo. */}
        {tieneAbono ? `+ ${formatCell(m.credit)}` : <span className="font-normal text-ink-soft">—</span>}
      </td>
      <td className="cell-num whitespace-nowrap bg-soft/50 px-3 py-2.5 text-sm font-semibold text-ink">
        {acumulado}
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
  companyCode, sheets, selectedSheetId, movements: initial, lotes, gruposAbonos, bitacora, permisos, quienSoy,
}: {
  companyCode: string;
  sheets: SheetView[];
  selectedSheetId: string | null;
  movements: MovementView[];
  lotes: LoteView[];
  gruposAbonos: GrupoAbonosView[];
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

  /**
   * Monto · Abono · Monto total de la tabla de movimientos: el corrido suma
   * los montos y descuenta los abonos fila a fila, y el pie cierra con la
   * resta. Se calcula sobre `visibles` (no sobre todos los movimientos) a
   * propósito: si hay un filtro puesto, lo que se ve y lo que suma tienen que
   * ser lo mismo — un total que incluyera filas ocultas no cuadraría con la
   * columna. Decimal, jamás aritmética float sobre montos.
   */
  const corrida = useMemo(() => {
    const acumulado = new Map<string, string>();
    let montos = new Decimal(0);
    let abonos = new Decimal(0);
    for (const m of visibles) {
      montos = montos.plus(new Decimal(m.debit).abs());
      abonos = abonos.plus(new Decimal(m.credit).abs());
      acumulado.set(m.id, formatCell(montos.minus(abonos)) || "0");
    }
    return { acumulado, montos, abonos, diferencia: montos.minus(abonos) };
  }, [visibles]);

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

      {/* Abonos por referencia — la pantalla inicial del módulo: cada factura,
          OC o proveedor con su Total, lo Abonado y la Diferencia (calculada en
          el server, se descuenta sola). Cada grupo se expande a sus abonos:
          fecha, descripción, monto, datos bancarios y estado. */}
      {gruposAbonos.length > 0 && (
        <section className="rounded-xl border border-line bg-white">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-brand">
              Abonos por referencia
            </h2>
            <span className="text-xs text-ink-soft">
              {gruposAbonos.filter((g) => !g.completa).length} con diferencia pendiente ·{" "}
              {gruposAbonos.filter((g) => g.completa).length} completas
            </span>
          </div>
          <ul className="max-h-[32rem] divide-y divide-line/70 overflow-y-auto">
            {gruposAbonos.map((g) => (
              <li key={g.referencia}>
                <details className="group">
                  <summary className="cursor-pointer list-none px-5 py-3 hover:bg-soft/60">
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                      <span className="text-brand transition group-open:rotate-90 inline-block text-xs" aria-hidden="true">▶</span>
                      <span className="min-w-24 text-sm font-semibold text-ink">{g.referencia}</span>
                      <span className="cell-num text-xs text-ink-soft">Total {g.total}</span>
                      <span className="cell-num text-xs text-ok">Abonado {g.abonado}</span>
                      <span className={`cell-num text-xs font-semibold ${g.completa ? "text-ok" : "text-warn"}`}>
                        {g.completa ? "✓ saldada" : `Diferencia ${g.diferencia}`}
                      </span>
                      {g.sobrepagado && (
                        <span className="rounded-full bg-danger-bg px-2 py-0.5 text-[11px] font-semibold text-danger" title="Los pagos superan el total declarado en la orden — revisá si hay una fila duplicada">
                          ⚠ pagado de más {g.excedente}
                        </span>
                      )}
                      <span className="ml-auto text-xs text-ink-soft">
                        {g.porcentaje}% · {g.movimientos} mov.
                      </span>
                    </div>
                    <div
                      className="mt-2 h-1.5 overflow-hidden rounded-full bg-soft"
                      role="progressbar"
                      aria-valuenow={g.porcentaje}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`Avance de ${g.referencia}`}
                    >
                      <div
                        className={`h-full rounded-full ${g.completa ? "bg-ok" : "bg-brand"}`}
                        style={{ width: `${Math.min(g.porcentaje, 100)}%` }}
                      />
                    </div>
                  </summary>
                  <div className="overflow-x-auto border-t border-line/70 bg-soft/40 px-5 py-3">
                    {/* Monto · Abono · Monto total, igual que el Excel del
                        banco: el total del documento arriba, los abonos abajo
                        y el saldo descontándose fila a fila hasta la
                        diferencia del pie. */}
                    <table className="w-full border-collapse text-xs">
                      <thead className="text-left uppercase tracking-wide text-ink-soft">
                        <tr>
                          <th className="py-1.5 pr-4">Fecha</th>
                          <th className="py-1.5 pr-4">Descripción</th>
                          <th className="py-1.5 pr-4 text-right">Monto</th>
                          <th className="py-1.5 pr-4 text-right">Abono</th>
                          <th className="py-1.5 pr-4 text-right" title="Lo que queda por abonar después de esta fila">
                            Monto total
                          </th>
                          <th className="py-1.5 pr-4">Datos bancarios</th>
                          <th className="py-1.5">Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-t border-line/60 bg-white/70">
                          <td className="py-1.5 pr-4 font-semibold text-ink" colSpan={2}>
                            Total del documento
                          </td>
                          <td className="cell-num whitespace-nowrap py-1.5 pr-4 text-right font-semibold text-ink">
                            {g.total}
                          </td>
                          <td className="py-1.5 pr-4 text-right text-ink-soft">—</td>
                          <td className="cell-num whitespace-nowrap py-1.5 pr-4 text-right font-semibold text-ink">
                            {g.total}
                          </td>
                          <td className="py-1.5 pr-4" />
                          <td className="py-1.5" />
                        </tr>
                        {g.abonos.map((b) => (
                          <tr key={b.id} className="border-t border-line/60">
                            <td className="whitespace-nowrap py-1.5 pr-4 text-ink">{b.fecha}</td>
                            <td className="max-w-72 py-1.5 pr-4 text-ink">
                              {b.descripcion ?? "—"}
                              {b.esRegistro && (
                                <span className="ml-2 rounded bg-lavender-bg px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                                  registro
                                </span>
                              )}
                            </td>
                            <td className="cell-num whitespace-nowrap py-1.5 pr-4 text-right text-ink">
                              {b.monto}
                            </td>
                            {/* Solo las filas que descuentan van a la columna
                                Abono: una fila PENDIENTE todavía no se pagó, y
                                la del registro declara el total, no lo abona. */}
                            <td className={`cell-num whitespace-nowrap py-1.5 pr-4 text-right font-semibold ${b.abona ? "text-ok" : "text-ink-soft"}`}>
                              {b.abona ? `− ${b.monto}` : "—"}
                            </td>
                            <td className="cell-num whitespace-nowrap py-1.5 pr-4 text-right font-semibold text-ink">
                              {b.saldo}
                            </td>
                            <td className="py-1.5 pr-4 text-ink-soft">{b.datosBancarios}</td>
                            <td className="whitespace-nowrap py-1.5">
                              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${ESTADO_CHIP[b.estado] ?? "bg-soft text-ink-soft border-line"}`}>
                                {ESTADO_TEXTO[b.estado] ?? b.estado}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-line">
                          <td className="py-2 pr-4 font-bold uppercase tracking-wide text-ink" colSpan={2}>
                            Totales
                          </td>
                          <td className="cell-num whitespace-nowrap py-2 pr-4 text-right font-bold text-ink">
                            {g.total}
                            <span className="block text-[10px] font-normal uppercase text-ink-soft">total</span>
                          </td>
                          <td className="cell-num whitespace-nowrap py-2 pr-4 text-right font-bold text-ok">
                            {g.abonado}
                            <span className="block text-[10px] font-normal uppercase text-ink-soft">abonado</span>
                          </td>
                          <td className={`cell-num whitespace-nowrap py-2 pr-4 text-right font-bold ${g.completa ? "text-ok" : "text-warn"}`}>
                            {g.diferencia}
                            <span className="block text-[10px] font-normal uppercase text-ink-soft">diferencia</span>
                          </td>
                          <td className="py-2 pr-4" />
                          <td className="py-2" />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}

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
                    <th className="border-b border-line px-3 py-3 text-right" title="Egreso: lo que hay que pagar">Monto</th>
                    <th className="border-b border-line px-3 py-3 text-right" title="Ingreso: lo que se abonó">Abono</th>
                    <th className="border-b border-line px-3 py-3 text-right" title="Corrido: suma los montos y descuenta los abonos, en el orden que ves">
                      Monto total
                    </th>
                    <th className="border-b border-line px-3 py-3">Datos bancarios</th>
                    <th className="border-b border-line px-3 py-3">Estado</th>
                    <th className="border-b border-line px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {visibles.length === 0 && (
                    <tr><td colSpan={10} className="px-6 py-10 text-center text-sm text-ink-soft">Sin movimientos con este filtro</td></tr>
                  )}
                  {visibles.map((m) => (
                    <MovementRow key={m.id} m={m} acumulado={corrida.acumulado.get(m.id) ?? "0"}
                      seleccionado={seleccion.has(m.id)}
                      puedeSeleccionar={permisos.libera} puedeEditar={permisos.edita}
                      onSeleccionar={onSeleccionar} onEditar={setEditando} />
                  ))}
                </tbody>
                {visibles.length > 0 && (
                  <tfoot className="bg-soft">
                    <tr>
                      <td className="border-t-2 border-line px-3 py-3" />
                      <td className="border-t-2 border-line px-3 py-3 text-xs font-bold uppercase tracking-wide text-ink" colSpan={3}>
                        Totales de lo que ves
                      </td>
                      <td className="cell-num whitespace-nowrap border-t-2 border-line px-3 py-3 text-sm font-bold text-ink">
                        {formatCell(corrida.montos) || "0"}
                        <span className="block text-[10px] font-normal uppercase text-ink-soft">monto</span>
                      </td>
                      <td className="cell-num whitespace-nowrap border-t-2 border-line px-3 py-3 text-sm font-bold text-ok">
                        {formatCell(corrida.abonos) || "0"}
                        <span className="block text-[10px] font-normal uppercase text-ink-soft">abono</span>
                      </td>
                      <td className={`cell-num whitespace-nowrap border-t-2 border-line px-3 py-3 text-sm font-bold ${corrida.diferencia.isNegative() ? "text-ok" : "text-ink"}`}>
                        {formatCell(corrida.diferencia) || "0"}
                        <span className="block text-[10px] font-normal uppercase text-ink-soft">diferencia</span>
                      </td>
                      <td className="border-t-2 border-line px-3 py-3" colSpan={3} />
                    </tr>
                  </tfoot>
                )}
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
