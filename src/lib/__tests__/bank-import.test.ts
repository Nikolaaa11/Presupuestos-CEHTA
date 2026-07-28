import { describe, it, expect } from "vitest";
import {
  normalizeHeader,
  findHeaderRow,
  toIsoDate,
  toMoney,
  toReleased,
  safeLink,
  movementFingerprint,
  parseSheet,
  parseWorkbook,
} from "../bank-import";

/** Encabezados EXACTOS de la hoja "CC Santander" del archivo real. */
const CARTOLA_HEADER = [
  "LINK\r\n(URL)", "Nombre\r\n/ Ref", "🔗 HIPERVÍNCULO\r\n(clickeable)", "Fecha",
  "Descripción / Motivo Real", "Abonos ($)", "Egreso ($)", "Saldo ($)",
  "General", "Detallado", "Específico", "Centro Negocios", "Aporte K", "Estado",
];

/** Encabezados EXACTOS de la hoja "CEnergy" de Transferencia detalle.xlsx. */
const TRANSFER_HEADER = [
  "FECHA INGRESO", "FECHA PAGO", "MONTO", "PROVEEDOR", "T DOC", "N DOC",
  "DESCRIPCION", "RUT", "BANCO", "N CUENTA", "Tipo Cuenta", "CORREO",
];

describe("normalizeHeader", () => {
  it("limpia emojis, saltos de línea, ($) y acentos", () => {
    expect(normalizeHeader("Descripción / Motivo Real")).toBe("descripcion / motivo real");
    expect(normalizeHeader("Abonos ($)")).toBe("abonos");
    expect(normalizeHeader("Nombre\r\n/ Ref")).toBe("nombre / ref");
    expect(normalizeHeader("🔗 HIPERVÍNCULO\r\n(clickeable)")).toBe("hipervinculo");
    expect(normalizeHeader("N CUENTA")).toBe("n cuenta");
  });
});

describe("detección de encabezados", () => {
  it("encuentra la fila 3 en la cartola real (títulos y filas vacías antes)", () => {
    const rows = [
      ["CUENTA CORRIENTE — CC SANTANDER", null, null],
      [null, null, null],
      [null, null, null],
      CARTOLA_HEADER,
      [null, "Préstamo", "Préstamo", 45559, "Prestamo Comercial", 70000, null, 70000, "Préstamos", "Nombre", "Javier Alvarez", "Oficina", "Préstamos", "✅"],
    ];
    const h = findHeaderRow(rows);
    expect(h?.index).toBe(3);
    expect(h?.map.date).toBe(3);
    expect(h?.map.credit).toBe(5);
    expect(h?.map.debit).toBe(6);
    expect(h?.map.estado).toBe(13);
    expect(h?.map.link).toBe(0); // LINK (URL), no el hipervínculo
  });

  it("encuentra la fila de transferencias y distingue fecha ingreso de fecha pago", () => {
    const h = findHeaderRow([["x", null, "DATOS TRANSFERENCIA"], TRANSFER_HEADER]);
    expect(h?.index).toBe(1);
    expect(h?.map.entryDate).toBe(0);
    expect(h?.map.date).toBe(1); // "fecha pago" gana el alias date
    expect(h?.map.debit).toBe(2); // MONTO → egreso a pagar
    expect(h?.map.reference).toBe(3); // PROVEEDOR
    expect(h?.map.accountType).toBe(10);
  });

  it("rechaza hojas sin estructura (Dashboard, Prog…)", () => {
    expect(findHeaderRow([["📊 Dashboard", null], [18282452, null], ["texto suelto", 4]])).toBeNull();
  });
});

describe("conversiones", () => {
  it("fechas seriales Excel → ISO (45559 = 2024-09-24, 46121 = 2026-04-09)", () => {
    expect(toIsoDate(45559)).toBe("2024-09-24");
    expect(toIsoDate(46121)).toBe("2026-04-09");
    expect(toIsoDate("25/06/2026")).toBe("2026-06-25");
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate("Préstamo")).toBeNull();
  });

  it("montos: números xlsx, texto es-CL y ruido flotante", () => {
    expect(toMoney(70000)).toBe("70000.00");
    expect(toMoney(664755206.2129999)).toBe("664755206.21");
    expect(toMoney("1.234.567")).toBe("1234567.00");
    expect(toMoney("$ 1.234,56")).toBe("1234.56");
    expect(toMoney(null)).toBe("0");
    expect(toMoney(-165470)).toBe("-165470.00");
  });

  it("estado: ✅ y variantes liberan; vacío o pendiente no", () => {
    expect(toReleased("✅")).toBe(true);
    expect(toReleased("Pagado")).toBe(true);
    expect(toReleased("liberado")).toBe(true);
    expect(toReleased(null)).toBe(false);
    expect(toReleased("⚠️ Pendiente")).toBe(false);
    expect(toReleased("")).toBe(false);
  });
});

