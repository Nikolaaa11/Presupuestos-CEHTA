import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { auth } from "@/auth";
import { credencialesConfiguradas, urlDeAutorizacion } from "@/lib/dropbox";

/**
 * Arranca la conexión con Dropbox: manda al usuario a autorizar la app.
 *
 * El `state` es un valor al azar que se guarda en una cookie y se compara al
 * volver. Sin eso, alguien podría hacerle abrir a Guido una URL de retorno
 * preparada y dejar la plataforma conectada a OTRA cuenta de Dropbox — y desde
 * ahí ver todo lo que se importe.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return new Response("No autenticado", { status: 401 });
  // Conectar la cuenta del fondo es administración de la plataforma.
  if (session.user.role !== "FUND_ADMIN") {
    return new Response("Tu rol no permite conectar Dropbox", { status: 403 });
  }
  if (!credencialesConfiguradas()) {
    return new Response(
      "Faltan las credenciales de Dropbox (DROPBOX_APP_KEY y DROPBOX_APP_SECRET)",
      { status: 503 },
    );
  }

  const state = randomBytes(24).toString("base64url");
  const jar = await cookies();
  jar.set("dropbox_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // debe sobrevivir la vuelta desde dropbox.com
    path: "/",
    maxAge: 600, // 10 minutos: lo que dura autorizar, no más
  });

  const origen = new URL(request.url).origin;
  return Response.redirect(urlDeAutorizacion(origen, state), 302);
}
