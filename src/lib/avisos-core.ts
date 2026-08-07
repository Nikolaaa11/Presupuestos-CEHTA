import Decimal from "decimal.js";
import { dec } from "./money";

/**
 * Lógica pura de los avisos de pago — sin Prisma ni `server-only`, para que
 * se pueda testear con Vitest y usar desde cualquier lado. Las consultas
 * viven en src/lib/avisos.ts; acá solo se agrupa y se calcula.
 *
 * El "pago por etapas en porcentaje" de Bancos no necesitó modelo nuevo:
 * las órdenes de compra importadas ya vienen como varios BankMovement con la
 * misma referencia OC#### que suman el total de la orden (93 OCs reales, con
 * avances de 0% a 100%). Acá se agrupan y se mide el avance.
 */

export const PATRON_OC = /^OC\d/i;
export const DIAS_POR_VENCER = 7;

/** Lo mínimo de un movimiento bancario que hace falta para agrupar. */
export type MovimientoParaAgrupar = {
  reference: string | null;
  debit: { toString(): string };
  estado: string;
  date: Date | null;
  companyCode: string;
  companyName: string;
  /**
   * true si la fila viene de una planilla de REGISTRO de órdenes de compra
   * ("Órdenes de compra RHO/Panimávida"): una fila por orden con su monto
   * TOTAL. false si viene de una cartola (los pagos efectivos). La distinción
   * es imprescindible: la misma OC vive en las dos fuentes con la misma
   * referencia, y sumarlas cuenta la plata dos veces — verificado contra la
   * base real: en 63 OCs completas la fila del registro es EXACTAMENTE igual
   * a la suma de sus pagos de cartola.
   */
  esRegistroOC: boolean;
};

/** Un movimiento con el detalle necesario para listar sus abonos en pantalla. */
export type MovimientoAbono = MovimientoParaAgrupar & {
  id: string;
  description: string | null;
  rut: string | null;
  bankName: string | null;
  accountNumber: string | null;
};

/** Un abono individual dentro de un grupo (una transferencia parcial). */
export type AbonoDetalle = {
  id: string;
  fecha: string | null; // ISO
  descripcion: string | null;
  monto: string;
  rut: string | null;
  banco: string | null;
  cuenta: string | null;
  estado: string;
  esRegistro: boolean;
};

/** Avance de una orden de compra: total, cuánto va pagado y qué falta. */
export type AvanceOC = {
  companyCode: string;
  companyName: string;
  referencia: string;
  total: string;
  avanzado: string;
  pendiente: string;
  /** 0-100, redondeado a entero. */
  porcentaje: number;
  /** Fecha más antigua entre los movimientos aún PENDIENTES (la próxima a pagar). */
  fechaProximoPago: string | null;
  cantidadMovimientos: number;
  /**
   * Los pagos de cartola superan el total que declara el registro de la orden
   * — típicamente una fila duplicada por re-importación. Sin esta marca el
   * total se "estiraba" hasta lo pagado y la orden aparecía saldada al 100%,
   * escondiendo justamente el sobrepago.
   */
  sobrepagado: boolean;
  /** Cuánto se pagó de más (0 si no hay sobrepago). */
  excedente: string;
};

/** Grupo de abonos por referencia: el avance más el detalle fila a fila. */
export type GrupoAbonos = AvanceOC & { abonos: AbonoDetalle[] };

/** Aviso: una OC con saldo pendiente cuya próxima fecha vence o ya venció. */
export type AvisoOC = AvanceOC & {
  /** Días hasta la próxima fecha de pago pendiente; negativo = vencida. */
  diasParaVencer: number;
};

export type EtapaParaAvisar = {
  label: string;
  percent: { toString(): string };
  dueMonth: number;
  amount: { toString(): string };
  capexItemId: string;
  descripcion: string;
  companyCode: string;
  companyName: string;
  budgetYear: number;
  currency: string;
};

export type AvisoCapex = {
  companyCode: string;
  companyName: string;
  capexItemId: string;
  descripcion: string;
  etapaLabel: string;
  percent: string;
  monto: string;
  dueMonth: number;
  budgetYear: number;
  currency: string;
  /** Meses hasta el mes de vencimiento; negativo = ya pasó. */
  mesesParaVencer: number;
};