// ── Regresiones de la revisión de seguridad del 28-07-2026 ──

describe("estados negados NO liberan (hallazgo: 'No pagado' → true)", () => {
  it("rechaza negaciones, anulaciones y pendientes", () => {
    for (const estado of [
      "No pagado", "no liberado", "Sin liberar", "SIN PAGAR", "Anulado",
      "Rechazado", "Pendiente", "⚠️ Pendiente", "Reversado", "Nulo",
    ]) {
      expect(toReleased(estado), `"${estado}" no debe liberar`).toBe(false);
    }
  });

  it("sigue liberando los positivos reales de las planillas", () => {
    for (const estado of ["✅", "Pagado", "PAGADO", "liberado", "Conciliado", "OK", "Sí", "si"]) {
      expect(toReleased(estado), `"${estado}" debe liberar`).toBe(true);
    }
  });
});

describe("fechas de calendario inválidas (hallazgo: 31/02 corría de día)", () => {
  it("rechaza días que no existen", () => {
    expect(toIsoDate("31/02/2026")).toBeNull();
    expect(toIsoDate("31/04/2026")).toBeNull();
    expect(toIsoDate("29/02/2025")).toBeNull(); // 2025 no es bisiesto
  });

  it("acepta las válidas, incluido 29/02 bisiesto", () => {
    expect(toIsoDate("29/02/2024")).toBe("2024-02-29");
    expect(toIsoDate("28/02/2026")).toBe("2026-02-28");
    expect(toIsoDate("31/01/2026")).toBe("2026-01-31");
  });
});

