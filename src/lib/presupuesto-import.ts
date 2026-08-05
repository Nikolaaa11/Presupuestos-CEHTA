import { normalizeHeader, toMoney, type CellValue } from "./bank-import";
import { MONTH_KEYS, type MonthKey } from "./money";

/**
 * Parser de plantillas de presupuesto (Ventas, Gastos, CAPEX) — Fase 2 de
 * importación. Puro y testeable, mismo estilo que bank-import.ts: trabaja
 * sobre arrays de filas (AOA), detecta la fila de encabezados por alias
 * tolerantes (acentos, mayúsculas, "Ene"/"Enero"), convierte montos es-CL y
 * devuelve, además de las filas buenas, los RECHAZOS con fila y motivo — el
 * usuario tiene que poder saber exactamente qué de su Excel no entró y por qué.
 *
 * LA PLANTILLA MANDA: el archivo debe traer TODAS las columnas de la plantilla
 * oficial (los NOMBRES son tolerantes, la presencia no). La revisión
 * adversarial demostró que aceptar archivos parciales pierde plata en
 * silencio: una planilla Ene–Jun pisaba jul–dic con ceros, un capex sin
 * columna Moneda convertía UF→CLP y recalculaba mal el nivel de aprobación.
 * Por eso un encabezado incompleto no es "viable" y el error dice qué falta.
 *
 * CELDA vacía ≠ COLUMNA ausente: la columna está pero la celda quedó en
 * blanco → en los opcionales el valor va `undefined`/`null` y el server
 * decide (crear con default, actualizar preservando lo existente). Los meses
 * en blanco sí son 0: la fila es la foto completa del año, ese es el contrato.
 *
 * Las filas de EJEMPLO de la plantilla (prefijo "EJEMPLO") se rechazan con
 * motivo: subir la plantilla sin editar no infla el presupuesto con ficticios.
 */

const PATRON_EJEMPLO = /^ejemplo\b/i;

export type Modulo = "ventas" | "gastos" | "capex";

export type MesesString = Record<MonthKey, string>;

export type FilaVentas = {
  rowIndex: number;
  client: string;
  /** undefined = celda vacía: crear con default, actualizar sin tocar. */
  saleType?: "CONTRATO" | "PROYECCION_PUBLICO" | "RECURRENTE";
  /** null = celda vacía: crear en null, actualizar sin tocar. */
  channel: string | null;
  meses: MesesString;
};

export type FilaGastos = {
  rowIndex: number;
  categoria: string; // obligatoria por fila — sin ella el upsert duplicaría bajo "Otros"
  item: string;
  meses: MesesString;
};

export type FilaCapex = {
  rowIndex: number;
  description: string;
  purpose: string | null;
  amount: string;
  /** undefined = celda vacía: crear CLP, actualizar preservando la moneda actual. */
  currency?: "CLP" | "UF" | "USD";
  monthNeeded: number; // 1..12
  financingMonths: number | null;
  /** undefined = celda vacía: crear CAJA_PROPIA, actualizar sin tocar. */
  financingSource?: "CAJA_PROPIA" | "BANCO" | "FONDO" | "LEASING" | "MIXTO";
  initiativeName: string | null;
};

export type Rechazo = { rowIndex: number; motivo: string };

export type ResultadoImport<T> = {
  headerRowIndex: number;
  filas: T[];
  rechazos: Rechazo[];
  filasVacias: number;
};

// ─────────────────────────── Encabezados por módulo ───────────────────────────

