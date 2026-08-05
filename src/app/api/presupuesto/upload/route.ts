import * as XLSX from "xlsx";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { BUDGET_YEAR, isEditableStatus } from "@/lib/budget";
import { approvalLevelFor } from "@/lib/capex";
import { revisarZip } from "@/lib/zip-safety";
import type { CurrencyCode, Fx } from "@/lib/money";
import {
  parseVentas,
  parseGastos,
  parseCapex,
  diagnosticoEncabezado,
  claveDeLinea,
  type Modulo,
  type Rechazo,
} from "@/lib/presupuesto-import";
import type { CellValue } from "@/lib/bank-import";

/**
 * Carga masiva del presupuesto por Excel (Fase 2).
 * POST multipart/form-data: file (.xlsx/.xls), modulo (ventas|gastos|capex), año?.
 *
 * Reglas:
 *  - Solo el COMPANY_MANAGER de la empresa, y solo con el presupuesto EDITABLE
 *    (BORRADOR u OBSERVADO) — la misma regla que editar celdas, RE-verificada
 *    dentro de la transacción (entre leer el Excel y escribir pueden pasar
 *    segundos; si en el medio lo enviaron, se aborta).
 *  - UPSERT, nunca borra: la línea existente (misma clave normalizada) se
 *    ACTUALIZA; la nueva se CREA. En updates, las celdas OPCIONALES vacías
 *    NO pisan lo existente (tipo de venta, canal, moneda, fuente, plazo,
 *    propósito, iniciativa): la revisión adversarial demostró que pisar con
 *    defaults convertía UF→CLP y rompía el nivel de aprobación. Los meses sí
 *    se escriben completos: la fila es la foto del año (la plantilla exige
 *    las 12 columnas). Lo que el Excel no maneja (r01-r12, pagado, vínculos)
 *    queda intacto siempre.
 *  - Todo rechazo vuelve con fila y motivo — nada se pierde en silencio.
 *  - Endurecida: content-length, revisión del ZIP (bomba de descompresión:
 *    un .xlsx de 9,5 MB puede declarar 2.800 MB descomprimidos), sheetRows +
 *    dense, topes de hojas/filas, y tope de categorías nuevas por importación
 *    (el catálogo de categorías es GLOBAL compartido entre las 10 empresas).
 */

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_SHEET_ROWS = 5_000;
const MAX_SHEETS_SCAN = 6;
const MAX_FILAS = 2_000;
const MAX_RECHAZOS_DEVUELTOS = 30;
const MAX_CATEGORIAS_NUEVAS = 10;

