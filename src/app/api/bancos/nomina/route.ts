import * as XLSX from "xlsx";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { alcanzaEmpresa, ETIQUETA_ESTADO } from "@/lib/tesoreria";
import { abonosPorReferencia } from "@/lib/avisos";
import { codigoBanco, rutParaBanco } from "@/lib/banco-codigos";
import Decimal from "decimal.js";
import { dec } from "@/lib/money";

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
    // Decimal, no float: un total del Resumen que no cuadre al centavo con
    // la suma de la nómina es lo primero que marca un auditor.
    const total = lote.movements
      .reduce((acc, m) => acc.plus(dec(String(monto(m)))), dec(0))
      .toNumber();

    // Qué le falta a cada fila para que el banco la acepte.
    const faltantes = (m: (typeof lote.movements)[number]) =>
      [!m.rut && "RUT", !m.bankName && "banco", !m.accountNumber && "n° de cuenta"].filter(Boolean).join(", ");

    // ── Hoja 1 — "Transferencias": el formato de carga masiva de Santander,
    // columna por columna igual a los archivos reales del fondo (X24/X25):
    // A Cuenta origen · B Moneda origen · C Cuenta destino · D Moneda destino ·
    // E Código banco destino (SBIF) · F RUT beneficiario (sin puntos ni guión) ·
    // G Nombre · H Monto · I Glosa · J Correo · K Mensaje correo (=I) ·
    // L Glosa cartola originador (=I) · M Glosa cartola beneficiario.
    const cuentaOrigen = lote.company.cuentaOrigen ?? "";
    const transferencias: (string | number)[][] = [
      [
        "Cuenta origen\n(obligatorio)",
        "Moneda origen\n(obligatorio)",
        "Cuenta destino\n(obligatorio)",
        "Moneda destino\n(obligatorio)",
        "Código banco destino\n(obligatorio solo si banco destino no es Santander)",
        "RUT beneficiario\n(obligatorio solo si banco destino no es Santander)",
        "Nombre beneficiario\n(obligatorio solo si banco destino no es Santander)",
        "Monto transferencia\n(obligatorio)",
        "Glosa personalizada transferencia\n(opcional)",
        "Correo beneficiario\n(opcional)",
        "Mensaje correo beneficiario\n(opcional)",
        "Glosa cartola originador\n(opcional)",
        "Glosa cartola beneficiario\n(opcional, solo aplica si cuenta destino es Santander)",
      ],
      ...lote.movements.map((m) => {
        const glosa = (m.description ?? m.reference ?? "").slice(0, 60);
        return [
          cuentaOrigen,
          "CLP",
          (m.accountNumber ?? "").replace(/[^\dA-Za-z]/g, ""),
          "CLP",
          codigoBanco(m.bankName) ?? "",
          rutParaBanco(m.rut) ?? "",
          m.reference ?? "",
          monto(m),
          glosa,
          m.email ?? "",
          "", // K: fórmula =I (abajo)
          "", // L: fórmula =I (abajo)
          "PROVEEDORES",
        ];
      }),
    ];
    const wsTransfer = XLSX.utils.aoa_to_sheet(transferencias);
    // K y L como FÓRMULA =I, igual que en los archivos reales del banco: si
    // el usuario corrige una glosa, las tres columnas quedan consistentes.
    for (let r = 2; r <= lote.movements.length + 1; r++) {
      // Fórmula + valor cacheado, como hace Excel mismo (el archivo real del
      // banco trae ambos): sin el valor, el writer descarta la celda.
      const glosaCache = wsTransfer[`I${r}`]?.v ?? "";
      wsTransfer[`K${r}`] = { t: "s", v: glosaCache, f: `I${r}` };
      wsTransfer[`L${r}`] = { t: "s", v: glosaCache, f: `I${r}` };
    }
    wsTransfer["!cols"] = transferencias[0].map((_, i) => ({ wch: i === 6 || i === 8 ? 32 : 16 }));
    XLSX.utils.book_append_sheet(wb, wsTransfer, "Transferencias");

    // ── Hoja 2 — "Control de abonos": el total de cada referencia, lo abonado
    // antes, lo que va en este lote y la DIFERENCIA como fórmula de Excel —
    // si se edita un monto, la diferencia se descuenta sola.
    const grupos = await abonosPorReferencia(lote.companyId);
    const grupoDe = new Map(grupos.map((g) => [g.referencia, g]));
    const referenciasDelLote = [...new Set(lote.movements.map((m) => m.reference ?? "(sin referencia)"))];

    const control: (string | number)[][] = [
      [`${numero} — Control de abonos`],
      [],
      ["Referencia", "Total", "Abonado antes de este lote", "Este lote", "Diferencia (se descuenta sola)"],
    ];
    for (const ref of referenciasDelLote) {
      const esteLote = lote.movements
        .filter((m) => (m.reference ?? "(sin referencia)") === ref)
        .reduce((a, m) => a.plus(dec(String(m.debit ?? 0)).abs()), dec(0));
      const grupo = grupoDe.get(ref);
      // Los movimientos del lote ya están liberados → el grupo los cuenta como
      // avanzados: "abonado antes" es el avance sin lo de este lote.
      const abonadoAntes = grupo ? Decimal.max(dec(0), dec(grupo.avanzado).minus(esteLote)) : dec(0);
      const totalRef = grupo ? dec(grupo.total) : esteLote;
      control.push([ref, totalRef.toNumber(), abonadoAntes.toNumber(), esteLote.toNumber(), 0]);
    }
    control.push([]);
    control.push(["TOTAL DEL LOTE", "", "", 0, ""]);

    const wsControl = XLSX.utils.aoa_to_sheet(control);
    const primeraFila = 4; // los datos parten en la fila 4 (1-indexed)
    const ultimaFila = primeraFila + referenciasDelLote.length - 1;
    for (let r = primeraFila; r <= ultimaFila; r++) {
      wsControl[`E${r}`] = { t: "n", f: `B${r}-C${r}-D${r}` };
    }
    wsControl[`D${ultimaFila + 2}`] = { t: "n", f: `SUM(D${primeraFila}:D${ultimaFila})` };
    wsControl["!cols"] = [{ wch: 28 }, { wch: 16 }, { wch: 24 }, { wch: 16 }, { wch: 26 }];
    XLSX.utils.book_append_sheet(wb, wsControl, "Control de abonos");

    const incompletos = lote.movements.filter((m) => faltantes(m)).length;
    const sinCodigoBanco = lote.movements.filter((m) => m.bankName && codigoBanco(m.bankName) === null).length;

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
      ...(cuentaOrigen === ""
        ? [
            ["⚠ Falta la CUENTA ORIGEN de la empresa: la columna A de la hoja Transferencias va vacía."],
            ["El administrador del fondo la configura en Configuración → Cuenta origen para transferencias masivas."],
            [],
          ]
        : []),
      ...(sinCodigoBanco > 0
        ? [
            [`⚠ ${sinCodigoBanco} pago(s) tienen un banco que no se pudo mapear a código SBIF: la columna E va vacía en esas filas — completala a mano antes de cargar.`],
            [],
          ]
        : []),
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
