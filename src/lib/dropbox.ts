import "server-only";
import { prisma } from "@/lib/prisma";
import { cifrar, descifrar } from "@/lib/cripto";

/**
 * Cliente de Dropbox para la plataforma.
 *
 * Solo LECTURA: los permisos pedidos son `account_info.read`,
 * `files.metadata.read` y `files.content.read`. La app no puede escribir en el
 * Dropbox del fondo ni aunque quisiera — la decisión es del lado de Dropbox,
 * no de una condición en este archivo.
 *
 * La plataforma corre en Vercel: no puede leer `D:\Dropbox\…`. Lo que sí puede
 * es hablar con la nube de Dropbox, donde el cliente de escritorio ya subió
 * esos mismos archivos.
 */

const API = "https://api.dropboxapi.com/2";
const CONTENIDO = "https://content.dropboxapi.com/2";
const TOKEN = "https://api.dropboxapi.com/oauth2/token";
const AUTORIZAR = "https://www.dropbox.com/oauth2/authorize";

/** Solo lectura, y lo mínimo. */
export const SCOPES = ["account_info.read", "files.metadata.read", "files.content.read"] as const;

export const CONEXION_ID = "unica";

export function credencialesConfiguradas(): boolean {
  return Boolean(process.env.DROPBOX_APP_KEY && process.env.DROPBOX_APP_SECRET);
}

function credenciales() {
  const key = process.env.DROPBOX_APP_KEY;
  const secret = process.env.DROPBOX_APP_SECRET;
  if (!key || !secret) throw new Error("No se puede: falta configurar las credenciales de Dropbox");
  return { key, secret };
}

/**
 * La dirección de retorno tiene que coincidir EXACTA con la registrada en
 * Dropbox, incluido el path.
 *
 * Derivarla de la URL de la petición tiene una trampa: si alguien entra por la
 * URL de un deploy concreto (presupuestos-cehta-92whrb92o-….vercel.app) en vez
 * del alias estable, la dirección calculada no es la registrada y Dropbox
 * rechaza la conexión sin que nada esté "mal". Por eso se puede fijar con
 * DROPBOX_REDIRECT_URI, y la pantalla muestra cuál está usando.
 */
export function urlDeRetorno(origen: string): string {
  const fijada = process.env.DROPBOX_REDIRECT_URI?.trim();
  if (fijada) return fijada;
  return `${origen.replace(/\/$/, "")}/api/dropbox/callback`;
}

/**
 * `token_access_type=offline` es lo que hace que Dropbox devuelva un refresh
 * token. Sin eso el acceso vence en horas y la sincronización se muere sola.
 */
export function urlDeAutorizacion(origen: string, state: string): string {
  const { key } = credenciales();
  const p = new URLSearchParams({
    client_id: key,
    response_type: "code",
    redirect_uri: urlDeRetorno(origen),
    token_access_type: "offline",
    scope: SCOPES.join(" "),
    state,
  });
  return `${AUTORIZAR}?${p.toString()}`;
}

type RespuestaToken = {
  access_token: string;
  refresh_token?: string;
  scope?: string;
  account_id?: string;
  error?: string;
  error_description?: string;
};

async function pedirToken(cuerpo: Record<string, string>): Promise<RespuestaToken> {
  const { key, secret } = credenciales();
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${key}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(cuerpo),
  });
  const json = (await res.json().catch(() => ({}))) as RespuestaToken;
  if (!res.ok || json.error) {
    // Cada causa tiene su arreglo distinto, así que el mensaje tiene que
    // distinguirlas. La versión anterior decía "revisá las credenciales" para
    // cualquier fallo — incluidos los que no tenían nada que ver.
    if (json.error === "invalid_client") {
      throw new Error(
        "Dropbox no reconoce la App key o el App secret cargados en Vercel. Volvé a copiarlos desde dropbox.com/developers/apps → Settings.",
      );
    }
    if (json.error === "invalid_grant") {
      throw new Error(
        "Dropbox rechazó el código de autorización. Suele pasar si la dirección de retorno no es idéntica a la registrada, o si pasó demasiado tiempo. Probá conectar de nuevo.",
      );
    }
    // El código de error de Dropbox no es información sensible y es lo único
    // que permite diagnosticar el resto de los casos.
    throw new Error(
      `Dropbox devolvió un error al pedir el permiso${json.error ? ` (${json.error})` : ` (HTTP ${res.status})`}.`,
    );
  }
  return json;
}

