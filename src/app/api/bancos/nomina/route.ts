import * as XLSX from "xlsx";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { alcanzaEmpresa, ETIQUETA_ESTADO } from "@/lib/tesoreria";

/**
 * Descargas del módulo Bancos:
 *   ?lote=<id>      → NÓMINA BANCARIA del lote (carga masiva de transferencias)
 *   ?empresa=<code> → todos los movimientos de la empresa
 *
 * La nómina trae las columnas que pide la banca chilena para transferencias
 * masivas, más una hoja de resumen con quién liberó, quién subió el comprobante
 * y quién confirmó — la trazabilidad viaja con el archivo.
 */

const fmtFecha = (d: Date | null) =>
  d ? new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d) : "—";
const soloFecha = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const monto = (m: { debit: unknown; credit: unknown }) =>
  Math.abs(Number(String(m.debit ?? 0))) || Math.abs(Number(String(m.credit ?? 0)));

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return new Response("No autenticado", { status: 401 });

  const url = new URL(request.url);
  const loteId = url.searchParams.get("lote");
  const empresaCode = url.searchParams.get("empresa");

  const wb = XLSX.utils.book_new();
  let filename = "movimientos.xlsx";

  if (loteId) {
    const lote = await prisma.transferBatch.findUnique({
      where: { id: loteId },
      include: {
        company: true,
        releasedBy: { select: { name: true } },
        proofUploadedBy: { select: { name: true } },
        transferredBy: { select: { name: true } },
        movements: { orderBy: { rowIndex: "asc" } },
      },
    });
    if (!lote) return new Response("Lote no encontrado", { status: 404 });
    if (!alcanzaEmpresa(session.user, lote.companyId)) {
      return new Response("Sin acceso a esta empresa", { status: 403 });
    }

    const numero = `LOTE-${String(lote.number).padStart(3, "0")}`;
    const total = lote.movements.reduce((a, m) => a + monto(m), 0);

    // Qué le falta a cada fila para que el banco la acepte.
    const faltantes = (m: (typeof lote.movements)[number]) =>
      [!m.rut && "RUT", !m.bankName && "banco", !m.accountNumber && "n° de cuenta"].filter(Boolean).join(", ");

    // Hoja 1 — nómina lista para cargar en el banco
    const nomina: (string | number)[][] = [
      ["RUT", "Nombre / Razón social", "Banco", "Tipo de cuenta", "N° de cuenta", "Monto", "Correo", "Glosa / mensaje", "Revisar"],
      ...lote.movements.map((m) => {
        const falta = faltantes(m);
        return [
          m.rut ?? "",
          m.reference ?? "",
          m.bankName ?? "",
          m.accountType ?? "Cuenta Corriente",
          m.accountNumber ?? "",
          monto(m),
          m.email ?? "",
          (m.description ?? "").slice(0, 60),
          falta ? `⚠ falta ${falta}` : "OK",
        ];
      }),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(nomina), "Nómina");

    const incompletos = lote.movements.filter((m) => faltantes(m)).length;

    // Hoja 2 — resumen y trazabilidad del lote
    const resumen: (string | number)[][] = [
      [`${numero} — Nómina de transferencias`],
      [],
      ["Empresa que paga", lote.company.name],
      ["RUT empresa", lote.company.rut ?? "—"],
      ["Cantidad de pagos", lote.movements.length],
      ["Total a transferir", total],
      ["Estado", lote.status],
      [],
      ...(incompletos > 0
        ? [
            [`⚠ ATENCIÓN: ${incompletos} de ${lote.movements.length} pagos no tienen todos los datos bancarios.`],
            ["El banco rechaza las filas sin RUT, banco o número de cuenta. Completalos en la app (botón Editar) y volvé a descargar esta nómina."],
            [],
          ]
        : [["✓ Los datos bancarios están completos: la nómina se puede cargar en el banco."], []]),
      ["Liberado por", lote.releasedBy?.name ?? "—", fmtFecha(lote.releasedAt)],
      ["Comprobante subido por", lote.proofUploadedBy?.name ?? "—", fmtFecha(lote.proofUploadedAt)],
      ["Archivo del comprobante", lote.proofFileName ?? "—"],
      ["Transferencia confirmada por", lote.transferredBy?.name ?? "—", fmtFecha(lote.transferredAt)],
      ...(lote.note ? [[], ["Nota", lote.note]] : []),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), "Resumen");

    filename = `nomina-${lote.company.code}-${numero}.xlsx`;
  } else {
    const code = (empresaCode ?? "").toUpperCase().trim();
    const company = code
      ? await prisma.company.findUnique({ where: { code } })
      : session.user.companyId
        ? await prisma.company.findUnique({ where: { id: session.user.companyId } })
        : null;
    if (!company) return new Response("Empresa no encontrada", { status: 400 });
    if (!alcanzaEmpresa(session.user, company.id)) {
      return new Response("Sin acceso a esta empresa", { status: 403 });
    }

    const sheets = await prisma.bankSheet.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "asc" },
      include: {
        movements: { orderBy: { rowIndex: "asc" }, include: { batch: { select: { number: true } } } },
      },
    });

    for (const sheet of sheets) {
      const filas: (string | number)[][] = [
        [`${company.name} — ${sheet.name}`],
        [`Origen: ${sheet.sourceFile}`],
        [],
        ["Fecha", "Referencia", "Descripción", "Abono", "Egreso", "Saldo", "Categoría", "Centro negocio", "RUT", "Banco", "N° cuenta", "Correo", "Estado", "Lote"],
        ...sheet.movements.map((m) => [
          soloFecha(m.date ?? m.entryDate),
          m.reference ?? "",
          m.description ?? "",
          Number(String(m.credit)),
          Number(String(m.debit)),
          m.balance ? Number(String(m.balance)) : "",
          m.categoryGeneral ?? "",
          m.businessCenter ?? "",
          m.rut ?? "",
          m.bankName ?? "",
          m.accountNumber ?? "",
          m.email ?? "",
          ETIQUETA_ESTADO[m.estado] ?? m.estado,
          m.batch ? `LOTE-${String(m.batch.number).padStart(3, "0")}` : "",
        ]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), sheet.name.slice(0, 31));
    }

    if (sheets.length === 0) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Sin planillas cargadas"]]), "Vacío");
    }
    filename = `bancos-${company.code}.xlsx`;
  }

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
