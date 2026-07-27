import { requireUser } from "@/lib/authz";
import { signOut } from "@/auth";
import { SidebarNav, type NavItem } from "@/components/sidebar-nav";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();
  const isAdmin = user.role === "FUND_ADMIN";

  const items: NavItem[] = [
    { href: "/", label: "Dashboard" },
    { href: "/ventas", label: "Ventas" },
    { href: "/gastos", label: "Gastos" },
    { href: "/capex", label: "CAPEX" },
    ...(isAdmin
      ? [
          { href: "/consolidado", label: "Consolidado" },
          { href: "/configuracion", label: "Configuración" },
        ]
      : []),
  ];

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col bg-brand-dark px-4 py-6">
        <div className="mb-8 px-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lavender">
            Cehta Capital
          </p>
          <p className="mt-1 text-lg font-bold leading-tight text-white">
            Presupuestos
          </p>
        </div>

        <SidebarNav items={items} />

        <div className="mt-auto border-t border-white/10 px-2 pt-4">
          <p className="truncate text-sm font-medium text-white">{user.name}</p>
          <p className="truncate text-xs text-white/60">
            {isAdmin ? "Fondo (AFIS/FIP)" : user.companyName ?? "—"}
          </p>
          <form action={doSignOut} className="mt-3">
            <button
              type="submit"
              className="w-full rounded-lg border border-white/20 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10"
            >
              Cerrar sesión
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line bg-white px-8 py-4">
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-lavender-bg px-3 py-1 text-xs font-semibold text-brand">
              {isAdmin ? "Vista fondo" : user.companyCode}
            </span>
            <span className="text-sm text-ink-soft">
              Año presupuestario <strong className="text-ink">2027</strong>
            </span>
          </div>
        </header>
        <main className="flex-1 bg-soft px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