/**
 * Agrupa movimientos por empresa + referencia OC####, distinguiendo las dos
 * fuentes donde vive una misma orden — sumarlas a secas cuenta la plata dos
 * veces (87 de las 93 OCs reales mezclan ambas). Y la fila del REGISTRO tiene
 * dos semánticas según su estado, verificadas contra los datos:
 *
 *  - Registro marcado pagado → es el TOTAL de la orden cerrada. En las 63 OCs
 *    completas la fila calza EXACTO con la suma de sus pagos de cartola
 *    (OC0005: registro $9.208.998 = 2 pagos de $4.604.499).
 *  - Registro PENDIENTE → es el SALDO POR PAGAR. OC0017 es un contrato en
 *    cuotas de $1,5M: 16 pagadas en cartola ($24M) y el registro dice justo
 *    los $21M restantes (14 cuotas), no el total de $45M.
 *
 * De ahí el modelo: avance = lo efectivamente pagado (cartolas, o el propio
 * registro si no hay cartolas), total = avance + saldo pendiente del registro.
 * Sin registro (OC solo de cartola): total = todos los pagos, avance = los no
 * pendientes. La fecha del próximo pago es la más antigua entre PENDIENTES.
 */
type MovFlexible = MovimientoParaAgrupar &
  Partial<Pick<MovimientoAbono, "id" | "description" | "rut" | "bankName" | "accountNumber">>;

type Acumulado = {
  companyCode: string;
  companyName: string;
  referencia: string;
  registroPendiente: Decimal;
  registroPagado: Decimal;
  cartolaPendiente: Decimal;
  cartolaPagada: Decimal;
  tieneRegistro: boolean;
  fechasPendientes: number[];
  n: number;
  abonos: AbonoDetalle[];
};

/** Acumulación compartida: la ÚNICA implementación de la semántica dual. */
function acumularPorReferencia(
  movimientos: MovFlexible[],
  filtroReferencia: ((ref: string) => boolean) | null,
): Acumulado[] {
  const grupos = new Map<string, Acumulado>();

  for (const m of movimientos) {
    if (!m.reference) continue;
    if (filtroReferencia && !filtroReferencia(m.reference)) continue;
    const monto = dec(m.debit);
    if (monto.lte(0)) continue;

    const key = `${m.companyCode}::${m.reference}`;
    let g = grupos.get(key);
    if (!g) {
      g = {
        companyCode: m.companyCode,
        companyName: m.companyName,
        referencia: m.reference,
        registroPendiente: dec(0),
        registroPagado: dec(0),
        cartolaPendiente: dec(0),
        cartolaPagada: dec(0),
        tieneRegistro: false,
        fechasPendientes: [],
        n: 0,
        abonos: [],
      };
      grupos.set(key, g);
    }
    if (m.esRegistroOC) {
      g.tieneRegistro = true;
      if (m.estado === "PENDIENTE") g.registroPendiente = g.registroPendiente.plus(monto);
      else g.registroPagado = g.registroPagado.plus(monto);
    } else {
      if (m.estado === "PENDIENTE") g.cartolaPendiente = g.cartolaPendiente.plus(monto);
      else g.cartolaPagada = g.cartolaPagada.plus(monto);
    }
    if (m.estado === "PENDIENTE" && m.date) g.fechasPendientes.push(m.date.getTime());
    g.n += 1;
    g.abonos.push({
      id: m.id ?? `${key}#${g.n}`,
      fecha: m.date?.toISOString() ?? null,
      descripcion: m.description ?? null,
      monto: monto.toFixed(2),
      rut: m.rut ?? null,
      banco: m.bankName ?? null,
      cuenta: m.accountNumber ?? null,
      estado: m.estado,
      esRegistro: m.esRegistroOC,
    });
  }
  return [...grupos.values()];
}

