import "server-only";
import { prisma } from "@/lib/prisma";
import { MONTH_KEYS } from "@/lib/money";
import {
  agruparAvancesOC,
  avisosDeOC,
  avisosDeEtapas,
  pendientesSinFecha,
  sugerenciasDePago,
  type AvanceOC,
  type AvisoOC,
  type AvisoCapex,
  type SugerenciaPago,
} from "@/lib/avisos-core";

/**
 * Avisos de pago — calculados en el momento, sin tabla de "notificaciones
 * leídas": se recalculan al entrar, así que nunca quedan desincronizados con
 * el estado real. La lógica vive en avisos-core.ts (pura, testeada); acá solo
 * están las consultas.
 *
 * Estas funciones NO validan permisos: el llamador decide el alcance pasando
 * `companyId` (encargado → su empresa; circuito de pagos → todas).
 */

export type Avisos = {
  ocs: AvisoOC[];
  capex: AvisoCapex[];
  /**
   * OCs con saldo pendiente cuyos pagos no traen fecha: no pueden avisar
   * "por vencer" (en los datos reales son la mayoría — el registro de OCs
   * no trae fechas). Se resumen en una línea para no esconder plata por pagar.
   */
  ocsSinFecha: { cantidad: number; total: string };
};

export type { AvanceOC, AvisoOC, AvisoCapex };

/**
 * Distingue las planillas de REGISTRO de órdenes de compra (una fila por
 * orden, con su total) de las cartolas (pagos efectivos). La misma OC vive en
 * ambas con la misma referencia: sin esta marca se contaría doble.
 */
const esPlanillaRegistroOC = (nombre: string) => /órdenes?\s+de\s+compra/i.test(nombre);

async function movimientosParaAgrupar(companyId?: string) {
  const movimientos = await prisma.bankMovement.findMany({
    where: {
      debit: { gt: 0 },
      reference: { not: null },
      ...(companyId ? { sheet: { companyId } } : {}),
    },
    select: {
      reference: true,
      debit: true,
      estado: true,
      date: true,
      sheet: { select: { name: true, company: { select: { code: true, name: true } } } },
    },
  });
  return movimientos.map((m) => ({
    reference: m.reference,
    debit: m.debit,
    estado: m.estado,
    date: m.date,
    companyCode: m.sheet.company.code,
    companyName: m.sheet.company.name,
    esRegistroOC: esPlanillaRegistroOC(m.sheet.name),
  }));
}

/** Avance de todas las órdenes de compra (para la sección de Bancos). */
export async function avancesOC(companyId?: string): Promise<AvanceOC[]> {
  return agruparAvancesOC(await movimientosParaAgrupar(companyId));
}

/** Los avisos del panel: OCs por vencer/vencidas + etapas CAPEX próximas. */
export async function calcularAvisos(companyId?: string): Promise<Avisos> {
  const hoy = new Date();
  const [movs, etapas] = await Promise.all([
    movimientosParaAgrupar(companyId),
    prisma.capexPaymentStage.findMany({
      where: {
        paid: false,
        ...(companyId ? { capexItem: { budget: { companyId } } } : {}),
      },
      select: {
        label: true,
        percent: true,
        dueMonth: true,
        capexItem: {
          select: {
            id: true,
            description: true,
            initiativeName: true,
            amount: true,
            currency: true,
            budget: { select: { year: true, company: { select: { code: true, name: true } } } },
          },
        },
      },
    }),
  ]);

  const avances = agruparAvancesOC(movs);
  return {
    ocs: avisosDeOC(avances, hoy),
    ocsSinFecha: pendientesSinFecha(avances),
    capex: avisosDeEtapas(
      etapas.map((e) => ({
        label: e.label,
        percent: e.percent,
        dueMonth: e.dueMonth,
        amount: e.capexItem.amount,
        capexItemId: e.capexItem.id,
        descripcion: e.capexItem.initiativeName ?? e.capexItem.description,
        companyCode: e.capexItem.budget.company.code,
        companyName: e.capexItem.budget.company.name,
        budgetYear: e.capexItem.budget.year,
        currency: e.capexItem.currency,
      })),
      hoy,
    ),
  };
}

/** Total de avisos, para un badge compacto ("3 avisos") sin desglosar. */
export function contarAvisos(a: Avisos): number {
  return a.ocs.length + a.capex.length;
}

export type { SugerenciaPago };

/**
 * Sugerencias de "pagado" para las líneas de gasto de un presupuesto, cruzando
 * por monto (±1%) contra los movimientos bancarios que ya salieron del
 * circuito. Solo sugiere sobre líneas aún no marcadas; la confirmación es
 * siempre de una persona (ver sugerenciasDePago en avisos-core).
 */
export async function sugerenciasPagoGastos(budgetId: string): Promise<SugerenciaPago[]> {
  const budget = await prisma.budget.findUnique({
    where: { id: budgetId },
    select: { companyId: true, year: true },
  });
  if (!budget) return [];

  const [lineas, movimientos] = await Promise.all([
    prisma.expenseLine.findMany({
      where: { budgetId, paid: false },
      select: {
        id: true,
        m01: true, m02: true, m03: true, m04: true, m05: true, m06: true,
        m07: true, m08: true, m09: true, m10: true, m11: true, m12: true,
      },
    }),
    prisma.bankMovement.findMany({
      where: {
        estado: { not: "PENDIENTE" },
        debit: { gt: 0 },
        sheet: { companyId: budget.companyId },
      },
      select: { reference: true, description: true, debit: true, estado: true, date: true },
    }),
  ]);

  return sugerenciasDePago(
    lineas.map((l) => ({ id: l.id, montos: MONTH_KEYS.map((k) => l[k]) })),
    movimientos,
    budget.year,
  );
}
