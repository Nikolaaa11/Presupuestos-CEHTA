/**
 * Parser genérico de planillas bancarias (módulo Bancos).
 *
 * Funciona sobre arrays de filas (AOA) sin depender de xlsx, para ser puro y
 * testeable. Detecta la fila de encabezados por alias (tolerante a emojis,
 * saltos de línea, "($)", acentos), mapea columnas conocidas, convierte fechas
 * seriales de Excel y montos es-CL, y marca `released` desde la columna Estado
 * (✅/pagado/liberado). Las planillas sin columna Estado quedan PENDIENTES —
 * ese es justamente el flujo de liberación.
 *
 * Soporta las dos formas reales del fondo:
 *  - Cartola CC (CC Santander / CC BICE): Fecha, Descripción, Abonos, Egreso, Saldo,
 *    General/Detallado/Específico/Centro Negocios/Aporte K, Estado
 *  - Detalle de transferencias (AFIS / CEnergy): Fecha Ingreso, Fecha Pago, Monto,
 *    Proveedor, T Doc, N Doc, Descripción, RUT, Banco, N Cuenta, Tipo Cuenta, Correo
 */

export type CellValue = string | number | boolean | null | undefined;

export type ParsedMovement = {
  rowIndex: number;
  date: string | null; // ISO YYYY-MM-DD
  entryDate: string | null;
  reference: string | null;
  description: string | null;
  credit: string; // Decimal como string, ≥ 0
  debit: string;
  balance: string | null;
  categoryGeneral: string | null;
  categoryDetail: string | null;
  categorySpecific: string | null;
  businessCenter: string | null;
  capitalTag: string | null;
  rut: string | null;
  bankName: string | null;
  accountNumber: string | null;
  accountType: string | null;
  docType: string | null;
  docNumber: string | null;
  email: string | null;
  link: string | null;
  released: boolean;
};

export type ParsedSheet = {
  name: string;
  headerRowIndex: number;
  movements: ParsedMovement[];
  skippedRows: number;
};

type Field =
  | "date" | "entryDate" | "reference" | "description" | "credit" | "debit" | "balance"
  | "categoryGeneral" | "categoryDetail" | "categorySpecific" | "businessCenter" | "capitalTag"
  | "rut" | "bankName" | "accountNumber" | "accountType" | "docType" | "docNumber"
  | "email" | "link" | "estado";

/** Alias de encabezados ya normalizados (ver normalizeHeader). El orden importa:
 *  el primer campo que matchee se queda con la columna. */
const ALIASES: ReadonlyArray<[Field, string[]]> = [
  ["entryDate", ["fecha ingreso"]],
  ["date", ["fecha pago", "fecha"]],
  ["credit", ["abonos", "abono", "ingresos", "ingreso"]],
  ["debit", ["egreso", "egresos", "cargo", "cargos", "monto"]],
  ["balance", ["saldo"]],
  ["description", ["descripcion / motivo real", "descripcion", "motivo", "glosa", "detalle"]],
  ["reference", ["nombre / ref", "nombre/ref", "nombre ref", "proveedor", "n oc", "no oc", "referencia", "ref"]],
  ["categoryGeneral", ["general"]],
  ["categoryDetail", ["detallado"]],
  ["categorySpecific", ["especifico"]],
  ["businessCenter", ["centro negocios", "centro de negocios"]],
  ["capitalTag", ["aporte k", "aporte capital"]],
  ["rut", ["rut"]],
  ["bankName", ["banco"]],
  ["accountNumber", ["n cuenta", "no cuenta", "num cuenta", "cuenta"]],
  ["accountType", ["tipo cuenta", "tipo de cuenta"]],
  ["docType", ["t doc", "tipo doc", "t documento"]],
  ["docNumber", ["n doc", "no doc", "num doc"]],
  ["email", ["correo", "email", "e mail"]],
  ["link", ["link url", "link", "url"]],
  ["estado", ["estado"]],
];

