import { CompanySelector } from "@/components/budget-grid/company-selector";
import { prisma } from "@/lib/prisma";
import { resolveViewCompany } from "@/lib/budget";
import { avancesOC } from "@/lib/avisos";
import { dec, formatMoney } from "@/lib/money";
import { ETIQUETA_ACCION, puede, ROLES_DUENO, ROLES_COMPROBANTE, ROLES_EDICION } from "@/lib/tesoreria";
import { BancosClient, type AvanceOCView, type BitacoraEntry, type LoteView, type MovementView, type SheetView } from "./bancos-client";

const fechaHora = (d: Date) =>
  new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
const fechaCorta = (d: Date) =>
  new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);

export default async function BancosPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string; planilla?: string }>;
}) {
  const { empresa, planilla } = await searchParams;
  const { user, company } = await resolveViewCompany(empresa);

  const [sheets, companies, lotes, bitacora, pendingGroups, avances] = await Promise.all([
    prisma.bankSheet.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "desc" },
      include: { uploadedBy: { select: { name: true } }, _count: { select: { movements: true } } },
    }),
    user.role === "COMPANY_MANAGER"
      ? Promise.resolve([])
      : prisma.company.findMany({ orderBy: { code: "asc" }, select: { code: true, name: true } }),
    prisma.transferBatch.findMany({
      where: { companyId: company.id },
      orderBy: { number: "desc" },
      take: 20,
      include: {
        releasedBy: { select: { name: true } },
        proofUploadedBy: { select: { name: true } },
        transferredBy: { select: { name: true } },
        movements: { select: { debit: true, credit: true } },
      },
    }),
    prisma.bankEvent.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { actor: { select: { name: true } } },
    }),
    prisma.bankMovement.groupBy({
      by: ["sheetId"],
      where: { estado: "PENDIENTE", sheet: { companyId: company.id } },
      _count: { _all: true },
    }),
    avancesOC(company.id),
  ]);

  // Avance por orden de compra: el "pago por etapas" de Bancos. Las OCs vienen
  // como varios movimientos con la misma referencia; acá viajan ya formateados.
  const avanceViews: AvanceOCView[] = avances.map((a) => ({
    referencia: a.referencia,
    total: formatMoney(a.total, "CLP"),
    avanzado: formatMoney(a.avanzado, "CLP"),
    pendiente: formatMoney(a.pendiente, "CLP"),
    porcentaje: a.porcentaje,
    proximoPago: a.fechaProximoPago ? fechaCorta(new Date(a.fechaProximoPago)) : null,
    movimientos: a.cantidadMovimientos,
    completa: dec(a.pendiente).lte(0),
  }));

  const pendingBySheet = new Map(pendingGroups.map((g) => [g.sheetId, g._count._all]));

  const sheetViews: SheetView[] = sheets.map((s) => ({
    id: s.id,
    name: s.name,
    sourceFile: s.sourceFile,
    uploadedBy: s.uploadedBy?.name ?? "importación",
    createdAt: fechaCorta(s.createdAt),
    total: s._count.movements,
    pending: pendingBySheet.get(s.id) ?? 0,
  }));

  // Se abre la planilla con más pagos pendientes: es lo que tesorería mira primero.
  const defaultSheet = [...sheetViews].sort((a, b) => b.pending - a.pending || b.total - a.total)[0];
  const selectedSheetId =
    planilla && sheetViews.some((s) => s.id === planilla) ? planilla : defaultSheet?.id ?? null;

  let movements: MovementView[] = [];
  if (selectedSheetId) {
    const rows = await prisma.bankMovement.findMany({
      where: { sheetId: selectedSheetId },
      orderBy: { rowIndex: "asc" },
      include: { batch: { select: { number: true } } },
    });
    movements = rows.map((m) => ({
      id: m.id,
      date: m.date ? m.date.toISOString().slice(0, 10) : null,
      entryDate: m.entryDate ? m.entryDate.toISOString().slice(0, 10) : null,
      reference: m.reference,
      description: m.description,
      credit: m.credit.toString(),
      debit: m.debit.toString(),
      categoryGeneral: m.categoryGeneral,
      businessCenter: m.businessCenter,
      rut: m.rut,
      bankName: m.bankName,
      accountNumber: m.accountNumber,
      accountType: m.accountType,
      email: m.email,
      estado: m.estado,
      lote: m.batch ? `LOTE-${String(m.batch.number).padStart(3, "0")}` : null,
    }));
  }

  const loteViews: LoteView[] = lotes.map((l) => ({
    id: l.id,
    numero: `LOTE-${String(l.number).padStart(3, "0")}`,
    status: l.status,
    pagos: l.movements.length,
    // Suma con Decimal — nunca aritmética float sobre montos.
    total: l.movements
      .reduce((acc, m) => {
        const debit = dec(m.debit).abs();
        return acc.plus(debit.isZero() ? dec(m.credit).abs() : debit);
      }, dec(0))
      .toFixed(2),
    liberadoPor: l.releasedBy?.name ?? "—",
    liberadoEl: fechaHora(l.releasedAt),
    comprobante: l.proofFileName,
    comprobantePor: l.proofUploadedBy?.name ?? null,
    transferidoPor: l.transferredBy?.name ?? null,
    transferidoEl: l.transferredAt ? fechaHora(l.transferredAt) : null,
    nota: l.note,
  }));

  const bitacoraViews: BitacoraEntry[] = bitacora.map((e) => ({
    id: e.id,
    quien: e.actor?.name ?? "sistema",
    accion: ETIQUETA_ACCION[e.action] ?? e.action,
    detalle: e.detail,
    cuando: fechaHora(e.createdAt),
  }));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">Bancos y tesorería</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {company.name}
            {company.rut ? ` · ${company.rut}` : ""} — liberación, transferencias y bitácora
          </p>
        </div>
        {user.role !== "COMPANY_MANAGER" && (
          <CompanySelector companies={companies} selectedCode={company.code} />
        )}
      </header>

      <BancosClient
        companyCode={company.code}
        sheets={sheetViews}
        selectedSheetId={selectedSheetId}
        movements={movements}
        lotes={loteViews}
        avancesOC={avanceViews}
        bitacora={bitacoraViews}
        permisos={{
          libera: puede(user, ROLES_DUENO),
          comprobante: puede(user, ROLES_COMPROBANTE),
          edita: puede(user, ROLES_EDICION),
        }}
        quienSoy={user.name ?? user.email ?? "vos"}
      />
    </div>
  );
}
