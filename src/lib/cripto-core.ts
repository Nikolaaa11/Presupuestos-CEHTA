import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Cifrado de secretos que la plataforma guarda por cuenta de terceros — hoy, el
 * refresh token de Dropbox.
 *
 * Vive separado de `cripto.ts` —que es el que lee AUTH_SECRET y lleva
 * `server-only`— para poder probarlo, mismo patrón que tesoreria-core.
 *
 * Por qué cifrar y no confiar en la base: ese token abre TODA la carpeta
 * financiera del grupo. Un volcado, un backup mal guardado o una consulta de
 * más no deberían alcanzar para entrar a Dropbox.
 *
 * AES-256-GCM además de cifrar AUTENTICA: si alguien altera un byte del texto
 * cifrado, el descifrado falla en vez de devolver basura que después se
 * mandaría a Dropbox como si fuera un token.
 */

const VERSION = "v1";

/**
 * La clave sale del secreto del servidor vía HKDF con un `info` propio, así la
 * clave de cifrado y la de sesiones son distintas aunque nazcan del mismo
 * secreto: comprometer una no entrega la otra.
 */
export function derivarClave(secreto: string): Buffer {
  if (!secreto || secreto.length < 16) {
    // Falla fuerte y temprano: cifrar con una clave vacía es peor que no
    // cifrar, porque deja la sensación de que el secreto está protegido.
    throw new Error("El secreto del servidor es demasiado corto para derivar una clave");
  }
  return Buffer.from(hkdfSync("sha256", secreto, "cehta-cripto", "dropbox-token", 32));
}

/** Devuelve "v1.<iv>.<tag>.<datos>" en base64url — todo lo necesario para descifrar. */
export function cifrarCon(clave: Buffer, texto: string): string {
  const iv = randomBytes(12); // 96 bits, lo que recomienda GCM
  const c = createCipheriv("aes-256-gcm", clave, iv);
  const datos = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return [
    VERSION,
    iv.toString("base64url"),
    c.getAuthTag().toString("base64url"),
    datos.toString("base64url"),
  ].join(".");
}

export function descifrarCon(clave: Buffer, guardado: string): string {
  const [version, iv, tag, datos] = guardado.split(".");
  if (version !== VERSION || !iv || !tag || !datos) {
    throw new Error("El secreto guardado no tiene el formato esperado");
  }
  const d = createDecipheriv("aes-256-gcm", clave, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(datos, "base64url")), d.final()]).toString("utf8");
}