const MESES_ALIASES: ReadonlyArray<[MonthKey, string[]]> = [
  ["m01", ["ene", "enero", "jan", "01", "1"]],
  ["m02", ["feb", "febrero", "02", "2"]],
  ["m03", ["mar", "marzo", "03", "3"]],
  ["m04", ["abr", "abril", "apr", "04", "4"]],
  ["m05", ["may", "mayo", "05", "5"]],
  ["m06", ["jun", "junio", "06", "6"]],
  ["m07", ["jul", "julio", "07", "7"]],
  ["m08", ["ago", "agosto", "aug", "08", "8"]],
  ["m09", ["sep", "septiembre", "sept", "setiembre", "09", "9"]],
  ["m10", ["oct", "octubre", "10"]],
  ["m11", ["nov", "noviembre", "11"]],
  ["m12", ["dic", "diciembre", "dec", "12"]],
];

type CampoTexto =
  | "cliente" | "tipo" | "canal" // ventas
  | "categoria" | "item" // gastos
  | "descripcion" | "proposito" | "monto" | "moneda" | "mesRequerido" | "plazo" | "fuente" | "iniciativa"; // capex

const TEXTO_ALIASES: ReadonlyArray<[CampoTexto, string[]]> = [
  ["cliente", ["cliente", "clientes"]],
  ["tipo", ["tipo", "tipo de venta", "tipo venta"]],
  ["canal", ["canal", "como se vende", "channel"]],
  ["categoria", ["categoria", "categorias"]],
  ["item", ["item", "items", "concepto", "gasto"]],
  ["descripcion", ["descripcion", "inversion", "que se compra"]],
  ["proposito", ["para que", "proposito", "objetivo"]],
  ["monto", ["monto", "monto total", "inversion total"]],
  ["moneda", ["moneda", "divisa"]],
  ["mesRequerido", ["mes requerido", "mes", "mes de la inversion"]],
  ["plazo", ["plazo", "plazo financiamiento", "plazo meses", "meses de financiamiento"]],
  ["fuente", ["fuente", "fuente financiamiento", "financiamiento", "fuente de financiamiento"]],
  ["iniciativa", ["iniciativa", "nombre iniciativa", "proyecto"]],
];

/** Columnas OBLIGATORIAS por módulo, con la etiqueta que se muestra al usuario. */
const COLUMNAS_REQUERIDAS: Record<Modulo, Array<{ campo: CampoTexto; etiqueta: string }>> = {
  ventas: [
    { campo: "cliente", etiqueta: "Cliente" },
    { campo: "tipo", etiqueta: "Tipo" },
    { campo: "canal", etiqueta: "Canal" },
  ],
  gastos: [
    { campo: "categoria", etiqueta: "Categoría" },
    { campo: "item", etiqueta: "Ítem" },
  ],
  capex: [
    { campo: "descripcion", etiqueta: "Inversión" },
    { campo: "proposito", etiqueta: "Para qué" },
    { campo: "monto", etiqueta: "Monto" },
    { campo: "moneda", etiqueta: "Moneda" },
    { campo: "mesRequerido", etiqueta: "Mes requerido" },
    { campo: "plazo", etiqueta: "Plazo" },
    { campo: "fuente", etiqueta: "Fuente" },
    { campo: "iniciativa", etiqueta: "Iniciativa" },
  ],
};

const MODULOS_CON_MESES: Modulo[] = ["ventas", "gastos"];

type Mapa = {
  meses: Partial<Record<MonthKey, number>>;
  campos: Partial<Record<CampoTexto, number>>;
};

function mapearFila(row: CellValue[]): Mapa {
  const mapa: Mapa = { meses: {}, campos: {} };
  row.forEach((celda, idx) => {
    const h = normalizeHeader(celda);
    if (!h) return;
    for (const [mes, aliases] of MESES_ALIASES) {
      if (aliases.includes(h) && mapa.meses[mes] === undefined) {
        mapa.meses[mes] = idx;
        return;
      }
    }
    for (const [campo, aliases] of TEXTO_ALIASES) {
      if (aliases.includes(h) && mapa.campos[campo] === undefined) {
        mapa.campos[campo] = idx;
        return;
      }
    }
  });
  return mapa;
}