describe("safeLink (hallazgo: link crudo del Excel al cliente)", () => {
  it("solo deja pasar http/https", () => {
    expect(safeLink("https://www.dropbox.com/scl/fo/x")).toBe("https://www.dropbox.com/scl/fo/x");
    expect(safeLink("http://intranet.cehta.cl/doc")).toBe("http://intranet.cehta.cl/doc");
  });

  it("descarta esquemas peligrosos y basura", () => {
    expect(safeLink("javascript:alert(document.cookie)")).toBeNull();
    expect(safeLink("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
    expect(safeLink("file:///C:/Windows/System32")).toBeNull();
    expect(safeLink("no es una url")).toBeNull();
    expect(safeLink(null)).toBeNull();
  });

  it("el parser aplica safeLink a la columna LINK", () => {
    const sheet = parseSheet("CC", [
      CARTOLA_HEADER,
      ["javascript:alert(1)", "X", null, 45559, "pago", null, 100, 0, null, null, null, null, null, "✅"],
    ])!;
    expect(sheet.movements[0].link).toBeNull();
  });
});

describe("movementFingerprint (preserva liberados al re-subir)", () => {
  const base = { rowIndex: 5, reference: "Exxion SpA", description: "Ases. Contable", debit: "350000.00", credit: "0" };

  it("es estable ante espacios, mayúsculas y formato de monto", () => {
    expect(movementFingerprint(base)).toBe(
      movementFingerprint({ ...base, reference: "  EXXION   SpA ", debit: "350000" }),
    );
  });

  it("distingue movimientos distintos", () => {
    expect(movementFingerprint(base)).not.toBe(movementFingerprint({ ...base, debit: "350001" }));
    expect(movementFingerprint(base)).not.toBe(movementFingerprint({ ...base, rowIndex: 6 }));
  });
});

describe("parseSheet — cartola CC", () => {
  const rows = [
    ["CUENTA CORRIENTE — CC SANTANDER"],
    [],
    [],
    CARTOLA_HEADER,
    [null, "Préstamo", "Préstamo", 45559, "Prestamo Comercial a Javier Alvarez", 70000, null, 70000, "Préstamos", "Nombre", "Javier Alvarez", "Oficina", "Préstamos", "✅"],
    [null, "Mant. Plan", "Mant. Plan", 45559, "\tRECUP COM PLAN MES ANT", null, 37189, 32811, "Operación", "Banco", "Mantención CC", "Oficina", "Primer_abono", "✅"],
    ["https://dropbox.com/x", "OC0073", "OC0073", 46126, "Gema SPA FA 19", null, 165470, 135192196, "Desarrollo_Proyecto", "Gestión", "Otros", "Panimávida(BESS RHO)", "Cuarto_abono", null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null], // vacía
  ];
  const sheet = parseSheet("CC Santander", rows)!;

  it("parsea movimientos y descarta filas vacías", () => {
    expect(sheet.movements).toHaveLength(3);
    expect(sheet.skippedRows).toBe(1);
  });

  it("mapea abono/egreso/saldo/categorías/estado correctamente", () => {
    const [prestamo, mant, oc] = sheet.movements;
    expect(prestamo.credit).toBe("70000.00");
    expect(prestamo.debit).toBe("0");
    expect(prestamo.date).toBe("2024-09-24");
    expect(prestamo.categoryGeneral).toBe("Préstamos");
    expect(prestamo.released).toBe(true);

    expect(mant.debit).toBe("37189.00");
    expect(mant.description).toBe("RECUP COM PLAN MES ANT"); // tab limpiado
    expect(mant.balance).toBe("32811.00");

    expect(oc.released).toBe(false); // sin ✅ → pendiente
    expect(oc.link).toBe("https://dropbox.com/x");
    expect(oc.businessCenter).toBe("Panimávida(BESS RHO)");
  });
});

describe("parseSheet — detalle de transferencias", () => {
  const rows = [
    [null, null, null, null, null, null, null, "DATOS TRANSFERENCIA", null, null, null, null, null, null, -2934649],
    TRANSFER_HEADER,
    [46196, 46196, 350000, "Exxion SpA", "FA", 75, "Ases. Contable Enero-26", "77.060.839-2  ", "Banco de Chile", 2110140905, null, "sibarra@mcgconsultores.cl", null, "AFIS A CENERGY", 175000000],
    [null, 46198, 217369, null, null, null, null, null, null, null, null, null, null, "Cta Cte", 7406803],
  ];
  const sheet = parseSheet("AFIS", rows)!;

  it("toma solo las columnas mapeadas e ignora las notas laterales", () => {
    expect(sheet.movements).toHaveLength(2);
    const [exxion, sinNombre] = sheet.movements;
    expect(exxion.debit).toBe("350000.00");
    expect(exxion.reference).toBe("Exxion SpA");
    expect(exxion.rut).toBe("77.060.839-2");
    expect(exxion.accountNumber).toBe("2110140905");
    expect(exxion.entryDate).toBe("2026-06-23");
    expect(exxion.date).toBe("2026-06-23");
    expect(exxion.released).toBe(false); // sin columna Estado → pendiente de liberar
    // la nota lateral "AFIS A CENERGY" y 175000000 NO contaminan el movimiento
    expect(exxion.description).toBe("Ases. Contable Enero-26");

    expect(sinNombre.debit).toBe("217369.00");
    expect(sinNombre.reference).toBeNull();
  });
});

describe("parseWorkbook", () => {
  it("filtra por nombre de hoja e ignora las no reconocibles", () => {
    const { parsed, ignored } = parseWorkbook(
      [
        { name: "Dashboard", rows: [["📊", null], [1, 2]] },
        { name: "CC Santander", rows: [CARTOLA_HEADER, [null, "X", null, 45559, "pago", null, 100, 0, null, null, null, null, null, "✅"]] },
        { name: "Listas", rows: [["General", "RRHH"]] },
      ],
    );
    expect(parsed.map((p) => p.name)).toEqual(["CC Santander"]);
    expect(ignored).toContain("Dashboard");
    expect(ignored).toContain("Listas");
  });

  it("con filtro de hojas, solo importa las pedidas", () => {
    const sheets = [
      { name: "AFIS", rows: [TRANSFER_HEADER, [46196, 46196, 100, "Prov", null, null, "x", null, null, null, null, null]] },
      { name: "CEnergy", rows: [TRANSFER_HEADER, [46196, 46196, 200, "Prov2", null, null, "y", null, null, null, null, null]] },
    ];
    const { parsed, ignored } = parseWorkbook(sheets, ["afis"]);
    expect(parsed.map((p) => p.name)).toEqual(["AFIS"]);
    expect(ignored).toEqual(["CEnergy"]);
  });
});