/**
 * Del acumulado al avance. Con registro: los pagos de cartola son la verdad
 * del avance (si no hay ninguno, manda el estado del propio registro — la
 * orden pudo cerrarse antes de las cartolas importadas; max() y no suma
 * porque en las OCs cerradas ambas fuentes son la misma plata), y el total es
 * avance + saldo pendiente del registro. Sin registro: total = todos los
 * pagos, avance = los no pendientes.
 */
function aAvance(g: Acumulado): AvanceOC {
  let avanzado: Decimal;
  let total: Decimal;
  let sobrepagado = false;
  let excedente = dec(0);
  if (g.tieneRegistro) {
    avanzado = Decimal.max(g.cartolaPagada, g.registroPagado);
    total = avanzado.plus(g.registroPendiente);
    // Solo el registro PAGADO declara cuánto vale la orden entera (el
    // pendiente declara el saldo, que no dice nada del total — ver OC0017).
    // Si contra un total declarado las cartolas pagaron de más, NO se estira
    // el total: se deja el declarado y se marca el sobrepago, que es
    // justamente lo que alguien tiene que ir a revisar (típicamente una fila
    // duplicada por re-importación).
    const declarado = g.registroPagado;
    if (declarado.gt(0) && g.registroPendiente.isZero() && g.cartolaPagada.gt(declarado)) {
      sobrepagado = true;
      excedente = g.cartolaPagada.minus(declarado);
      total = declarado;
      avanzado = declarado;
    }
  } else {
    avanzado = g.cartolaPagada;
    total = g.cartolaPagada.plus(g.cartolaPendiente);
  }
  const pendiente = total.minus(avanzado);
  const fechaProx = g.fechasPendientes.length > 0 ? new Date(Math.min(...g.fechasPendientes)) : null;
  return {
    companyCode: g.companyCode,
    companyName: g.companyName,
    referencia: g.referencia,
    total: total.toFixed(2),
    avanzado: avanzado.toFixed(2),
    pendiente: pendiente.toFixed(2),
    porcentaje: total.isZero()
      ? 0
      : avanzado.div(total).times(100).toDecimalPlaces(0, Decimal.ROUND_DOWN).toNumber(),
    fechaProximoPago: fechaProx?.toISOString() ?? null,
    cantidadMovimientos: g.n,
    sobrepagado,
    excedente: excedente.toFixed(2),
  };
}

export function agruparAvancesOC(movimientos: MovimientoParaAgrupar[]): AvanceOC[] {
  const avances = acumularPorReferencia(movimientos, (ref) => PATRON_OC.test(ref)).map(aAvance);
  // Las más atrasadas primero; las sin fecha al final, ordenadas por referencia.
  return avances.sort((a, b) => {
    if (a.fechaProximoPago && b.fechaProximoPago) return a.fechaProximoPago.localeCompare(b.fechaProximoPago);
    if (a.fechaProximoPago) return -1;
    if (b.fechaProximoPago) return 1;
    return a.referencia.localeCompare(b.referencia);
  });
}

/**
 * Abonos por referencia — la vista inicial de Bancos. Generaliza el avance a
 * CUALQUIER referencia (Factura 541, OC0017, un proveedor), no solo OC####:
 * el caso real Resintech es una factura pagada en 4 abonos parciales. Solo
 * entran los grupos que cuentan una historia de abonos: los que tienen
 * registro (total declarado) o más de un movimiento. La diferencia
 * (Total − Abonado) viaja calculada con Decimal — nunca en el cliente.
 */
/**
 * Una referencia es un DOCUMENTO (factura, OC, boleta) si lleva números:
 * "Factura 541", "OC0017". Las categorías recurrentes de cartola no los
 * llevan: "Remuneración", "Caja", "Previred", "Notaría". Sin este filtro,
 * las 80 filas "Remuneración" de la cartola real armaban un "grupo" de $200
 * millones que, por tener saldo pendiente, encabezaba la pantalla inicial
 * por encima de las facturas de verdad.
 */
const PARECE_DOCUMENTO = /\d/;

