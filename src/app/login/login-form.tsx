"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink-soft">Correo</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="demo.cenergy@cehta.cl"
          className="rounded-lg border border-line px-3.5 py-2.5 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-lavender-bg"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink-soft">Contraseña</span>
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          placeholder="••••••••"
          className="rounded-lg border border-line px-3.5 py-2.5 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-lavender-bg"
        />
      </label>

      {state.error && (
        <p className="rounded-lg bg-danger-bg px-3.5 py-2.5 text-sm text-danger">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-deep disabled:opacity-60"
      >
        {pending ? "Ingresando..." : "Ingresar"}
      </button>
    </form>
  );
}
