import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { revisarZip, MAX_DESCOMPRIMIDO_ENTRADA } from "../zip-safety";

/**
 * La bomba de descompresión real (xlsx de 9,5 MB que declara 2.800 MB de
 * sharedStrings) se demostró en la revisión adversarial. Acá se reproduce en
 * miniatura: se toma un xlsx legítimo y se le infla el tamaño DESCOMPRIMIDO
 * declarado en el directorio central — que es exactamente lo que inflate va a
 * producir y lo que revisarZip debe rechazar sin descomprimir nada.
 */

function xlsxLegitimo(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Cliente", "Ene"],
      ["Colbún", 1500000],
    ]),
    "Datos",
  );
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Infla el campo "uncompressed size" de todas las entradas del directorio central. */
function inflarTamaños(zip: Buffer, bytes: number): Buffer {
  const out = Buffer.from(zip);
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = out.length - 22; i >= 0; i--) {
    if (out.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  const cantidad = out.readUInt16LE(eocd + 10);
  let offset = out.readUInt32LE(eocd + 16);
  for (let n = 0; n < cantidad; n++) {
    out.writeUInt32LE(bytes, offset + 24); // uncompressed size
    const nombreLen = out.readUInt16LE(offset + 28);
    const extraLen = out.readUInt16LE(offset + 30);
    const comentarioLen = out.readUInt16LE(offset + 32);
    offset += 46 + nombreLen + extraLen + comentarioLen;
  }
  return out;
}

describe("revisarZip", () => {
  it("un xlsx legítimo pasa", () => {
    const r = revisarZip(xlsxLegitimo());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entradas).toBeGreaterThan(3); // content types, workbook, sheet…
  });

  it("una bomba que declara entradas gigantes se rechaza SIN descomprimir", () => {
    const bomba = inflarTamaños(xlsxLegitimo(), MAX_DESCOMPRIMIDO_ENTRADA + 1);
    const r = revisarZip(bomba);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain("seguridad");
  });

  it("basura que no es ZIP se rechaza", () => {
    const r = revisarZip(Buffer.from("esto no es un zip para nada, solo texto largo de relleno"));
    expect(r.ok).toBe(false);
  });

  it("un buffer vacío se rechaza sin explotar", () => {
    expect(revisarZip(Buffer.alloc(0)).ok).toBe(false);
  });
});