export function agruparAbonosPorReferencia(movimientos: MovimientoAbono[]): GrupoAbonos[] {
  return acumularPorReferencia(movimientos, null)
    .filter((g) => (g.tieneRegistro || g.n >= 2) && PARECE_DOCUMENTO.test(g.referencia))
    .map((g) => ({
      ...aAvance(g),
      abonos: [...g.abonos].sort((a, b) => {
        if (a.fecha && b.fecha) return a.fecha.localeCompare(b.fecha);
        if (a.fecha) return -1;
        if (b.fecha) return 1;
        return 0;
      }),
    }))
    .sort((a, b) => {
      // Con saldo pendiente primero (mayor diferencia arriba); después completas.
      const pa = dec(a.pendiente);
      const pb = dec(b.pendiente);
      if (!pa.isZero() || !pb.isZero()) return pb.comparedTo(pa);
      return a.referencia.localeCompare(b.referencia);
    });
}

/**
 * De todos los avances, las OCs que merecen aviso: tienen saldo pendiente y
 * su próxima fecha de pago vence dentro de la ventana o ya venció. Las OCs
 * sin fecha en sus pendientes no pueden avisar "por vencer" — quedan fuera
 * del aviso pero siguen visibles en la sección de avance de Bancos.
 */
/**
 * Días de CALENDARIO entre dos fechas (UTC), ignorando la hora. Dividir
 * milisegundos crudos corre un día: los movimientos se guardan a las 12:00Z,
 * y "vence hoy" a las 15:00 daría floor(-0.125) = -1 ("vencida hace 1 día").
 */
export function diasDeCalendario(desde: Date, hasta: Date): number {
  const d0 = Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), desde.getUTCDate());
  const d1 = Date.UTC(hasta.getUTCFullYear(), hasta.getUTCMonth(), hasta.getUTCDate());
  return Math.round((d1 - d0) / 86_400_000);
}

export function avisosDeOC(
  avances: AvanceOC[],
  hoy: Date,
  ventanaDias: number = DIAS_POR_VENCER,
): AvisoOC[] {
  const avisos: AvisoOC[] = [];
  for (const a of avances) {
    if (dec(a.pendiente).lte(0)) continue;
    if (!a.fechaProximoPago) continue;
    const dias = diasDeCalendario(hoy, new Date(a.fechaProximoPago));
    if (dias > ventanaDias) continue;
    avisos.push({ ...a, diasParaVencer: dias });
  }
  return avisos.sort((a, b) => a.diasParaVencer - b.diasParaVencer);
}

/**
 * OCs con saldo pendiente cuyos pagos pendientes no traen fecha: no pueden
 * avisar "por vencer", pero ignorarlas en silencio escondería plata por pagar
 * (en los datos reales el registro de OCs no trae fechas: son la mayoría).
 * El panel las resume en una línea con total, en vez de listarlas una a una.
 */
export function pendientesSinFecha(avances: AvanceOC[]): { cantidad: number; total: string } {
  let cantidad = 0;
  let total = dec(0);
  for (const a of avances) {
    if (dec(a.pendiente).lte(0)) continue;
    if (a.fechaProximoPago) continue;
    cantidad += 1;
    total = total.plus(dec(a.pendiente));
  }
  return { cantidad, total: total.toFixed(2) };
}

/**
 * Etapas de CAPEX no pagadas que vencen este mes, el próximo, o ya vencieron.
 * Solo del año presupuestario en curso: una etapa de otro año no es un
 * desembolso próximo real.
 */
export function avisosDeEtapas(etapas: EtapaParaAvisar[], hoy: Date): AvisoCapex[] {
  const mesActual = hoy.getMonth() + 1;
  const anioActual = hoy.getFullYear();

  const avisos: AvisoCapex[] = [];
  for (const e of etapas) {
    if (e.budgetYear !== anioActual) continue;
    const meses = e.dueMonth - mesActual;
    if (meses > 1) continue;

    const monto = dec(e.amount).times(dec(e.percent)).div(100);
    avisos.push({
      companyCode: e.companyCode,
      companyName: e.companyName,
      capexItemId: e.capexItemId,
      descripcion: e.descripcion,
      etapaLabel: e.label,
      percent: dec(e.percent).toFixed(2),
      monto: monto.toFixed(2),
      dueMonth: e.dueMonth,
      budgetYear: e.budgetYear,
      currency: e.currency,
      mesesParaVencer: meses,
    });
  }
  return avisos.sort((a, b) => a.mesesParaVencer - b.mesesParaVencer);
}