/** Etiquetas de las columnas de la plantilla que faltan en este mapa. */
function faltantesDe(modulo: Modulo, mapa: Mapa): string[] {
  const falta: string[] = [];
  for (const { campo, etiqueta } of COLUMNAS_REQUERIDAS[modulo]) {
    if (mapa.campos[campo] === undefined) falta.push(etiqueta);
  }
  if (MODULOS_CON_MESES.includes(modulo)) {
    for (const [mes, aliases] of MESES_ALIASES) {
      if (mapa.meses[mes] === undefined) falta.push(aliases[0].replace(/^./, (c) => c.toUpperCase()));
    }
  }
  return falta;
}

export function buscarEncabezado(
  modulo: Modulo,
  rows: CellValue[][],
  maxScan = 12,
): { index: number; mapa: Mapa } | null {
  const limite = Math.min(rows.length, maxScan);
  for (let i = 0; i < limite; i++) {
    const mapa = mapearFila(rows[i] ?? []);
    if (faltantesDe(modulo, mapa).length === 0) return { index: i, mapa };
  }
  return null;
}

/**
 * Cuando no hay encabezado viable: el diagnóstico para el mensaje de error.
 * Toma la fila candidata que MÁS columnas reconoció y dice cuáles faltan —
 * "descargá la plantilla" a secas no le sirve a quien ya casi la tiene.
 */
export function diagnosticoEncabezado(
  modulo: Modulo,
  rows: CellValue[][],
  maxScan = 12,
): { faltantes: string[] } {
  const limite = Math.min(rows.length, maxScan);
  let mejor: string[] | null = null;
  let mejorReconocidas = -1;
  for (let i = 0; i < limite; i++) {
    const mapa = mapearFila(rows[i] ?? []);
    const reconocidas = Object.keys(mapa.campos).length + Object.keys(mapa.meses).length;
    if (reconocidas > mejorReconocidas) {
      mejorReconocidas = reconocidas;
      mejor = faltantesDe(modulo, mapa);
    }
  }
  return { faltantes: mejorReconocidas > 0 ? (mejor ?? []) : [] };
}

// ─────────────────────────── Conversores de valores ───────────────────────────

function texto(row: CellValue[], idx: number | undefined, max = 200): string | null {
  if (idx === undefined) return null;
  const v = row[idx];
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s === "" ? null : s.slice(0, max);
}

function normalizarPalabra(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Convención de los conversores de opcionales:
 *   celda vacía → undefined (el server decide: default al crear, preservar al actualizar)
 *   valor reconocido → el valor
 *   basura → null (la fila se rechaza con motivo)
 */
export function toSaleType(v: string | null): FilaVentas["saleType"] | null | undefined {
  if (!v) return undefined;
  const s = normalizarPalabra(v);
  if (s.startsWith("contrat")) return "CONTRATO";
  if (s.startsWith("proyec") || s.includes("publico")) return "PROYECCION_PUBLICO";
  if (s.startsWith("recurren") || s.includes("cartera")) return "RECURRENTE";
  return null;
}

export function toMoneda(v: string | null): FilaCapex["currency"] | null | undefined {
  if (!v) return undefined;
  const s = normalizarPalabra(v).replace(/\$/g, "");
  if (["clp", "peso", "pesos"].includes(s)) return "CLP";
  if (s === "uf") return "UF";
  if (["usd", "dolar", "dolares", "us"].includes(s)) return "USD";
  return null;
}

export function toFuente(v: string | null): FilaCapex["financingSource"] | null | undefined {
  if (!v) return undefined;
  const s = normalizarPalabra(v);
  if (s.includes("caja") || s.includes("propia")) return "CAJA_PROPIA";
  if (s.includes("banc")) return "BANCO";
  if (s.includes("fondo")) return "FONDO";
  if (s.includes("leasing")) return "LEASING";
  if (s.includes("mixt")) return "MIXTO";
  return null;
}

/** Mes como número 1-12 o nombre ("Ene", "Enero", "3"). */
export function toMes(v: CellValue): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 12) return v;
  if (v === null || v === undefined) return null;
  const s = normalizarPalabra(String(v));
  if (/^\d{1,2}$/.test(s)) {
    const n = Number(s);
    return n >= 1 && n <= 12 ? n : null;
  }
  for (const [mes, aliases] of MESES_ALIASES) {
    if (aliases.includes(s)) return Number(mes.slice(1));
  }
  return null;
}

