import { CompanySelector } from "@/components/budget-grid/company-selector";
import { prisma } from "@/lib/prisma";
import { resolveViewCompany } from "@/lib/budget";
import { BancosClient, type MovementView, type SheetView } from "./bancos-client";

export default async function BancosPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string; planilla?: string }>;
}) {
  const { empresa, planilla } = await searchParams;
  const { user, company } = await resolveViewCompany(empresa);

  const [sheets, companies] = await Promise.all([
    prisma.bankSheet.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "desc" },
      include: {
        uploadedBy: { select: { name: true } },
        _count: { select: { movements: true } },
      },
    }),
    user.role === "FUND_ADMIN"
      ? prisma.company.findMany({ orderBy: { code: "asc" }, select: { code: true, name: true } })
      : Promise.resolve([]),
  ]);

  // Rendimiento: un groupBy cuenta los pendientes de todas las planillas de una
  // vez, en vez de traer los ids de cada movimiento pendiente solo para medirlos.
  const pendingBySheet = new Map(
    (
      await prisma.bankMovement.groupBy({
        by: ["sheetId"],
        where: { released: false, sheet: { companyId: company.id } },
        _count: { _all: true },
      })
    ).map((g) => [g.sheetId, g._count._all]),
  );

  const sheetViews: SheetView[] = sheets.map((s) => ({
    id: s.id,
    name: s.name,
    sourceFile: s.sourceFile,
    uploadedBy: s.uploadedBy?.name ?? "importación",
    createdAt: new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(s.createdAt),
    total: s._count.movements,
    pending: pendingBySheet.get(s.id) ?? 0,
  }));

  const selectedSheetId = planilla && sheetViews.some((s) => s.id === planilla)
    ? planilla
    : sheetViews[0]?.id ?? null;

  let movements: MovementView[] = [];
  if (selectedSheetId) {
    const rows = await prisma.bankMovement.findMany({
      where: { sheetId: selectedSheetId },
      orderBy: { rowIndex: "asc" },
      include: { releasedBy: { select: { name: true } } },
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
      docType: m.docType,
      docNumber: m.docNumber,
      email: m.email,
      link: m.link,
      released: m.released,
      releasedBy: m.releasedBy?.name ?? null,
      releasedAt: m.releasedAt
        ? new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(m.releasedAt)
        : null,
    }));
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">Bancos</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {company.name} — cartolas, transferencias y liberación de pagos
          </p>
        </div>
        {user.role === "FUND_ADMIN" && (
          <CompanySelector companies={companies} selectedCode={company.code} />
        )}
      </header>

      <BancosClient
        companyCode={company.code}
        sheets={sheetViews}
        selectedSheetId={selectedSheetId}
        movements={movements}
      />
    </div>
  );
}