/**
 * ¿Vercel tiene cargadas unas credenciales que Dropbox reconozca?
 *
 * Se pide un token con un código a propósito inválido: si el par key/secret
 * está mal, Dropbox responde `invalid_client`; si está bien, responde
 * `invalid_grant` — porque lo único malo es el código, que inventamos nosotros.
 * Así se comprueba sin que nadie tenga que autorizar nada.
 *
 * Hace falta porque las variables sensibles de Vercel no se pueden leer de
 * vuelta: sin esto, unas credenciales mal pegadas solo se descubren cuando
 * alguien intenta conectar y falla.
 */
export async function probarCredenciales(): Promise<{ ok: boolean; motivo?: string }> {
  if (!credencialesConfiguradas()) {
    return { ok: false, motivo: "Faltan DROPBOX_APP_KEY o DROPBOX_APP_SECRET en las variables de entorno." };
  }
  try {
    const { key, secret } = credenciales();
    const res = await fetch(TOKEN, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${key}:${secret}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "codigo-a-proposito-invalido",
        redirect_uri: "http://localhost/no-usado",
      }),
    });
    const json = (await res.json().catch(() => ({}))) as RespuestaToken;
    if (json.error === "invalid_grant") return { ok: true };
    if (json.error === "invalid_client") {
      return {
        ok: false,
        motivo: "Dropbox no reconoce la App key o el App secret. Volvé a copiarlos desde Settings de tu app en Dropbox.",
      };
    }
    return { ok: false, motivo: `Dropbox respondió ${json.error ?? `HTTP ${res.status}`}.` };
  } catch {
    return { ok: false, motivo: "No se pudo contactar a Dropbox para comprobar las credenciales." };
  }
}

export async function canjearCodigo(codigo: string, origen: string) {
  return pedirToken({
    grant_type: "authorization_code",
    code: codigo,
    redirect_uri: urlDeRetorno(origen),
  });
}

/**
 * Un access token dura pocas horas; el refresh token no vence. Se pide uno
 * nuevo en cada operación en vez de guardarlo: son 200 ms y evita la clase
 * entera de bugs de "el token guardado venció y nadie se enteró".
 */
async function accessTokenVigente(): Promise<{ token: string; namespaceId: string | null }> {
  const conexion = await prisma.dropboxConnection.findUnique({ where: { id: CONEXION_ID } });
  if (!conexion) throw new Error("No se puede: Dropbox no está conectado");
  const refresh = descifrar(conexion.refreshTokenCifrado);
  const { access_token } = await pedirToken({ grant_type: "refresh_token", refresh_token: refresh });
  return { token: access_token, namespaceId: conexion.rootNamespaceId };
}

async function llamar<T>(ruta: string, cuerpo: unknown, base = API): Promise<T> {
  const { token, namespaceId } = await accessTokenVigente();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  // Dropbox Business: sin esto, la app ve el espacio personal del usuario y no
  // encuentra las carpetas del equipo. Con esto apunta a la raíz del equipo.
  if (namespaceId) {
    headers["Dropbox-API-Path-Root"] = JSON.stringify({ ".tag": "root", root: namespaceId });
  }
  const res = await fetch(`${base}${ruta}`, {
    method: "POST",
    headers,
    body: cuerpo === null ? "null" : JSON.stringify(cuerpo),
  });
  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("Dropbox pidió esperar un momento (demasiadas consultas). Probá de nuevo en un minuto.");
    if (detalle.includes("path/not_found")) throw new Error("No se encontró esa carpeta en Dropbox. ¿La moviste o le cambiaste el nombre?");
    throw new Error("Dropbox devolvió un error al leer la carpeta");
  }
  return (await res.json()) as T;
}

export type CuentaDropbox = {
  nombre: string;
  email: string | null;
  esEquipo: boolean;
  rootNamespaceId: string | null;
};

/**
 * Quién quedó conectado. De acá sale si la cuenta es personal o de equipo:
 * `root_info` viene con `.tag: "team"` en las cuentas Business, y su
 * `root_namespace_id` es el que hay que usar para ver las carpetas compartidas.
 */