/**
 * Suma de porcentajes de un cronograma. El server action exige que agregar
 * una etapa no pase de 100 — acá está el cálculo para validarlo y testearlo.
 */
export function sumaPorcentajes(percents: Array<{ toString(): string }>): Decimal {
  return percents.reduce<Decimal>((acc, p) => acc.plus(dec(p)), dec(0));
}

// ─────────────── Sugerencia de "pagado" para líneas de gasto ───────────────

export type LineaParaSugerir = {
  id: string;
  /** Montos mensuales presupuestados, como strings (m01..m12). */
  montos: Array<{ toString(): string }>;
};

export type MovimientoParaSugerir = {
  reference: string | null;
  description: string | null;
  debit: { toString(): string };
  estado: string;
  date: Date | null;
};

export type SugerenciaPago = {
  lineId: string;
  referencia: string;
  monto: string;
  fecha: string | null;
};

/**
 * Entre ExpenseLine y BankMovement no hay clave de unión (ni RUT ni número de
 * orden compartido) — se verificó contra los datos reales. Por eso el cruce es
 * solo una SUGERENCIA por coincidencia de monto: si un movimiento que ya salió
 * del circuito (no PENDIENTE) calza ±1% con algún mes de la línea, se ofrece.
 * Nunca marca solo: la confirmación es siempre de una persona.
 *
 * Dos resguardos que salieron de auditar los calces contra los datos reales:
 *  - Solo movimientos FECHADOS EN EL AÑO del presupuesto. Sin esto, 7 de las
 *    9 sugerencias de RHO 2026 calzaban con pagos de 2024/2025 — montos
 *    redondos ($3M, $500k) calzan de casualidad con cualquier año.
 *  - Cada movimiento se sugiere a UNA sola línea (asignación golosa por mejor
 *    calce). Sin esto, un mismo pago real se ofrecía a dos líneas y ambas se
 *    podían "Confirmar" con una sola salida de plata.
 */
export function sugerenciasDePago(
  lineas: LineaParaSugerir[],
  movimientos: MovimientoParaSugerir[],
  anioPresupuesto?: number,
): SugerenciaPago[] {
  const pagados = movimientos
    .filter((m) => m.estado !== "PENDIENTE")
    .filter((m) =>
      anioPresupuesto === undefined
        ? true
        : m.date !== null && m.date.getUTCFullYear() === anioPresupuesto,
    )
    .map((m) => ({ ...m, monto: dec(m.debit) }))
    .filter((m) => m.monto.gt(0));
  if (pagados.length === 0) return [];

  // Todos los calces candidatos, y después asignación golosa: el mejor calce
  // global primero, consumiendo línea y movimiento.
  type Candidato = { linea: LineaParaSugerir; mov: (typeof pagados)[number]; diff: Decimal };
  const candidatos: Candidato[] = [];
  for (const linea of lineas) {
    for (const raw of linea.montos) {
      const objetivo = dec(raw);
      if (objetivo.lte(0)) continue;
      const tolerancia = objetivo.times("0.01");
      for (const mov of pagados) {
        const diff = mov.monto.minus(objetivo).abs();
        if (diff.lte(tolerancia)) candidatos.push({ linea, mov, diff });
      }
    }
  }
  candidatos.sort((a, b) => a.diff.comparedTo(b.diff));

  const lineasUsadas = new Set<string>();
  const movsUsados = new Set<(typeof pagados)[number]>();
  const sugerencias: SugerenciaPago[] = [];
  for (const c of candidatos) {
    if (lineasUsadas.has(c.linea.id) || movsUsados.has(c.mov)) continue;
    lineasUsadas.add(c.linea.id);
    movsUsados.add(c.mov);
    sugerencias.push({
      lineId: c.linea.id,
      referencia: c.mov.reference ?? c.mov.description ?? "movimiento bancario",
      monto: c.mov.monto.toFixed(2),
      fecha: c.mov.date?.toISOString() ?? null,
    });
  }
  return sugerencias;
}
