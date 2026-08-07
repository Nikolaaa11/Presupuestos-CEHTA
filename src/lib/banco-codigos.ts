/**
 * Códigos SBIF/CMF de los bancos chilenos, para la columna "Código banco
 * destino" del formato de transferencias masivas de Santander (verificado
 * contra los archivos reales del fondo: Banco de Chile=1, Scotiabank=14,
 * Santander=37).
 *
 * El matching es por nombre normalizado y tolerante: las planillas traen
 * "Banco de Chile", "BCO CHILE", "Scotiabank Azul", "Bci", etc.
 */

/**
 * EL ORDEN IMPORTA y no es alfabético: gana el primer patrón que calce.
 *
 * Casi todos los bancos que operan en Chile llevan "Chile" en su razón social
 * ("Banco Santander-Chile" es el nombre LEGAL de Santander, y así aparece en
 * las cartolas). Si el patrón /chile/ se probara primero, se quedaría con
 * TODOS: la revisión adversarial verificó que "Banco Santander Chile" daba
 * código 1 (Banco de Chile) — un código válido pero equivocado, que manda la
 * transferencia al banco que no es. Por eso las MARCAS van primero y "Banco
 * de Chile" queda al final, como último recurso.
 */
const MARCAS: ReadonlyArray<{ codigo: number; nombre: string; patrones: RegExp[] }> = [
  { codigo: 37, nombre: "Banco Santander", patrones: [/santander/] },
  { codigo: 14, nombre: "Scotiabank", patrones: [/scotia/, /\bbbva\b/, /\bazul\b/] },
  { codigo: 16, nombre: "BCI", patrones: [/\bbci\b/, /credito e inversiones/, /\bmach\b/] },
  { codigo: 12, nombre: "Banco del Estado", patrones: [/\bestado\b/, /bancoestado/] },
  { codigo: 39, nombre: "Itaú", patrones: [/ita[uú]/, /corpbanca/] },
  { codigo: 28, nombre: "Banco BICE", patrones: [/\bbice\b/] },
  { codigo: 31, nombre: "HSBC", patrones: [/hsbc/] },
  { codigo: 49, nombre: "Banco Security", patrones: [/security/] },
  { codigo: 51, nombre: "Banco Falabella", patrones: [/falabella/] },
  { codigo: 53, nombre: "Banco Ripley", patrones: [/ripley/] },
  { codigo: 55, nombre: "Banco Consorcio", patrones: [/consorcio/] },
  { codigo: 9, nombre: "Banco Internacional", patrones: [/internacional/] },
  { codigo: 672, nombre: "Coopeuch", patrones: [/coopeuch/] },
  { codigo: 729, nombre: "Tenpo", patrones: [/tenpo/] },
  { codigo: 730, nombre: "Mercado Pago", patrones: [/mercado\s*pago/] },
];

/** Solo si ninguna marca calzó: acá "Chile" sí significa Banco de Chile. */
const ULTIMO_RECURSO: ReadonlyArray<{ codigo: number; nombre: string; patrones: RegExp[] }> = [
  { codigo: 1, nombre: "Banco de Chile", patrones: [/\bchile\b/, /\bedwards\b/] },
];

const CODIGOS = [...MARCAS, ...ULTIMO_RECURSO];

function normalizar(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\bbco\.?\b/g, "banco")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Código SBIF del banco, o null si no se reconoce (la celda queda vacía y el
 * Resumen lo advierte — inventar un código mandaría la plata a otro banco).
 */
export function codigoBanco(nombre: string | null): number | null {
  if (!nombre) return null;
  const n = normalizar(nombre);
  if (n === "") return null;
  for (const banco of CODIGOS) {
    if (banco.patrones.some((p) => p.test(n))) return banco.codigo;
  }
  return null;
}

/** Dígito verificador de un RUT chileno (módulo 11). */
function digitoVerificador(cuerpo: string): string {
  let suma = 0;
  let factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return "0";
  if (resto === 10) return "K";
  return String(resto);
}

/**
 * RUT al formato que exige la carga masiva: sin puntos ni guión, con dígito
 * verificador pegado — "76.058.363-4" → "760583634" (así viene en los
 * archivos reales del banco).
 *
 * VALIDA el dígito verificador, no solo la forma: un RUT sin DV ("76.058.363")
 * o con el DV cambiado se transforma en OTRO contribuyente con pinta válida y
 * la transferencia sale igual. Ante la duda va null: la celda queda vacía y el
 * Resumen lo advierte, que es recuperable — mandarle plata a otro RUT no.
 */
export function rutParaBanco(rut: string | null): string | null {
  if (!rut) return null;
  const limpio = rut.replace(/[.\s-]/g, "").toUpperCase();
  if (!/^\d{7,8}[\dK]$/.test(limpio)) return null;
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  return digitoVerificador(cuerpo) === dv ? limpio : null;
}
