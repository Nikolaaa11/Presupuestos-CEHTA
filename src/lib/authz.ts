import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

/**
 * Guards de autorización — defensa en profundidad.
 * TODA página protegida y TODO server action deben pasar por acá,
 * independiente de lo que haga la UI. La UI puede mentir; el servidor no.
 */

export type SessionUser = {
  id: string;
  role: string;
  companyId: string | null;
  companyCode: string | null;
  companyName: string | null;
  email?: string | null;
  name?: string | null;
};

/** Usuario autenticado o redirect a /login. */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user as SessionUser;
}

/** Solo FUND_ADMIN. Lanza en actions; redirect en páginas lo maneja el caller. */
export async function requireFundAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "FUND_ADMIN") redirect("/");
  return user;
}

/**
 * Acceso a los datos de una empresa:
 *  - FUND_ADMIN → cualquiera
 *  - COMPANY_MANAGER → solo la suya
 */
export async function requireCompanyAccess(companyId: string): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role === "FUND_ADMIN") return user;
  if (user.role === "COMPANY_MANAGER" && user.companyId === companyId) return user;
  throw new Error("Sin permiso sobre esta empresa");
}

/** Empresa efectiva para vistas de manager (la propia) o admin (elegida via param). */
export function resolveCompanyId(user: SessionUser, requested?: string | null): string {
  if (user.role === "FUND_ADMIN") {
    if (!requested) throw new Error("FUND_ADMIN debe indicar empresa");
    return requested;
  }
  if (!user.companyId) throw new Error("Usuario sin empresa asignada");
  return user.companyId;
}
