import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { auth } from "@/auth";
import { canjearCodigo, cuentaActual, guardarConexion } from "@/lib/dropbox";

/**
 * La vuelta desde Dropbox. Acá llega el `code` que se canjea por el refresh
 * token, que es lo único que se guarda (cifrado).
 *
 * Nunca se muestra un token en pantalla ni se escribe en un log: si algo falla,
 * el usuario ve un motivo en castellano y nada más.
 */
const volver = (origen: string, params: Record<string, string>) =>
  Response.redirect(`${origen}/configuracion?${new URLSearchParams(params).toString()}`, 302);

/** Comparación en tiempo constante: el state no se compara con ===. */
function coincide(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origen = url.origin;

  const session = await auth();
  if (!session?.user?.id || session.user.role !== "FUND_ADMIN") {
    return new Response("No autorizado", { status: 403 });
  }

  const jar = await cookies();
  const esperado = jar.get("dropbox_state")?.value;
  jar.delete("dropbox_state"); // de un solo uso, salga como salga

  // Dropbox avisa acá si la persona apretó "Cancelar".
  const error = url.searchParams.get("error");
  if (error) {
    return volver(origen, {
      dropbox: "error",
      motivo: error === "access_denied" ? "Cancelaste la conexión con Dropbox." : "Dropbox no autorizó la conexión.",
    });
  }

  const state = url.searchParams.get("state");
  const codigo = url.searchParams.get("code");
  if (!esperado || !state || !coincide(esperado, state)) {
    return volver(origen, {
      dropbox: "error",
      motivo: "La conexión no se pudo verificar. Empezá de nuevo desde Configuración.",
    });
  }
  if (!codigo) {
    return volver(origen, { dropbox: "error", motivo: "Dropbox no devolvió el código de autorización." });
  }

  try {
    const token = await canjearCodigo(codigo, origen);
    if (!token.refresh_token) {
      // Sin refresh token la conexión se muere en horas: mejor no guardarla.
      return volver(origen, {
        dropbox: "error",
        motivo: "Dropbox no entregó un permiso duradero. Desconectá la app desde tu cuenta de Dropbox y conectá de nuevo.",
      });
    }
    const cuenta = await cuentaActual(token.access_token);
    await guardarConexion({
      refreshToken: token.refresh_token,
      scopes: token.scope ?? null,
      cuenta,
      usuarioId: session.user.id,
    });
    return volver(origen, { dropbox: "conectado" });
  } catch (e) {
    return volver(origen, {
      dropbox: "error",
      motivo: e instanceof Error ? e.message : "No se pudo completar la conexión con Dropbox.",
    });
  }
}