const TOPE_CELDA = "999999999999"; // mismo tope que cellAmountSchema (12 dígitos)

/** Las 12 columnas están garantizadas por la viabilidad; celda en blanco = 0. */
function leerMeses(row: CellValue[], mapa: Mapa): { meses: MesesString; error: string | null } {
  const meses = {} as MesesString;
  for (const key of MONTH_KEYS) {
    const idx = mapa.meses[key];
    const monto = idx === undefined ? "0" : toMoney(row[idx]);
    if (Number(monto) < 0) return { meses, error: "tiene montos negativos" };
    if (monto.length > TOPE_CELDA.length + 3) return { meses, error: "tiene montos fuera de rango" };
    meses[key] = monto;
  }
  return { meses, error: null };
}

const MOTIVO_EJEMPLO = 'es una fila de EJEMPLO de la plantilla — borrala o reemplazala por datos reales';

// ─────────────────────────── Parsers por módulo ───────────────────────────

export function parseVentas(rows: CellValue[][]): ResultadoImport<FilaVentas> | null {
  const enc = buscarEncabezado("ventas", rows);
  if (!enc) return null;
  const { index, mapa } = enc;
  const filas: FilaVentas[] = [];
  const rechazos: Rechazo[] = [];
  let filasVacias = 0;

  for (let i = index + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const client = texto(row, mapa.campos.cliente);
    const { meses, error } = leerMeses(row, mapa);
    const tieneMontos = MONTH_KEYS.some((k) => Number(meses[k]) !== 0);

    if (!client && !tieneMontos) {
      filasVacias++;
      continue;
    }
    if (!client) {
      rechazos.push({ rowIndex: i + 1, motivo: "no tiene cliente" });
      continue;
    }
    if (PATRON_EJEMPLO.test(client)) {
      rechazos.push({ rowIndex: i + 1, motivo: MOTIVO_EJEMPLO });
      continue;
    }
    if (error) {
      rechazos.push({ rowIndex: i + 1, motivo: error });
      continue;
    }
    const saleType = toSaleType(texto(row, mapa.campos.tipo));
    if (saleType === null) {
      rechazos.push({
        rowIndex: i + 1,
        motivo: "tipo de venta no reconocido (usar Contrato, Proyección o Recurrente)",
      });
      continue;
    }
    filas.push({ rowIndex: i + 1, client, saleType, channel: texto(row, mapa.campos.canal), meses });
  }

  return { headerRowIndex: index, filas, rechazos, filasVacias };
}

export function parseGastos(rows: CellValue[][]): ResultadoImport<FilaGastos> | null {
  const enc = buscarEncabezado("gastos", rows);
  if (!enc) return null;
  const { index, mapa } = enc;
  const filas: FilaGastos[] = [];
  const rechazos: Rechazo[] = [];
  let filasVacias = 0;

  for (let i = index + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const item = texto(row, mapa.campos.item);
    const categoria = texto(row, mapa.campos.categoria, 120);
    const { meses, error } = leerMeses(row, mapa);
    const tieneMontos = MONTH_KEYS.some((k) => Number(meses[k]) !== 0);

    if (!item && !tieneMontos) {
      filasVacias++;
      continue;
    }
    if (!item) {
      rechazos.push({ rowIndex: i + 1, motivo: "no tiene ítem" });
      continue;
    }
    if (PATRON_EJEMPLO.test(item) || (categoria !== null && PATRON_EJEMPLO.test(categoria))) {
      rechazos.push({ rowIndex: i + 1, motivo: MOTIVO_EJEMPLO });
      continue;
    }
    // Sin categoría el upsert no puede reconocer la línea existente (la clave
    // es categoría+ítem) y duplicaría el gasto bajo otra categoría.
    if (!categoria) {
      rechazos.push({ rowIndex: i + 1, motivo: "no tiene categoría" });
      continue;
    }
    if (error) {
      rechazos.push({ rowIndex: i + 1, motivo: error });
      continue;
    }
    filas.push({ rowIndex: i + 1, categoria, item, meses });
  }

  return { headerRowIndex: index, filas, rechazos, filasVacias };
}

