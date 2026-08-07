import { describe, it, expect } from "vitest";
import { codigoBanco, rutParaBanco } from "../banco-codigos";

describe("códigos SBIF por nombre de banco", () => {
  it("los tres verificados contra los archivos reales del fondo", () => {
    expect(codigoBanco("Banco de Chile")).toBe(1); // X24: Resintech
    expect(codigoBanco("Scotiabank")).toBe(14); // X25: Geist
    expect(codigoBanco("Banco Santander")).toBe(37); // X25: Soltec/MCG
  });

  it("tolera variantes reales de escritura", () => {
    expect(codigoBanco("BCO CHILE")).toBe(1);
    expect(codigoBanco("santander ")).toBe(37);
    expect(codigoBanco("BancoEstado")).toBe(12);
    expect(codigoBanco("Bci")).toBe(16);
    expect(codigoBanco("Banco Itaú")).toBe(39);
    expect(codigoBanco("BICE")).toBe(28);
  });

  it("desconocido o vacío → null (jamás inventar un código: la plata iría a otro banco)", () => {
    expect(codigoBanco("Banco Inventado XYZ")).toBeNull();
    expect(codigoBanco("")).toBeNull();
    expect(codigoBanco(null)).toBeNull();
  });
});

describe("RUT al formato de la carga masiva", () => {
  it("sin puntos ni guión, DV pegado — como en los archivos reales", () => {
    expect(rutParaBanco("76.058.363-4")).toBe("760583634"); // Resintech, del X24
    expect(rutParaBanco("77.275.038-2")).toBe("772750382"); // Geist, del X25
    expect(rutParaBanco("12.345.670-K")).toBe("12345670K"); // DV K real
    expect(rutParaBanco("76.000.000-0")).toBe("760000000"); // DV 0 real
    expect(rutParaBanco("760583634")).toBe("760583634"); // ya limpio
  });

  it("basura → null", () => {
    expect(rutParaBanco("sin rut")).toBeNull();
    expect(rutParaBanco("")).toBeNull();
    expect(rutParaBanco(null)).toBeNull();
  });
});

// ── Regresiones de la revisión adversarial ──

describe("REGRESIÓN CRÍTICA: nombres compuestos con 'Chile'", () => {
  it("la marca gana sobre 'Chile' — antes TODOS daban 1 (Banco de Chile)", () => {
    // "Banco Santander-Chile" es el nombre LEGAL de Santander y así aparece
    // en las cartolas: mandar esa transferencia con código 1 la desviaba.
    expect(codigoBanco("Banco Santander Chile")).toBe(37);
    expect(codigoBanco("BANCO SANTANDER-CHILE")).toBe(37);
    expect(codigoBanco("Scotiabank Chile")).toBe(14);
    expect(codigoBanco("Banco Itaú Chile")).toBe(39);
    expect(codigoBanco("HSBC Bank (Chile)")).toBe(31);
    expect(codigoBanco("Banco Security Chile")).toBe(49);
    expect(codigoBanco("BCI Chile")).toBe(16);
  });

  it("sin marca, 'Chile' sigue siendo Banco de Chile", () => {
    expect(codigoBanco("Banco de Chile")).toBe(1);
    expect(codigoBanco("BCO CHILE")).toBe(1);
    expect(codigoBanco("Banco Edwards")).toBe(1);
  });

  it("Scotiabank Azul y BBVA rutean por Scotiabank (14), sin entrada muerta", () => {
    expect(codigoBanco("Scotiabank Azul")).toBe(14);
    expect(codigoBanco("BBVA")).toBe(14);
  });
});

describe("REGRESIÓN: rutParaBanco valida el dígito verificador", () => {
  it("rechaza el RUT sin DV (se leería como OTRO contribuyente)", () => {
    expect(rutParaBanco("76.058.363")).toBeNull(); // antes daba "76058363"
  });

  it("rechaza DV incorrecto, DV duplicado y cuerpos imposibles", () => {
    expect(rutParaBanco("76.058.363-5")).toBeNull(); // DV cambiado
    expect(rutParaBanco("76.058.363-44")).toBeNull(); // 10 caracteres
    expect(rutParaBanco("912345678")).toBeNull(); // celular pegado
  });

  it("acepta los RUT reales de los archivos del banco", () => {
    expect(rutParaBanco("76.058.363-4")).toBe("760583634"); // Resintech (X24)
    expect(rutParaBanco("77.275.038-2")).toBe("772750382"); // Geist (X25)
    expect(rutParaBanco("76.318.551-6")).toBe("763185516"); // Soltec (X25)
    expect(rutParaBanco("76.642.280-2")).toBe("766422802"); // MCG (X25)
  });
});
