import * as XLSX from "xlsx";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { parseWorkbook, movementFingerprint, type CellValue } from "@/lib/bank-import";

/**
 * Subida de planillas bancarias (módulo Bancos).
 * POST multipart/form-data: file (.xlsx/.xls), companyCode, sheets? (filtro
 * de hojas separadas por coma).
 *
 * Endurecido tras la revisión de seguridad del 28-07-2026:
 *  - `sheetRows` + `dense` al leer: un .xlsx de 16 KB con la etiqueta
 *    <dimension> inflada (ej. A1:XFD1048576) hacía que SheetJS materializara
 *    millones de celdas vacías y tumbaba el proceso por OOM. `sheetRows` recorta
 *    el rango declarado en el propio parser.
 *  - El filtro de hojas se aplica ANTES de convertir a AOA (antes se convertían
 *    todas y recién después se filtraba: N hojas trampa multiplicaban el daño).
 *  - Topes explícitos de hojas y de filas por hoja.
 *  - Si el libro trae varias hojas reconocibles y no se indicó cuáles, se
 *    responde 409 con la lista para que el usuario elija: evita que un archivo
 *    multi-empresa (AFIS + CEnergy) quede entero bajo una sola empresa.
 *  - Reemplazo atómico en transacción y PRESERVANDO el estado de liberación
 *    (quién y cuándo) de los movimientos que ya existían.
 */

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_SHEET_ROWS = 20_000; // filas leídas por hoja
const MAX_SHEETS = 12;
const MAX_MOVEMENTS_PER_SHEET = 15_000;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "No autenticado" }, { status: 401 });
  if (session.user.role !== "FUND_ADMIN" && session.user.role !== "COMPANY_MANAGER") {
    return Response.json({ error: "Tu rol no permite subir planillas" }, { status: 403 });
  }

  // Rechazo temprano por tamaño declarado, antes de bufferizar el cuerpo.
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
  const companyCode = String(form.get("companyCode") ?? "").toUpperCase().trim();
  const sheetsFilterRaw = String(form.get("sheets") ?? "").trim();

  if (!(file instanceof File)) return Response.json({ error: "Falta el archivo" }, { status: 400 });
  if (!/\.(xlsx|xls)$/i.test(file.name)) {
    return Response.json({ error: "Solo se aceptan archivos Excel (.xlsx, .xls)" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "El archivo supera el límite de 10 MB" }, { status: 413 });
  }
  if (!companyCode) return Response.json({ error: "Falta la empresa" }, { status: 400 });

  const company = await prisma.company.findUnique({ where: { code: companyCode } });
  if (!company) return Response.json({ error: "Empresa no encontrada" }, { status: 400 });
  if (session.user.role !== "FUND_ADMIN" && session.user.companyId !== company.id) {
    return Response.json({ error: "Solo podés subir planillas de tu empresa" }, { status: 403 });
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(Buffer.from(await file.arrayBuffer()), {
      type: "buffer",
      sheetRows: MAX_SHEET_ROWS, // corta el rango declarado: mata el DoS por <dimension> inflada
      dense: true,
      cellDates: false,
      cellFormula: false,
      cellHTML: false,
    });
  } catch {
    return Response.json({ error: "No se pudo leer el archivo Excel" }, { status: 400 });
  }

  const wanted = sheetsFilterRaw
    ? sheetsFilterRaw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : null;

  // Filtrar ANTES de materializar: solo se convierten a AOA las hojas pedidas.
  const targetNames = workbook.SheetNames.filter(
    (name) => !wanted || wanted.includes(name.trim().toLowerCase()),
  ).slice(0, MAX_SHEETS);

  if (targetNames.length === 0) {
    return Response.json(
      { error: "Ninguna hoja coincide con el filtro indicado", hojasDisponibles: workbook.SheetNames },
      { status: 422 },
    );
  }

  const aoa = targetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<CellValue[]>(workbook.Sheets[name], {
      header: 1,
      defval: null,
      blankrows: false,
    }),
  }));

  const { parsed } = parseWorkbook(aoa);

  if (parsed.length === 0) {
    return Response.json(
      { error: "Ninguna hoja tiene el formato esperado (encabezados con Fecha/Monto/Abonos/Egreso)" },
      { status: 422 },
    );
  }

  // Multi-hoja sin filtro explícito: pedir confirmación en vez de meter todo
  // bajo una sola empresa (los archivos del fondo mezclan AFIS y CEnergy).
  if (!wanted && parsed.length > 1) {
    return Response.json(
      {
        error: `El archivo tiene ${parsed.length} hojas con datos bancarios. Indicá cuáles importar a ${company.code} en el campo "Hojas".`,
        hojasDetectadas: parsed.map((p) => ({ hoja: p.name, movimientos: p.movements.length })),
      },
      { status: 409 },
    );
  }

  const created: { sheet: string; movements: number; pending: number; preserved: number }[] = [];

  for (const sheet of parsed) {
    if (sheet.movements.length > MAX_MOVEMENTS_PER_SHEET) {
      return Response.json(
        { error: `La hoja "${sheet.name}" excede ${MAX_MOVEMENTS_PER_SHEET.toLocaleString("es-CL")} movimientos` },
        { status: 413 },
      );
    }

    // Estado de liberación previo, indexado por huella del movimiento, para que
    // re-subir una planilla corregida NO borre lo que el equipo ya liberó.
    const previous = await prisma.bankMovement.findMany({
      where: { sheet: { companyId: company.id, name: sheet.name }, released: true },
      select: { rowIndex: true, reference: true, description: true, debit: true, credit: true, releasedAt: true, releasedById: true },
    });
    const releasedBefore = new Map(
      previous.map((p) => [
        movementFingerprint({
          rowIndex: p.rowIndex,
          reference: p.reference,
          description: p.description,
          debit: p.debit.toString(),
          credit: p.credit.toString(),
        }),
        { releasedAt: p.releasedAt, releasedById: p.releasedById },
      ]),
    );

    let preserved = 0;
    const rows = sheet.movements.map((m) => {
      const prior = releasedBefore.get(movementFingerprint(m));
      if (prior) preserved++;
      return {
        rowIndex: m.rowIndex,
        date: m.date ? new Date(`${m.date}T12:00:00Z`) : null,
        entryDate: m.entryDate ? new Date(`${m.entryDate}T12:00:00Z`) : null,
        reference: m.reference,
        description: m.description,
        credit: m.credit,
        debit: m.debit,
        balance: m.balance,
        categoryGeneral: m.categoryGeneral,
        categoryDetail: m.categoryDetail,
        categorySpecific: m.categorySpecific,
        businessCenter: m.businessCenter,
        capitalTag: m.capitalTag,
        rut: m.rut,
        bankName: m.bankName,
        accountNumber: m.accountNumber,
        accountType: m.accountType,
        docType: m.docType,
        docNumber: m.docNumber,
        email: m.email,
        link: m.link,
        released: m.released || Boolean(prior),
        releasedAt: prior?.releasedAt ?? (m.released ? new Date() : null),
        releasedById: prior?.releasedById ?? null,
      };
    });

    // Atómico: si algo falla, la planilla anterior queda intacta.
    await prisma.$transaction(async (tx) => {
      await tx.bankSheet.deleteMany({ where: { companyId: company.id, name: sheet.name } });
      const dbSheet = await tx.bankSheet.create({
        data: {
          companyId: company.id,
          name: sheet.name,
          sourceFile: file.name,
          uploadedById: session.user.id,
        },
      });
      await tx.bankMovement.createMany({ data: rows.map((r) => ({ ...r, sheetId: dbSheet.id })) });
    });

    created.push({
      sheet: sheet.name,
      movements: sheet.movements.length,
      pending: rows.filter((r) => !r.released).length,
      preserved,
    });
  }

  revalidatePath("/bancos");
  return Response.json({ ok: true, company: company.code, created });
}
