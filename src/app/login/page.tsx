import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <main className="flex min-h-screen items-center justify-center bg-soft px-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-line bg-white p-8 shadow-sm">
          <div className="mb-8">
            <p className="text-xs font-semibold uppercase tracking-widest text-brand">
              Cehta Capital
            </p>
            <h1 className="mt-2 text-2xl font-bold text-ink">
              Presupuestos CEHTA
            </h1>
            <p className="mt-1 text-sm text-ink-soft">
              Presupuesto anual por empresa — Ventas, Gastos y CAPEX
            </p>
          </div>
          <LoginForm />
        </div>

        <div className="mt-4 rounded-xl bg-lavender-bg px-5 py-4 text-xs leading-relaxed text-brand-dark">
          <p className="font-semibold">Acceso demo</p>
          <p>
            Gerencias: <code>demo.&lt;empresa&gt;@cehta.cl</code> · clave{" "}
            <code>Demo2026!</code>
          </p>
          <p>
            Fondo: <code>admin@cehta.cl</code> · clave <code>Cehta2026!</code>
          </p>
        </div>
      </div>
    </main>
  );
}