export function parseCapex(rows: CellValue[][]): ResultadoImport<FilaCapex> | null {
  const enc = buscarEncabezado("capex", rows);
  if (!enc) return null;
  const { index, mapa } = enc;
  const filas: FilaCapex[] = [];
  const rechazos: Rechazo[] = [];
  let filasVacias = 0;

  for (let i = index + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const description = texto(row, mapa.campos.descripcion);
    const montoRaw = mapa.campos.monto === undefined ? null : row[mapa.campos.monto];
    const amount = toMoney(montoRaw);

    if (!description && Number(amount) === 0) {
      filasVacias++;
      continue;
    }
    if (!description) {
      rechazos.push({ rowIndex: i + 1, motivo: "no tiene descripción" });
      continue;
    }
    if (PATRON_EJEMPLO.test(description)) {
      rechazos.push({ rowIndex: i + 1, motivo: MOTIVO_EJEMPLO });
      continue;
    }
    if (Number(amount) <= 0) {
      rechazos.push({ rowIndex: i + 1, motivo: "el monto debe ser mayor que 0" });
      continue;
    }
    if (amount.replace(/\.\d+$/, "").length > 12) {
      rechazos.push({ rowIndex: i + 1, motivo: "monto fuera de rango" });
      continue;
    }
    const currency = toMoneda(texto(row, mapa.campos.moneda));
    if (currency === null) {
      rechazos.push({ rowIndex: i + 1, motivo: "moneda no reconocida (usar CLP, UF o USD)" });
      continue;
    }
    const monthNeeded = toMes(mapa.campos.mesRequerido === undefined ? null : row[mapa.campos.mesRequerido]);
    if (!monthNeeded) {
      rechazos.push({ rowIndex: i + 1, motivo: "mes requerido inválido (1-12 o nombre del mes)" });
      continue;
    }
    const fuente = toFuente(texto(row, mapa.campos.fuente));
    if (fuente === null) {
      rechazos.push({
        rowIndex: i + 1,
        motivo: "fuente no reconocida (Caja propia, Banco, Fondo, Leasing o Mixto)",
      });
      continue;
    }
    const plazoRaw = texto(row, mapa.campos.plazo, 10);
    let financingMonths: number | null = null;
    if (plazoRaw) {
      const n = Number(plazoRaw.replace(/[^\d]/g, ""));
      if (!Number.isInteger(n) || n < 1 || n > 360) {
        rechazos.push({ rowIndex: i + 1, motivo: "plazo inválido (1 a 360 meses)" });
        continue;
      }
      financingMonths = n;
    }

    filas.push({
      rowIndex: i + 1,
      description,
      purpose: texto(row, mapa.campos.proposito, 500),
      amount,
      currency,
      monthNeeded,
      financingMonths,
      financingSource: fuente,
      initiativeName: texto(row, mapa.campos.iniciativa, 120),
    });
  }

  return { headerRowIndex: index, filas, rechazos, filasVacias };
}

/**
 * Clave de upsert: la importación ACTUALIZA la línea existente con el mismo
 * nombre y CREA las nuevas — nunca borra. Normalizada para que "Arriendo " y
 * "arriendo" sean la misma línea.
 */
export function claveDeLinea(...partes: Array<string | null>): string {
  return partes
    .map((p) => (p ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase())
    .join("::");
}
