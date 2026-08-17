/**
 * ¿Las credenciales de Dropbox están bien pegadas y son válidas?
 *
 * No alcanza con mirar que las líneas no estén vacías: un espacio invisible al
 * final, arrastrado al copiar de la página de Dropbox, deja el archivo con
 * pinta de correcto y la conexión falla recién al usarla.
 *
 * El truco para validarlas sin abrir el navegador: se pide un token con un
 * `code` deliberadamente falso. Dropbox responde distinto según qué esté mal:
 *   invalid_client → la App key o el App secret no son correctos
 *   invalid_grant  → las credenciales SON correctas; lo que falla es el code,
 *                    que justamente inventamos nosotros
 *
 * Nunca imprime el valor de una credencial.
 *
 * Uso: node scripts/verificar-dropbox.mjs
 */
import { readFileSync } from "node:fs";

const bruto = readFileSync(".env", "utf8");
const leer = (clave) => {
  const linea = bruto.split(/\r?\n/).find((l) => l.startsWith(`${clave}=`));
  return linea === undefined ? null : linea.slice(clave.length + 1);
};

const resultados = [];
const check = (nombre, cond, detalle = "") => {
  resultados.push(cond);
  console.log(`${cond ? "✓" : "✗"} ${nombre}${detalle ? " — " + detalle : ""}`);
};

const crudos = {
  DROPBOX_APP_KEY: leer("DROPBOX_APP_KEY"),
  DROPBOX_APP_SECRET: leer("DROPBOX_APP_SECRET"),
};

const limpios = {};
for (const [clave, crudo] of Object.entries(crudos)) {
  if (crudo === null) {
    check(`${clave} está en el archivo`, false, "no se encontró la línea");
    continue;
  }
  const sinComillas = crudo.replace(/^["']|["']$/g, "");
  const limpio = sinComillas.trim();
  limpios[clave] = limpio;

  check(`${clave} tiene valor`, limpio.length > 0, `${limpio.length} caracteres`);
  if (limpio.length === 0) continue;

  // El error que más engaña: un espacio al final que no se ve.
  check(
    `${clave} sin espacios de más`,
    sinComillas === limpio,
    sinComillas === limpio ? "" : "¡tiene espacios al principio o al final! hay que sacarlos",
  );
  // Las credenciales de Dropbox son alfanuméricas.
  check(
    `${clave} sin caracteres raros`,
    /^[A-Za-z0-9_-]+$/.test(limpio),
    /^[A-Za-z0-9_-]+$/.test(limpio) ? "" : "hay algún carácter que no corresponde (¿se copió de más?)",
  );
}

const key = limpios.DROPBOX_APP_KEY;
const secret = limpios.DROPBOX_APP_SECRET;

if (key && secret) {
  console.log("\nPreguntándole a Dropbox si el par key/secret es válido…");
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${key}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: "codigo-a-proposito-invalido",
      redirect_uri: "http://localhost:3000/api/dropbox/callback",
    }),
  });
  const cuerpo = await res.json().catch(() => ({}));
  const error = cuerpo.error ?? "";

  if (error === "invalid_grant") {
    check("Dropbox reconoce la App key y el App secret", true, "el par es correcto");
  } else if (error === "invalid_client") {
    check("Dropbox reconoce la App key y el App secret", false,
      "invalid_client: alguna de las dos está mal copiada");
  } else {
    check("Dropbox reconoce la App key y el App secret", false,
      `respuesta inesperada (${res.status}): ${JSON.stringify(cuerpo).slice(0, 160)}`);
  }
}

const ok = resultados.filter(Boolean).length;
console.log(`\n${ok}/${resultados.length} comprobaciones OK`);
process.exit(ok === resultados.length ? 0 : 1);
