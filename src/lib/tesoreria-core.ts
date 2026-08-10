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
import { dec } from "./money";

/**
 * Nombre visible de la planilla donde caen las cargas hechas a mano. Vive acá
 * —y no en actions.ts— porque un módulo "use server" solo puede exportar
 * funciones async, y esta constante la necesitan también la subida de planillas
 * y la página.
 *
 * Es COSMÉTICO: lo que identifica esa planilla es la columna `manual`. El
 * nombre se reserva igual para que una hoja de Excel llamada así no la pise.
 */
export const PLANILLA_MANUAL = "Cargas manuales";

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

/**
 * Lee un monto escrito a mano y devuelve el string canónico "12345.67", o el
 * MOTIVO por el que no se entiende. Nunca adivina.
 *
 * El parser anterior (`normalizarMonto`) fallaba en silencio, y eso con plata
 * es peor que fallar fuerte — verificado ejecutándolo:
 *   "1,234.56"      → 1.23              (dividía por mil)
 *   "250000000.555" → 250000000555.00   (multiplicaba por mil)
 *   "-350.000"      → 350000.00         (borraba el signo)
 *   "abc" "(1.500)" "5%" "1e9"          → 0, o un número inventado
 *
 * Reglas, pensadas para pesos chilenos:
 *  - Solo dígitos, puntos y comas (después de sacar "$" y espacios). Cualquier
 *    otra cosa —signo, letras, paréntesis, notación científica— se rechaza
 *    diciendo qué pasó, en vez de convertirse en cero.
 *  - Si vienen los DOS separadores, el ÚLTIMO es el decimal. Así "1.500.000,50"
 *    (es-CL) y "1,234.56" (pegado de un Excel en inglés) se leen bien los dos.
 *  - Con un solo tipo de separador en grupos de tres exactos ("1.500",
 *    "1.500.000") es separador de miles: es como se escribe acá.
 *  - Si no forma grupos de tres, es coma decimal: "1500000,50" → 1500000.50.
 *  - Máximo 2 decimales y 16 enteros (la columna es Decimal(18,2)).
 */
export type MontoLeido = { ok: true; valor: string } | { ok: false; motivo: string };

const SOLO_MONTO = /^[\d.,]+$/;
const gruposDeTres = (s: string, sep: string) =>
  new RegExp(`^\\d{1,3}(\\${sep}\\d{3})+$`).test(s);

export function parsearMonto(entrada: unknown): MontoLeido {
  const crudo = String(entrada ?? "").trim();
  // «$1.500.000.-» y «1.500.-» es como se escribe un monto en una factura o
  // cotización chilena: ese guion final es adorno tipográfico, no un signo. Se
  // saca ANTES de buscar negativos — si no, el usuario recibe «elegí Abono
  // recibido» sobre un egreso que escribió perfectamente bien.
  const limpio = crudo.replace(/[\s ]/g, "").replace(/\$/g, "").replace(/[.,]-$/, "");

  if (limpio === "") return { ok: false, motivo: "Escribí el monto" };
  if (/-/.test(limpio) || /^\(.*\)$/.test(crudo.replace(/[\s ]/g, ""))) {
    return { ok: false, motivo: "El monto va sin signo negativo: elegí «Abono recibido» si es plata que entra" };
  }
  if (!SOLO_MONTO.test(limpio)) {
    return { ok: false, motivo: `«${crudo}» no es un monto: solo números, puntos y comas` };
  }

  const puntos = (limpio.match(/\./g) ?? []).length;
  const comas = (limpio.match(/,/g) ?? []).length;

  let enteros = limpio;
  let decimales = "";

  if (puntos > 0 && comas > 0) {
    // Los dos separadores: el último manda como decimal, el otro es de miles.
    const decSep = limpio.lastIndexOf(",") > limpio.lastIndexOf(".") ? "," : ".";
    const milSep = decSep === "," ? "." : ",";
    const corte = limpio.lastIndexOf(decSep);
    enteros = limpio.slice(0, corte);
    decimales = limpio.slice(corte + 1);
    if (limpio.slice(corte + 1).includes(milSep) || !gruposDeTres(enteros, milSep)) {
      return { ok: false, motivo: `«${crudo}» mezcla puntos y comas de un modo que no se entiende` };
    }
    enteros = enteros.split(milSep).join("");
  } else if (puntos > 0 || comas > 0) {
    const sep = puntos > 0 ? "." : ",";
    const n = puntos > 0 ? puntos : comas;
    if (gruposDeTres(limpio, sep)) {
      enteros = limpio.split(sep).join(""); // separador de miles
    } else if (n === 1) {
      const corte = limpio.indexOf(sep);
      enteros = limpio.slice(0, corte);
      decimales = limpio.slice(corte + 1);
    } else {
      return { ok: false, motivo: `«${crudo}» tiene los separadores mal puestos` };
    }
  }

  if (enteros === "") enteros = "0";
  if (decimales.length > 2) {
    return { ok: false, motivo: `«${crudo}» tiene más de 2 decimales — los pesos van con 2 como máximo` };
  }
  if (enteros.length > 16) return { ok: false, motivo: "El monto es demasiado grande" };

  return { ok: true, valor: `${enteros}.${decimales.padEnd(2, "0")}` };
}

export type MovimientoLiberable = {
  debit: { toString(): string } | null;
  credit: { toString(): string } | null;
  reference: string | null;
  /** Necesaria para reconocer la fila de totales de la planilla (no la tiene). */
  date?: Date | string | null;
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
 *  - La fila de TOTALES de la cartola: no es un movimiento, es la suma de la
 *    hoja. Se cuela en la importación y hasta acá pasaba los tres filtros
 *    anteriores porque tiene débito. En la base real son dos —CC Santander por
 *    $1.744.717.286 y CC BICE por $65.630.020, las dos PENDIENTES— y el
 *    servidor las habría dejado entrar a un lote.
 */
export function motivoNoLiberable(m: MovimientoLiberable): string | null {
  const nombre = m.reference ?? "movimiento";
  const debe = dec(String(m.debit ?? 0)).abs();
  const abona = dec(String(m.credit ?? 0)).abs();
  if (debe.lte(0) && abona.gt(0)) return `"${nombre}" es un abono recibido, no un pago a transferir`;
  if (debe.lte(0)) return `"${nombre}" no tiene monto a pagar`;

  // La firma de una fila de totales: suma cargos Y abonos a la vez, y no tiene
  // ni referencia ni fecha porque no describe una operación. Las tres
  // condiciones juntas hacen falta — las 98 filas del registro de órdenes de
  // compra también traen débito y crédito, pero todas llevan su referencia.
  if (debe.gt(0) && abona.gt(0) && !m.reference && !m.date) {
    return "esta es la fila de TOTALES de la planilla, no un pago: es la suma de la hoja. Borrala o corregila con Editar";
  }

  if (esPlanillaRegistroOC(m.sheet.name)) {
    return `"${nombre}" es una línea del registro de órdenes de compra (el saldo total de la orden), no una transferencia — liberá las cuotas de la cartola`;
  }
  return null;
}
