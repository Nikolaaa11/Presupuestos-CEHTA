import { describe, it, expect } from "vitest";
import { cifrarCon, derivarClave, descifrarCon } from "../cripto-core";

/**
 * El refresh token de Dropbox abre toda la carpeta financiera del grupo. Estas
 * pruebas fijan las cuatro propiedades de las que depende esa protección.
 */
describe("cifrado de secretos de terceros", () => {
  const clave = derivarClave("un-secreto-de-prueba-suficientemente-largo");
  const cifrar = (t: string) => cifrarCon(clave, t);
  const descifrar = (t: string) => descifrarCon(clave, t);

  it("lo que se cifra vuelve igual", () => {
    const token = "sl.B1a2b3-refresh-token-de-dropbox_con.simbolos";
    expect(descifrar(cifrar(token))).toBe(token);
  });

  it("el texto cifrado no contiene el secreto", () => {
    const token = "token-secretisimo-de-dropbox";
    expect(cifrar(token)).not.toContain(token);
  });

  // Si cifrar dos veces lo mismo diera igual, cualquiera con acceso a la base
  // podría saber que dos filas guardan el mismo secreto.
  it("cifrar dos veces lo mismo da resultados distintos", () => {
    const token = "mismo-token";
    expect(cifrar(token)).not.toBe(cifrar(token));
  });

  // GCM autentica además de cifrar: alterar un byte tiene que FALLAR, no
  // devolver basura que después alguien mande a Dropbox como si fuera un token.
  it("si alguien altera el texto cifrado, falla en vez de devolver basura", () => {
    const partes = cifrar("token-original").split(".");
    const datos = Buffer.from(partes[3], "base64url");
    datos[0] ^= 0xff; // un solo bit cambiado
    partes[3] = datos.toString("base64url");
    expect(() => descifrar(partes.join("."))).toThrow();
  });

  it("otra clave no puede leer el secreto", () => {
    const guardado = cifrar("token-del-fondo");
    const otra = derivarClave("un-secreto-distinto-igual-de-largo-que-el-otro");
    expect(() => descifrarCon(otra, guardado)).toThrow();
  });

  it("un formato que no reconoce se rechaza con un motivo", () => {
    expect(() => descifrar("cualquier-cosa")).toThrow(/formato/i);
    expect(() => descifrar("v9.a.b.c")).toThrow(/formato/i);
  });

  it("un secreto de servidor demasiado corto no se acepta", () => {
    expect(() => derivarClave("corto")).toThrow(/corto/i);
  });
});
