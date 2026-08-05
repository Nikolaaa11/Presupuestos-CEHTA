import { describe, it, expect } from "vitest";
import {
  parseVentas,
  parseGastos,
  parseCapex,
  diagnosticoEncabezado,
  toSaleType,
  toMoneda,
  toFuente,
  toMes,
  claveDeLinea,
} from "../presupuesto-import";

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

describe("plantilla de Ventas", () => {
  const encabezado = ["Cliente", "Tipo", "Canal", ...MESES];

  it("parsea una fila completa con montos es-CL", () => {
    const r = parseVentas([
      encabezado,
      ["Colbún", "Contrato", "PPA", "1.500.000", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "2.500.000,50"],
    ]);
    expect(r).not.toBeNull();
    expect(r!.filas).toHaveLength(1);
    expect(r!.filas[0]).toMatchObject({
      client: "Colbún",
      saleType: "CONTRATO",
      channel: "PPA",
    });
    expect(r!.filas[0].meses.m01).toBe("1500000.00");
    expect(r!.filas[0].meses.m12).toBe("2500000.50");
  });

  it("el tipo vacío queda undefined (el server decide); el basura se rechaza", () => {
    const r = parseVentas([
      encabezado,
      ["Cliente A", "", "", 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ["Cliente B", "quizás", "", 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ]);
    expect(r!.filas).toHaveLength(1);
    expect(r!.filas[0].saleType).toBeUndefined();
    expect(r!.rechazos).toHaveLength(1);
    expect(r!.rechazos[0].motivo).toContain("tipo de venta");
  });

  it("montos sin cliente se rechazan (no se pierde plata en silencio)", () => {
    const r = parseVentas([encabezado, ["", "", "", 999, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]]);
    expect(r!.rechazos).toHaveLength(1);
    expect(r!.rechazos[0].motivo).toBe("no tiene cliente");
  });

  it("filas totalmente vacías solo se cuentan", () => {
    const r = parseVentas([encabezado, ["", "", "", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], []]);
    expect(r!.filas).toHaveLength(0);
    expect(r!.rechazos).toHaveLength(0);
    expect(r!.filasVacias).toBe(2);
  });

  it("montos negativos se rechazan", () => {
    const r = parseVentas([encabezado, ["Cliente", "Contrato", "", -500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]]);
    expect(r!.rechazos[0].motivo).toBe("tiene montos negativos");
  });

  it("sin encabezado reconocible devuelve null", () => {
    expect(parseVentas([["cualquier", "cosa"], [1, 2, 3]])).toBeNull();
  });
});

describe("plantilla de Gastos", () => {
  const encabezado = ["Categoría", "Ítem", ...MESES];

  it("parsea; la categoría vacía SE RECHAZA (el upsert la necesita para no duplicar)", () => {
    const r = parseGastos([
      encabezado,
      ["RRHH", "Sueldos", ...Array(12).fill("1.000.000")],
      ["", "Notaría", 50000, ...Array(11).fill(0)],
    ]);
    expect(r!.filas).toHaveLength(1);
    expect(r!.filas[0]).toMatchObject({ categoria: "RRHH", item: "Sueldos" });
    expect(r!.filas[0].meses.m06).toBe("1000000.00");
    expect(r!.rechazos[0].motivo).toBe("no tiene categoría");
  });

  it("montos sin ítem se rechazan", () => {
    const r = parseGastos([encabezado, ["RRHH", "", 100, ...Array(11).fill(0)]]);
    expect(r!.rechazos[0].motivo).toBe("no tiene ítem");
  });
});

describe("plantilla de CAPEX", () => {
  const encabezado = ["Inversión", "Para qué", "Monto", "Moneda", "Mes requerido", "Plazo", "Fuente", "Iniciativa"];

  it("parsea una inversión completa", () => {
    const r = parseCapex([
      encabezado,
      ["Inversor solar", "Reemplazo", "140.000", "USD", "Mar", "18", "Banco", "Local Pargua"],
    ]);
    expect(r!.filas).toHaveLength(1);
    expect(r!.filas[0]).toMatchObject({
      description: "Inversor solar",
      amount: "140000.00",
      currency: "USD",
      monthNeeded: 3,
      financingMonths: 18,
      financingSource: "BANCO",
      initiativeName: "Local Pargua",
    });
  });

  it("los opcionales vacíos quedan undefined: crear con default, actualizar sin pisar", () => {
    const r = parseCapex([encabezado, ["Camioneta", "", "25.000.000", "", "7", "", "", ""]]);
    expect(r!.filas[0].currency).toBeUndefined();
    expect(r!.filas[0].financingSource).toBeUndefined();
    expect(r!.filas[0].financingMonths).toBeNull();
    expect(r!.filas[0].monthNeeded).toBe(7);
  });

  it("rechaza monto 0, mes inválido y moneda basura, cada uno con su motivo", () => {
    const r = parseCapex([
      encabezado,
      ["Sin monto", "", "0", "", "1", "", "", ""],
      ["Mes malo", "", "1000", "", "13", "", "", ""],
      ["Moneda mala", "", "1000", "EUR", "1", "", "", ""],
    ]);
    expect(r!.filas).toHaveLength(0);
    expect(r!.rechazos.map((x) => x.motivo)).toEqual([
      "el monto debe ser mayor que 0",
      "mes requerido inválido (1-12 o nombre del mes)",
      "moneda no reconocida (usar CLP, UF o USD)",
    ]);
  });
});

describe("conversores tolerantes", () => {
  it("toSaleType", () => {
    expect(toSaleType("contrato firmado")).toBe("CONTRATO");
    expect(toSaleType("Proyección a público")).toBe("PROYECCION_PUBLICO");
    expect(toSaleType("recurrente")).toBe("RECURRENTE");
    expect(toSaleType(null)).toBeUndefined();
    expect(toSaleType("x")).toBeNull();
  });

  it("toMoneda y toFuente", () => {
    expect(toMoneda("pesos")).toBe("CLP");
    expect(toMoneda(null)).toBeUndefined();
    expect(toMoneda("Dólar")).toBe("USD");
    expect(toFuente("Financiamiento bancario")).toBe("BANCO");
    expect(toFuente("caja")).toBe("CAJA_PROPIA");
  });

  it("toMes acepta número, texto y nombre", () => {
    expect(toMes(3)).toBe(3);
    expect(toMes("11")).toBe(11);
    expect(toMes("Diciembre")).toBe(12);
    expect(toMes("Ene")).toBe(1);
    expect(toMes(0)).toBeNull();
    expect(toMes("13")).toBeNull();
  });
});

describe("clave de upsert", () => {
  it("ignora mayúsculas, acentos y espacios extra", () => {
    expect(claveDeLinea("  Notaría ")).toBe(claveDeLinea("notaria"));
    expect(claveDeLinea("RRHH", "Sueldos")).toBe(claveDeLinea("rrhh", " sueldos "));
    expect(claveDeLinea("a", "b")).not.toBe(claveDeLinea("ab"));
  });
});

// Regresiones de la revisión adversarial: aceptar archivos parciales perdía
// plata en silencio (Ene-Jun pisaba jul-dic con ceros; capex sin Moneda
// convertía UF→CLP). La plantilla manda: columnas completas o error claro.
describe("la plantilla manda (encabezado completo obligatorio)", () => {
  it("ventas con solo 6 meses NO es viable, y el diagnóstico dice qué falta", () => {
    const rows = [["Cliente", "Tipo", "Canal", "Ene", "Feb", "Mar", "Abr", "May", "Jun"], ["Cliente X", "", "", 1, 2, 3, 4, 5, 6]];
    expect(parseVentas(rows)).toBeNull();
    const d = diagnosticoEncabezado("ventas", rows);
    expect(d.faltantes).toContain("Jul");
    expect(d.faltantes).toContain("Dic");
    expect(d.faltantes).toHaveLength(6);
  });

  it("gastos sin columna Categoría NO es viable (evita duplicar bajo Otros)", () => {
    const rows = [["Ítem", ...MESES], ["Sueldos", ...Array(12).fill(100)]];
    expect(parseGastos(rows)).toBeNull();
    expect(diagnosticoEncabezado("gastos", rows).faltantes).toEqual(["Categoría"]);
  });

  it("capex sin columna Moneda NO es viable (evita convertir UF→CLP al actualizar)", () => {
    const rows = [
      ["Inversión", "Para qué", "Monto", "Mes requerido", "Plazo", "Fuente", "Iniciativa"],
      ["Local Pargua", "", 20000, 1, "", "", ""],
    ];
    expect(parseCapex(rows)).toBeNull();
    expect(diagnosticoEncabezado("capex", rows).faltantes).toEqual(["Moneda"]);
  });

  it('acepta "Setiembre" como septiembre (variante es-CL real)', () => {
    const conSetiembre = ["Cliente", "Tipo", "Canal", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Setiembre", "Oct", "Nov", "Dic"];
    const r = parseVentas([conSetiembre, ["Cliente X", "", "", 0, 0, 0, 0, 0, 0, 0, 0, "123", 0, 0, 0]]);
    expect(r).not.toBeNull();
    expect(r!.filas[0].meses.m09).toBe("123.00");
  });
});

describe("filas de EJEMPLO de la plantilla", () => {
  it("se rechazan con motivo en los tres módulos (subir la plantilla cruda no infla nada)", () => {
    const v = parseVentas([
      ["Cliente", "Tipo", "Canal", ...MESES],
      ["EJEMPLO — Cliente SpA (borrá esta fila)", "Contrato", "PPA", ...Array(12).fill(1500000)],
    ]);
    expect(v!.filas).toHaveLength(0);
    expect(v!.rechazos[0].motivo).toContain("EJEMPLO");

    const g = parseGastos([
      ["Categoría", "Ítem", ...MESES],
      ["RRHH", "EJEMPLO — Sueldos (borrá esta fila)", ...Array(12).fill(4500000)],
    ]);
    expect(g!.filas).toHaveLength(0);
    expect(g!.rechazos[0].motivo).toContain("EJEMPLO");

    const c = parseCapex([
      ["Inversión", "Para qué", "Monto", "Moneda", "Mes requerido", "Plazo", "Fuente", "Iniciativa"],
      ["EJEMPLO — Inversor solar 50kW (borrá esta fila)", "Reemplazo", 140000, "USD", "Mar", 18, "Banco", ""],
    ]);
    expect(c!.filas).toHaveLength(0);
    expect(c!.rechazos[0].motivo).toContain("EJEMPLO");
  });

  it("una fila editada a partir del ejemplo entra normal", () => {
    const r = parseVentas([
      ["Cliente", "Tipo", "Canal", ...MESES],
      ["Colbún SpA", "Contrato", "PPA", ...Array(12).fill(1500000)],
    ]);
    expect(r!.filas).toHaveLength(1);
  });
});
