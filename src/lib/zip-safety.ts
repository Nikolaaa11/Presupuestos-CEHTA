/**
 * Chequeo de seguridad para archivos .xlsx ANTES de dárselos a SheetJS.
 *
 * Un .xlsx es un ZIP, y el límite de 10 MB sobre el archivo comprimido es
 * decorativo frente a una bomba de descompresión: en la revisión adversarial
 * se construyó un .xlsx de 9,5 MB cuyo sharedStrings.xml descomprime a
 * 2.800 MB (ratio ~295:1) y pasa todas las compuertas de tamaño — sheetRows
 * recorta filas, pero el XML se infla ANTES de eso.
 *
 * El directorio central del ZIP declara el tamaño DESCOMPRIMIDO de cada
 * entrada, así que se puede rechazar el archivo leyendo solo unos bytes,
 * sin descomprimir nada. Parser mínimo y puro — sin dependencias nuevas.
 */

const EOCD_SIG = 0x06054b50; // End of Central Directory
const CEN_SIG = 0x02014b50; // Central Directory file header

export const MAX_DESCOMPRIMIDO_TOTAL = 100 * 1024 * 1024; // 100 MB
export const MAX_DESCOMPRIMIDO_ENTRADA = 60 * 1024 * 1024; // 60 MB
export const MAX_ENTRADAS_ZIP = 200;

export type ZipCheck =
  | { ok: true; entradas: number; totalDescomprimido: number }
  | { ok: false; motivo: string };

/**
 * Recorre el directorio central y suma los tamaños declarados. Un ZIP que
 * MIENTE en la declaración (dice poco y descomprime mucho) no puede engañar
 * a inflate: zlib corta cuando el stream declarado se acaba — lo que infla
 * de verdad a SheetJS es justamente lo que acá se declara y se rechaza.
 */
export function revisarZip(buffer: Buffer): ZipCheck {
  // EOCD: está en los últimos 22 bytes + hasta 64 KB de comentario.
  const desde = Math.max(0, buffer.length - 22 - 65536);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= desde; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return { ok: false, motivo: "no es un archivo ZIP válido" };

  const cantidad = buffer.readUInt16LE(eocd + 10);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (cantidad > MAX_ENTRADAS_ZIP) {
    return { ok: false, motivo: `el archivo tiene demasiadas entradas internas (${cantidad})` };
  }

  let offset = cdOffset;
  let total = 0;
  for (let n = 0; n < cantidad; n++) {
    if (offset + 46 > buffer.length) return { ok: false, motivo: "directorio ZIP truncado" };
    if (buffer.readUInt32LE(offset) !== CEN_SIG) {
      return { ok: false, motivo: "directorio ZIP corrupto" };
    }
    const descomprimido = buffer.readUInt32LE(offset + 24);
    const nombreLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const comentarioLen = buffer.readUInt16LE(offset + 32);

    if (descomprimido > MAX_DESCOMPRIMIDO_ENTRADA) {
      return {
        ok: false,
        motivo: `una hoja interna declara ${Math.round(descomprimido / 1048576)} MB descomprimidos — archivo rechazado por seguridad`,
      };
    }
    total += descomprimido;
    if (total > MAX_DESCOMPRIMIDO_TOTAL) {
      return { ok: false, motivo: "el archivo descomprimido supera el límite de seguridad" };
    }
    offset += 46 + nombreLen + extraLen + comentarioLen;
  }

  return { ok: true, entradas: cantidad, totalDescomprimido: total };
}