export async function cuentaActual(accessToken: string): Promise<CuentaDropbox> {
  const res = await fetch(`${API}/users/get_current_account`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("No se pudo leer la cuenta de Dropbox");
  const j = (await res.json()) as {
    name?: { display_name?: string };
    email?: string;
    root_info?: { ".tag"?: string; root_namespace_id?: string; home_namespace_id?: string };
  };
  const raiz = j.root_info ?? {};
  const esEquipo = raiz[".tag"] === "team";
  return {
    nombre: j.name?.display_name ?? "cuenta de Dropbox",
    email: j.email ?? null,
    esEquipo,
    // Solo hace falta apuntar explícitamente cuando la raíz del equipo NO es la
    // carpeta personal del usuario.
    rootNamespaceId:
      esEquipo && raiz.root_namespace_id && raiz.root_namespace_id !== raiz.home_namespace_id
        ? raiz.root_namespace_id
        : null,
  };
}

export type EntradaDropbox = {
  tipo: "archivo" | "carpeta";
  nombre: string;
  ruta: string;
  tamano: number | null;
  modificado: string | null;
  /** Identifica la VERSIÓN exacta del archivo: con esto se sabe si cambió. */
  rev: string | null;
};

type EntradaCruda = {
  ".tag": string;
  name: string;
  path_display?: string;
  path_lower?: string;
  size?: number;
  server_modified?: string;
  rev?: string;
};

const aEntrada = (e: EntradaCruda): EntradaDropbox => ({
  tipo: e[".tag"] === "folder" ? "carpeta" : "archivo",
  nombre: e.name,
  ruta: e.path_display ?? e.path_lower ?? "",
  tamano: e.size ?? null,
  modificado: e.server_modified ?? null,
  rev: e.rev ?? null,
});

/** Lista una carpeta. `recursivo` baja por todo el árbol. */
export async function listarCarpeta(
  ruta: string,
  recursivo = false,
  maxPaginas = 20,
): Promise<{ entradas: EntradaDropbox[]; cursor: string; truncado: boolean }> {
  // Dropbox pide cadena vacía para la raíz, no "/".
  const path = ruta === "/" || ruta === "" ? "" : ruta.replace(/\/$/, "");
  let r = await llamar<{ entries: EntradaCruda[]; cursor: string; has_more: boolean }>("/files/list_folder", {
    path,
    recursive: recursivo,
    include_deleted: false,
    limit: 2000,
  });
  const entradas = r.entries.map(aEntrada);
  let paginas = 1;
  while (r.has_more && paginas < maxPaginas) {
    r = await llamar("/files/list_folder/continue", { cursor: r.cursor });
    entradas.push(...r.entries.map(aEntrada));
    paginas++;
  }
  // `truncado` se dice en pantalla: una carpeta a medias que se muestra como
  // completa es peor que una lista con un aviso.
  return { entradas, cursor: r.cursor, truncado: r.has_more };
}

/** Qué cambió desde el cursor guardado. Esto es «ir actualizando». */
export async function cambiosDesde(cursor: string): Promise<{ entradas: EntradaDropbox[]; cursor: string }> {
  let r = await llamar<{ entries: EntradaCruda[]; cursor: string; has_more: boolean }>(
    "/files/list_folder/continue",
    { cursor },
  );
  const entradas = r.entries.map(aEntrada);
  let paginas = 1;
  while (r.has_more && paginas < 20) {
    r = await llamar("/files/list_folder/continue", { cursor: r.cursor });
    entradas.push(...r.entries.map(aEntrada));
    paginas++;
  }
  return { entradas, cursor: r.cursor };
}

/** Baja un archivo. El tope evita que un archivo enorme tumbe la función. */
export async function descargar(ruta: string, maxBytes = 12 * 1024 * 1024): Promise<Buffer> {
  const { token, namespaceId } = await accessTokenVigente();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Dropbox-API-Arg": JSON.stringify({ path: ruta }),
  };
  if (namespaceId) {
    headers["Dropbox-API-Path-Root"] = JSON.stringify({ ".tag": "root", root: namespaceId });
  }
  const res = await fetch(`${CONTENIDO}/files/download`, { method: "POST", headers });
  if (!res.ok) throw new Error("No se pudo bajar el archivo de Dropbox");
  const largo = Number(res.headers.get("content-length") ?? 0);
  if (largo > maxBytes) throw new Error(`El archivo supera el límite de ${Math.round(maxBytes / 1024 / 1024)} MB`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new Error("El archivo supera el límite de tamaño");
  return buf;
}

/** Guarda la conexión. El refresh token entra cifrado y nunca sale de acá. */
export async function guardarConexion(datos: {
  refreshToken: string;
  scopes: string | null;
  cuenta: CuentaDropbox;
  usuarioId: string;
}) {
  const comun = {
    refreshTokenCifrado: cifrar(datos.refreshToken),
    scopes: datos.scopes,
    cuentaNombre: datos.cuenta.nombre,
    cuentaEmail: datos.cuenta.email,
    esEquipo: datos.cuenta.esEquipo,
    rootNamespaceId: datos.cuenta.rootNamespaceId,
    conectadoPorId: datos.usuarioId,
    conectadoEl: new Date(),
  };
  await prisma.dropboxConnection.upsert({
    where: { id: CONEXION_ID },
    create: { id: CONEXION_ID, ...comun },
    // Reconectar no arrastra el cursor ni la carpeta de la conexión anterior:
    // pueden ser de otra cuenta y quedarían apuntando a la nada.
    update: { ...comun, cursor: null, carpetaRaiz: null },
  });
}