/** Normaliza un encabezado: sin emojis/símbolos, sin "($)", sin acentos, minúsculas. */
export function normalizeHeader(raw: CellValue): string {
  if (raw === null || raw === undefined) return "";
  return String(raw)
    .replace(/[\r\n]+/g, " ")
    .replace(/\(\s*(url|clickeable|manual|auto)\s*\)/gi, " ")
    .replace(/\(\$\)/g, " ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // acentos
    .replace(/[^a-zA-Z0-9/ ]+/g, " ") // emojis y símbolos
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function matchField(header: string): Field | null {
  if (!header) return null;
  for (const [field, aliases] of ALIASES) {
    if (aliases.includes(header)) return field;
  }
  return null;
}

export type ColumnMap = Partial<Record<Field, number>>;

/** Mapea una fila candidata a encabezados → columnas. */
export function mapHeaderRow(row: CellValue[]): ColumnMap {
  const map: ColumnMap = {};
  row.forEach((cell, index) => {
    const field = matchField(normalizeHeader(cell));
    if (field && map[field] === undefined) map[field] = index;
  });
  return map;
}

/** Una fila de encabezados válida necesita un campo de monto y una referencia temporal o de contraparte. */
function isViableHeader(map: ColumnMap): boolean {
  const mapped = Object.keys(map).length;
  const hasMoney = map.credit !== undefined || map.debit !== undefined;
  const hasAnchor = map.date !== undefined || map.entryDate !== undefined || map.reference !== undefined || map.description !== undefined;
  return mapped >= 3 && hasMoney && hasAnchor;
}

/** Busca la fila de encabezados dentro de las primeras `maxScan` filas. */
export function findHeaderRow(rows: CellValue[][], maxScan = 12): { index: number; map: ColumnMap } | null {
  const limit = Math.min(rows.length, maxScan);
  for (let i = 0; i < limit; i++) {
    const map = mapHeaderRow(rows[i] ?? []);
    if (isViableHeader(map)) return { index: i, map };
  }
  return null;
}

/** Verifica que la fecha exista de verdad en el calendario (31/02 no existe). */
function isRealCalendarDate(iso: string): boolean {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [, y, mo, d] = m.map(Number) as unknown as [string, number, number, number];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
  );
}

/** Serial Excel (epoch 1899-12-30) o texto dd/mm/aaaa → ISO YYYY-MM-DD. */
export function toIsoDate(value: CellValue): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 20000 && value < 80000) {
    const ms = Math.round((value - 25569) * 86400 * 1000); // 25569 = días entre 1899-12-30 y epoch Unix
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    const m = value.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (m) {
      const [, d, mo, yRaw] = m;
      const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
      const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
      // Rechaza 31/02 y similares en vez de dejar que la base los corra de día.
      return isRealCalendarDate(iso) ? iso : null;
    }
    const direct = value.trim().match(/^\d{4}-\d{2}-\d{2}/);
    if (direct && isRealCalendarDate(direct[0])) return direct[0];
  }
  return null;
}

/** Monto → Decimal string con 2 decimales. Acepta números xlsx y texto es-CL. */
export function toMoney(value: CellValue): string {
  if (value === null || value === undefined || value === "") return "0";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "0";
    return (Math.round(value * 100) / 100).toFixed(2);
  }
  const raw = String(value).trim().replace(/\$|\s/g, "");
  if (raw === "" || raw === "-") return "0";
  let normalized = raw;
  if (raw.includes(",")) normalized = raw.replace(/\./g, "").replace(",", ".");
  else {
    const dots = raw.match(/\./g)?.length ?? 0;
    if (dots > 1 || (dots === 1 && /^-?\d{1,3}\.\d{3}$/.test(raw))) normalized = raw.replace(/\./g, "");
  }
  const n = Number(normalized);
  if (!Number.isFinite(n)) return "0";
  return (Math.round(n * 100) / 100).toFixed(2);
}

/**
 * Estado → liberado. ✅/pagado/liberado/sí/ok cuentan como liberado.
 * Los estados NEGADOS o anulados NO: "No pagado", "Sin liberar", "Anulado",
 * "Rechazado", "Pendiente" quedan pendientes de liberar (ante la duda, pendiente:
 * marcar de más un pago liberado es el error caro).
 */
