/**
 * Reglas puras del circuito de pagos — sin Prisma ni `server-only`, para que
 * las importen los server actions y los tests por igual (mismo patrón que
 * budget-policy.ts y avisos-core.ts).
 */

/**
 * Una planilla de REGISTRO de órdenes de compra ("Órdenes de compra RHO") es
 * un listado de órdenes con su monto total o su saldo — NO son transferencias
 * ejecutables. Se distingue de las cartolas (pagos efectivos) para dos cosas:
 * no contar la plata dos veces en el avance, y no dejar que una fila de
 * registro se libere como si fuera un pago.
 */
export const esPlanillaRegistroOC = (nombre: string) =>
  // Tolerante a la tilde: "Ordenes de compra" (sin tilde, típico al tipear el
  // nombre de la hoja) tiene que reconocerse igual — si no, esa planilla se
  // trataría como cartola: contaría la plata dos veces y sus filas serían
  // liberables como si fueran transferencias.
  // `orden(es)?` y no `ordenes?`: este último exige "ordene" y por lo tanto
  // el singular "Orden de compra" nunca matcheaba.
  /orden(es)?\s+de\s+compra/i.test(
    nombre.normalize("NFD").replace(/[̀-ͯ]/g, ""),
  );

export type MovimientoLiberable = {
  debit: { toString(): string } | null;
  credit: { toString(): string } | null;
  reference: string | null;
  sheet: { name: string };
};

/**
 * Qué NO puede entrar a un lote de transferencias, por más que esté PENDIENTE.
 * Devuelve el motivo (para mostrárselo a quien intenta liberar) o null si la
 * fila es un pago legítimo.
 *
 *  - Un ABONO (plata que entró: credit > 0, debit = 0). Liberarlo pondría en
 *    la nómina una orden de transferir ESA plata hacia afuera, con los datos
 *    bancarios de quien nos pagó.
 *  - Una fila de REGISTRO de orden de compra: liberarla pagaría el saldo
 *    completo de la orden de una vez, duplicando las cuotas que igual van a
 *    seguir llegando por cartola.
 */
export function motivoNoLiberable(m: MovimientoLiberable): string | null {
  const nombre = m.reference ?? "movimiento";
  const debe = Math.abs(Number(String(m.debit ?? 0)));
  const abona = Math.abs(Number(String(m.credit ?? 0)));
  if (debe <= 0 && abona > 0) return `"${nombre}" es un abono recibido, no un pago a transferir`;
  if (debe <= 0) return `"${nombre}" no tiene monto a pagar`;
  if (esPlanillaRegistroOC(m.sheet.name)) {
    return `"${nombre}" es una línea del registro de órdenes de compra (el saldo total de la orden), no una transferencia — liberá las cuotas de la cartola`;
  }
  return null;
}
