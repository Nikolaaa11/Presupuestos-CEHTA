/**
 * Carga en Vercel las credenciales de Dropbox tomándolas del `.env` local.
 *
 * Por qué existe: las mismas dos credenciales funcionaban en local y Dropbox
 * las rechazaba en producción con `invalid_client`. La diferencia estaba en el
 * pegado manual en el panel de Vercel — un espacio invisible, un salto de línea
 * o los dos campos cruzados. Copiando desde el archivo ya verificado, ese error
 * no puede ocurrir.
 *
 * Antes de subir nada comprueba contra Dropbox que el par sea válido: no tiene
 * sentido cargar en producción algo que ya sabemos que no sirve.
 *
 * Nunca imprime el valor de una credencial.
 *
 * Uso: node scripts/cargar-dropbox-vercel.mjs
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const env = readFileSync(".env", "utf8");
const leer = (clave) => {
  const linea = env.split(/\r?\n/).find((l) => l.startsWith(`${clave}=`));
  if (!linea) return null;
  return linea.slice(clave.length + 1).replace(/^["']|["']$/g, "").trim();
};

const key = leer("DROPBOX_APP_KEY");
const secret = leer("DROPBOX_APP_SECRET");
if (!key || !secret) {
  console.error("✗ Faltan DROPBOX_APP_KEY o DROPBOX_APP_SECRET en .env");
  process.exit(1);
}
console.log(`App key: ${key.length} caracteres · App secret: ${secret.length} caracteres`);

// ── 1) ¿Dropbox reconoce este par? ──
const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
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
const cuerpo = await res.json().catch(() => ({}));
if (cuerpo.error !== "invalid_grant") {
  console.error(`✗ Dropbox NO reconoce el par del .env local (${cuerpo.error ?? res.status}).`);
  console.error("  Copialos de nuevo desde dropbox.com/developers/apps → Settings.");
  process.exit(1);
}
console.log("✓ Dropbox reconoce el par del .env local\n");

// ── 2) Reemplazarlas en Vercel ──
const vercel = (args) =>
  execFileSync("npx", ["vercel", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });

for (const [clave, valor] of [["DROPBOX_APP_KEY", key], ["DROPBOX_APP_SECRET", secret]]) {
  for (const entorno of ["production", "preview"]) {
    try {
      vercel(["env", "rm", clave, entorno, "--yes"]);
      console.log(`  quitada ${clave} de ${entorno}`);
    } catch {
      // No estaba: es un estado válido, no un fallo.
    }
    try {
      // El orden de los flags importa: --yes y --sensitive van al final, que es
      // como el propio CLI sugiere el comando cuando falta algo.
      // --value evita el prompt y, sobre todo, evita que el valor pase por una
      // consola donde un espacio de más lo arruine.
      vercel(["env", "add", clave, entorno, "--value", valor, "--yes", "--sensitive"]);
      console.log(`✓ ${clave} cargada en ${entorno}`);
    } catch (e) {
      // Dejar la variable a medias es peor que no tocarla: hay que verlo.
      const salida = `${e.stdout ?? ""}${e.stderr ?? ""}`.replace(valor, "«el valor»");
      console.error(`✗ NO se pudo cargar ${clave} en ${entorno}`);
      console.error(salida.split("\n").filter((l) => l.trim()).slice(-4).join("\n"));
      process.exitCode = 1;
    }
  }
}

console.log("\nListo. Falta un redeploy para que producción tome los valores:");
console.log("  npx vercel redeploy --yes");
