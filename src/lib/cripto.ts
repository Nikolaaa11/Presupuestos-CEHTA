import "server-only";
import { cifrarCon, derivarClave, descifrarCon } from "./cripto-core";

/**
 * La cara con acceso al entorno del cifrado de secretos. La lógica está en
 * `cripto-core.ts` para poder probarla; acá solo se resuelve la clave.
 */

function clave() {
  const base = process.env.AUTH_SECRET;
  if (!base) throw new Error("Falta AUTH_SECRET: no se puede cifrar el token de Dropbox");
  return derivarClave(base);
}

export const cifrar = (texto: string) => cifrarCon(clave(), texto);
export const descifrar = (guardado: string) => descifrarCon(clave(), guardado);