const FX_FALLBACK: Fx = { ufToClp: "39200", usdToClp: "950" };

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autenticado" }, { status: 401 });
  if (session.user.role !== "COMPANY_MANAGER" || !session.user.companyId) {
    return Response.json(
      { error: "Solo la gerencia de la empresa puede importar su presupuesto" },
      { status: 403 },
    );
  }
  const companyId = session.user.companyId;

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BYTES) {
    return Response.json({ error: "El archivo supera el límite de 10 MB" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Formato de solicitud inválido" }, { status: 400 });
  }

  const file = form.get("file");
  const modulo = String(form.get("modulo") ?? "") as Modulo;
  const añoRaw = String(form.get("año") ?? form.get("year") ?? "").trim();
  const year = añoRaw ? Number(añoRaw) : BUDGET_YEAR;

  if (!["ventas", "gastos", "capex"].includes(modulo)) {
    return Response.json({ error: "Módulo inválido (ventas, gastos o capex)" }, { status: 400 });
  }
  if (!(file instanceof File)) return Response.json({ error: "Falta el archivo" }, { status: 400 });
  if (!/\.(xlsx|xls)$/i.test(file.name)) {
    return Response.json({ error: "Solo se aceptan archivos Excel (.xlsx, .xls)" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "El archivo supera el límite de 10 MB" }, { status: 413 });
  }
  if (!Number.isInteger(year) || year < 2020 || year > 2040) {
    return Response.json({ error: "Año inválido" }, { status: 400 });
  }

  // ── Presupuesto destino: el vigente del año, o el borrador inicial ──
  let budget = await prisma.budget.findFirst({
    where: { companyId, year },
    orderBy: { version: "desc" },
    select: { id: true, status: true, version: true },
  });
  if (!budget) {
    budget = await prisma.budget.create({
      data: { companyId, year, version: 1, status: "BORRADOR", currency: "CLP" },
      select: { id: true, status: true, version: true },
    });
  }
  if (!isEditableStatus(budget.status)) {
    return Response.json(
      {
        error: `El presupuesto ${year} está ${budget.status.toLocaleLowerCase("es-CL")} — en solo lectura. Para corregirlo, pedí que lo observen (o que lo reabran si está aprobado).`,
      },
      { status: 409 },
    );
  }

  // ── Leer el Excel: primero la revisión del ZIP, después SheetJS ──
  const buffer = Buffer.from(await file.arrayBuffer());
  const zip = revisarZip(buffer);
  if (!zip.ok) {
    return Response.json({ error: `Archivo rechazado: ${zip.motivo}` }, { status: 400 });
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, {
      type: "buffer",
      sheetRows: MAX_SHEET_ROWS,
      dense: true,
      cellDates: false,
      cellFormula: false,
      cellHTML: false,
    });
  } catch {
    return Response.json({ error: "No se pudo leer el archivo Excel" }, { status: 400 });
  }

  // Se toma la PRIMERA hoja donde el parser del módulo reconozca el encabezado
  // COMPLETO de la plantilla (los nombres de columna son tolerantes; la
  // presencia de todas, no).
  type Parsed =
    | { tipo: "ventas"; r: NonNullable<ReturnType<typeof parseVentas>> }
    | { tipo: "gastos"; r: NonNullable<ReturnType<typeof parseGastos>> }
    | { tipo: "capex"; r: NonNullable<ReturnType<typeof parseCapex>> };
  let parsed: Parsed | null = null;
  let hoja = "";
  let mejorDiagnostico: string[] = [];

  for (const name of workbook.SheetNames.slice(0, MAX_SHEETS_SCAN)) {
    const rows = XLSX.utils.sheet_to_json<CellValue[]>(workbook.Sheets[name], {
      header: 1,
      defval: null,
      blankrows: false,
    });
    if (modulo === "ventas") {
      const r = parseVentas(rows);
      if (r) { parsed = { tipo: "ventas", r }; hoja = name; break; }
    } else if (modulo === "gastos") {
      const r = parseGastos(rows);
      if (r) { parsed = { tipo: "gastos", r }; hoja = name; break; }
    } else {
      const r = parseCapex(rows);
      if (r) { parsed = { tipo: "capex", r }; hoja = name; break; }
    }
    const diag = diagnosticoEncabezado(modulo, rows);
    if (mejorDiagnostico.length === 0 || (diag.faltantes.length > 0 && diag.faltantes.length < mejorDiagnostico.length)) {
      mejorDiagnostico = diag.faltantes;
    }
  }

  if (!parsed) {
    const detalle =
      mejorDiagnostico.length > 0
        ? ` Faltan estas columnas: ${mejorDiagnostico.join(", ")}.`
        : "";
    return Response.json(
      {
        error: `Ninguna hoja tiene el encabezado completo de la plantilla de ${modulo}.${detalle} Descargá la plantilla y usala como base (podés agregar columnas, no quitar).`,
        hojasRevisadas: workbook.SheetNames.slice(0, MAX_SHEETS_SCAN),
      },
      { status: 422 },
    );
  }
  if (parsed.r.filas.length > MAX_FILAS) {
    return Response.json(
      { error: `El archivo excede ${MAX_FILAS.toLocaleString("es-CL")} filas` },
      { status: 413 },
    );
  }
  if (parsed.r.filas.length === 0) {
    return Response.json(
      {
        error: "No se encontró ninguna fila válida para importar",
        rechazos: parsed.r.rechazos.slice(0, MAX_RECHAZOS_DEVUELTOS),
        rechazosTotal: parsed.r.rechazos.length,
      },
      { status: 422 },
    );
  }

  // ── Upsert por módulo, atómico, re-verificando editabilidad adentro ──
  let creadas = 0;
  let actualizadas = 0;
  const rechazos: Rechazo[] = [...parsed.r.rechazos];
  const categoriasNuevas: string[] = [];
  const budgetId = budget.id;

  /** El estado pudo cambiar entre el guard de arriba y la escritura (TOCTOU). */
  async function exigirEditableEnTx(tx: { budget: { findUnique: typeof prisma.budget.findUnique } }) {
    const actual = await tx.budget.findUnique({ where: { id: budgetId }, select: { status: true } });
    if (!actual || !isEditableStatus(actual.status)) {
      throw new Error("PRESUPUESTO_NO_EDITABLE");
    }
  }

  try {
    if (parsed.tipo === "ventas") {
      const filas = parsed.r.filas;
      await prisma.$transaction(async (tx) => {
        await exigirEditableEnTx(tx);
        const existentes = await tx.salesLine.findMany({
          where: { budgetId },
          select: { id: true, client: true, sortOrder: true },
        });
        const porClave = new Map(existentes.map((l) => [claveDeLinea(l.client), l.id]));
        let sortOrder = existentes.reduce((m, l) => Math.max(m, l.sortOrder), -1) + 1;
        const vistos = new Set<string>();

        for (const f of filas) {
          const clave = claveDeLinea(f.client);
          if (vistos.has(clave)) {
            rechazos.push({ rowIndex: f.rowIndex, motivo: `cliente repetido en el archivo ("${f.client}") — se usó la primera fila` });
            continue;
          }
          vistos.add(clave);
          const existenteId = porClave.get(clave);
          if (existenteId) {
            // Celdas opcionales vacías NO pisan lo existente.
            await tx.salesLine.update({
              where: { id: existenteId },
              data: {
                client: f.client,
                ...(f.saleType !== undefined ? { saleType: f.saleType } : {}),
                ...(f.channel !== null ? { channel: f.channel } : {}),
                ...f.meses,
              },
            });
            actualizadas++;
          } else {
            await tx.salesLine.create({
              data: {
                budgetId,
                client: f.client,
                saleType: f.saleType ?? "PROYECCION_PUBLICO",
                channel: f.channel,
                sortOrder: sortOrder++,
                ...f.meses,
              },
            });
            creadas++;
          }
        }
      });
    } else if (parsed.tipo === "gastos") {
      const filas = parsed.r.filas;
      await prisma.$transaction(async (tx) => {
        await exigirEditableEnTx(tx);
        const categorias = await tx.expenseCategory.findMany({ select: { id: true, name: true, sortOrder: true } });
        const catPorClave = new Map(categorias.map((c) => [claveDeLinea(c.name), c.id]));
        let catSort = categorias.reduce((m, c) => Math.max(m, c.sortOrder), -1) + 1;

        const existentes = await tx.expenseLine.findMany({
          where: { budgetId },
          select: { id: true, item: true, categoryId: true, sortOrder: true },
        });
        const catNombrePorId = new Map(categorias.map((c) => [c.id, claveDeLinea(c.name)]));
        const porClave = new Map(
          existentes.map((l) => [`${catNombrePorId.get(l.categoryId) ?? ""}::${claveDeLinea(l.item)}`, l.id]),
        );
        let sortOrder = existentes.reduce((m, l) => Math.max(m, l.sortOrder), -1) + 1;
        const vistos = new Set<string>();

        for (const f of filas) {
          const claveCat = claveDeLinea(f.categoria);
          let categoryId = catPorClave.get(claveCat);
          if (!categoryId) {
            // El catálogo de categorías es GLOBAL (compartido entre empresas):
            // tope por importación para que un Excel no lo infle.
            if (categoriasNuevas.length >= MAX_CATEGORIAS_NUEVAS) {
              rechazos.push({
                rowIndex: f.rowIndex,
                motivo: `categoría nueva "${f.categoria}" supera el tope de ${MAX_CATEGORIAS_NUEVAS} categorías nuevas por importación — usá una existente o creala en Configuración`,
              });
              continue;
            }
            const nueva = await tx.expenseCategory.create({
              data: { name: f.categoria, sortOrder: catSort++ },
              select: { id: true },
            });
            categoryId = nueva.id;
            catPorClave.set(claveCat, categoryId);
            catNombrePorId.set(categoryId, claveCat);
            categoriasNuevas.push(f.categoria);
          }
          const clave = `${claveCat}::${claveDeLinea(f.item)}`;
          if (vistos.has(clave)) {
            rechazos.push({ rowIndex: f.rowIndex, motivo: `ítem repetido en el archivo ("${f.item}") — se usó la primera fila` });
            continue;
          }
          vistos.add(clave);
          const existenteId = porClave.get(clave);
          if (existenteId) {
            await tx.expenseLine.update({ where: { id: existenteId }, data: { ...f.meses } });
            actualizadas++;
          } else {
            await tx.expenseLine.create({
              data: { budgetId, categoryId, item: f.item, sortOrder: sortOrder++, ...f.meses },
            });
            creadas++;
          }
        }
      });
    } else {
      const filas = parsed.r.filas;
      const fxRow = await prisma.fxRate.findUnique({ where: { year } });
      const fx: Fx = fxRow
        ? { ufToClp: fxRow.ufToClp.toString(), usdToClp: fxRow.usdToClp.toString() }
        : FX_FALLBACK;

      await prisma.$transaction(async (tx) => {
        await exigirEditableEnTx(tx);
        const existentes = await tx.capexItem.findMany({
          where: { budgetId },
          select: { id: true, description: true, currency: true, sortOrder: true },
        });
        const porClave = new Map(existentes.map((i) => [claveDeLinea(i.description), i]));
        let sortOrder = existentes.reduce((m, i) => Math.max(m, i.sortOrder), -1) + 1;
        const vistos = new Set<string>();

        for (const f of filas) {
          const clave = claveDeLinea(f.description);
          if (vistos.has(clave)) {
            rechazos.push({ rowIndex: f.rowIndex, motivo: `inversión repetida en el archivo ("${f.description}") — se usó la primera fila` });
            continue;
          }
          vistos.add(clave);
          const existente = porClave.get(clave);
          // Moneda efectiva: la del Excel, o al ACTUALIZAR la que el ítem ya
          // tiene — jamás un default que pise UF con CLP. El nivel N1–N6
          // SIEMPRE se recalcula server-side con esa moneda efectiva.
          const currency = (f.currency ?? existente?.currency ?? "CLP") as CurrencyCode;
          const approvalLevel = approvalLevelFor(f.amount, currency, fx);

          if (existente) {
            await tx.capexItem.update({
              where: { id: existente.id },
              data: {
                description: f.description,
                amount: f.amount,
                currency,
                monthNeeded: f.monthNeeded,
                approvalLevel,
                ...(f.purpose !== null ? { purpose: f.purpose } : {}),
                ...(f.financingMonths !== null ? { financingMonths: f.financingMonths } : {}),
                ...(f.financingSource !== undefined ? { financingSource: f.financingSource } : {}),
                ...(f.initiativeName !== null
                  ? { isInitiative: true, initiativeName: f.initiativeName }
                  : {}),
              },
            });
            actualizadas++;
          } else {
            await tx.capexItem.create({
              data: {
                budgetId,
                description: f.description,
                purpose: f.purpose,
                amount: f.amount,
                currency,
                monthNeeded: f.monthNeeded,
                financingMonths: f.financingMonths,
                financingSource: f.financingSource ?? "CAJA_PROPIA",
                isInitiative: f.initiativeName !== null,
                initiativeName: f.initiativeName,
                approvalLevel,
                sortOrder: sortOrder++,
              },
            });
            creadas++;
          }
        }
      });
    }
  } catch (error) {
    if (error instanceof Error && error.message === "PRESUPUESTO_NO_EDITABLE") {
      return Response.json(
        { error: "El presupuesto dejó de estar editable mientras se procesaba el archivo — no se aplicó ningún cambio" },
        { status: 409 },
      );
    }
    return Response.json(
      { error: "No fue posible guardar la importación — no se aplicó ningún cambio" },
      { status: 500 },
    );
  }

  for (const p of ["/", "/ventas", "/gastos", "/capex", "/consolidado"]) revalidatePath(p);

  return Response.json({
    ok: true,
    modulo,
    año: year,
    hoja,
    creadas,
    actualizadas,
    filasVacias: parsed.r.filasVacias,
    rechazos: rechazos.slice(0, MAX_RECHAZOS_DEVUELTOS),
    rechazosTotal: rechazos.length,
    ...(categoriasNuevas.length > 0 ? { categoriasNuevas } : {}),
  });
}