export function toReleased(value: CellValue): boolean {
  if (value === null || value === undefined) return false;
  const s = String(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
  if (s === "") return false;
  if (/\bno\b|\bsin\b|anulad|rechazad|pendiente|revers|nulo/.test(s)) return false;
  if (s.includes("✅") || s.includes("✔")) return true;
  return /liberad|pagad|conciliad|\bok\b|^si$/.test(s);
}

/** Solo se conservan enlaces http(s): evita javascript:/data: guardados en el Excel. */
export function safeLink(value: CellValue): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === "") return null;
  try {
    const url = new URL(s);
    return url.protocol === "http:" || url.protocol === "https:" ? s.slice(0, 500) : null;
  } catch {
    return null;
  }
}

/**
 * Huella estable de un movimiento dentro de su hoja. Sirve para reconocer la
 * misma fila cuando se re-sube una planilla y así no perder el estado liberado.
 */
export function movementFingerprint(m: {
  rowIndex: number;
  reference: string | null;
  description: string | null;
  debit: string;
  credit: string;
}): string {
  const norm = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const money = (s: string) => String(Number(s || 0));
  return [m.rowIndex, norm(m.reference), norm(m.description), money(m.debit), money(m.credit)].join("|");
}

function toText(value: CellValue): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/\s+/g, " ").trim();
  return s === "" ? null : s.slice(0, 500);
}

function cell(row: CellValue[], map: ColumnMap, field: Field): CellValue {
  const idx = map[field];
  return idx === undefined ? null : row[idx];
}

/** Parsea una hoja completa. Devuelve null si no se detectan encabezados. */
export function parseSheet(name: string, rows: CellValue[][]): ParsedSheet | null {
  const header = findHeaderRow(rows);
  if (!header) return null;

  const { index: headerRowIndex, map } = header;
  const movements: ParsedMovement[] = [];
  let skippedRows = 0;

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const credit = toMoney(cell(row, map, "credit"));
    const debit = toMoney(cell(row, map, "debit"));
    const description = toText(cell(row, map, "description"));
    const reference = toText(cell(row, map, "reference"));

    // Fila válida: tiene plata, o al menos de quién/qué se trata.
    if (Number(credit) === 0 && Number(debit) === 0 && !description && !reference) {
      skippedRows++;
      continue;
    }

    const balanceRaw = cell(row, map, "balance");
    movements.push({
      rowIndex: i,
      date: toIsoDate(cell(row, map, "date")),
      entryDate: toIsoDate(cell(row, map, "entryDate")),
      reference,
      description,
      credit,
      debit,
      balance: balanceRaw === null || balanceRaw === undefined || balanceRaw === "" ? null : toMoney(balanceRaw),
      categoryGeneral: toText(cell(row, map, "categoryGeneral")),
      categoryDetail: toText(cell(row, map, "categoryDetail")),
      categorySpecific: toText(cell(row, map, "categorySpecific")),
      businessCenter: toText(cell(row, map, "businessCenter")),
      capitalTag: toText(cell(row, map, "capitalTag")),
      rut: toText(cell(row, map, "rut")),
      bankName: toText(cell(row, map, "bankName")),
      accountNumber: toText(cell(row, map, "accountNumber")),
      accountType: toText(cell(row, map, "accountType")),
      docType: toText(cell(row, map, "docType")),
      docNumber: toText(cell(row, map, "docNumber")),
      email: toText(cell(row, map, "email")),
      link: safeLink(cell(row, map, "link")),
      released: toReleased(cell(row, map, "estado")),
    });
  }

  return { name, headerRowIndex, movements, skippedRows };
}

/** Parsea un libro completo (varias hojas). Las hojas sin encabezados reconocibles se omiten. */
export function parseWorkbook(
  sheets: { name: string; rows: CellValue[][] }[],
  sheetFilter?: string[],
): { parsed: ParsedSheet[]; ignored: string[] } {
  const wanted = sheetFilter?.map((s) => s.trim().toLowerCase()).filter(Boolean);
  const parsed: ParsedSheet[] = [];
  const ignored: string[] = [];
  for (const sheet of sheets) {
    if (wanted && wanted.length > 0 && !wanted.includes(sheet.name.trim().toLowerCase())) {
      ignored.push(sheet.name);
      continue;
    }
    const result = parseSheet(sheet.name, sheet.rows);
    if (result && result.movements.length > 0) parsed.push(result);
    else ignored.push(sheet.name);
  }
  return { parsed, ignored };
}
