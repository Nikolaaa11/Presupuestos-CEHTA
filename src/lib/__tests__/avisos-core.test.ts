import { describe, it, expect } from "vitest";
import {
  agruparAvancesOC,
  avisosDeOC,
  avisosDeEtapas,
  diasDeCalendario,
  pendientesSinFecha,
  sumaPorcentajes,
  sugerenciasDePago,
  type MovimientoParaAgrupar,
} from "../avisos-core";

const HOY = new Date("2026-08-04T12:00:00Z");

function mov(over: Partial<MovimientoParaAgrupar>): MovimientoParaAgrupar {
  return {
    reference: "OC0001",
    debit: "100000",
    estado: "PENDIENTE",
    date: null,
    companyCode: "RHO",
    companyName: "RHO",
    esRegistroOC: false,
    ...over,
  };
}

describe("avance por orden de compra", () => {
  it("agrupa por referencia y calcula el porcentaje avanzado", () => {
    const avances = agruparAvancesOC([
      mov({ debit: "30000", estado: "TRANSFERIDO" }),
      mov({ debit: "70000", estado: "PENDIENTE", date: new Date("2026-08-10") }),
    ]);
    expect(avances).toHaveLength(1);
    expect(avances[0].total).toBe("100000.00");
    expect(avances[0].avanzado).toBe("30000.00");
    expect(avances[0].pendiente).toBe("70000.00");
    expect(avances[0].porcentaje).toBe(30);
  });

  it("una OC pagada en 3 etapas de 33/33/34 refleja el avance por porcentaje", () => {
    const avances = agruparAvancesOC([
      mov({ debit: "330000", estado: "TRANSFERIDO" }),
      mov({ debit: "330000", estado: "LIBERADO" }),
      mov({ debit: "340000", estado: "PENDIENTE" }),
    ]);
    expect(avances[0].porcentaje).toBe(66);
    expect(avances[0].pendiente).toBe("340000.00");
  });

  it("ignora referencias que no son órdenes de compra y débitos en cero", () => {
    const avances = agruparAvancesOC([
      mov({ reference: "Remuneración" }),
      mov({ reference: "Previred" }),
      mov({ reference: "OC0002", debit: "0" }),
      mov({ reference: null }),
    ]);
    expect(avances).toHaveLength(0);
  });

  it("no mezcla empresas aunque la referencia sea la misma", () => {
    const avances = agruparAvancesOC([
      mov({ companyCode: "RHO" }),
      mov({ companyCode: "PANIMAVIDA", companyName: "Panimávida" }),
    ]);
    expect(avances).toHaveLength(2);
  });

  it("la fecha del próximo pago es la más antigua entre los PENDIENTES", () => {
    const avances = agruparAvancesOC([
      mov({ estado: "TRANSFERIDO", date: new Date("2026-01-01") }),
      mov({ estado: "PENDIENTE", date: new Date("2026-09-01") }),
      mov({ estado: "PENDIENTE", date: new Date("2026-08-15") }),
    ]);
    expect(avances[0].fechaProximoPago).toBe(new Date("2026-08-15").toISOString());
  });

  // Regresión del hallazgo crítico: la misma OC vive en el REGISTRO de OCs
  // (una fila = el total de la orden) Y en las cartolas (los pagos efectivos).
  // Sumar las dos fuentes contaba la plata dos veces — caso real OC0005:
  // registro $9.208.998 + 2 pagos de $4.604.499 mostraba "$18,4M de $18,4M".
  describe("doble fuente: registro de OCs + cartolas", () => {
    it("una OC completa NO se cuenta doble (caso real OC0005)", () => {
      const avances = agruparAvancesOC([
        mov({ reference: "OC0005", esRegistroOC: true, debit: "9208998", estado: "TRANSFERIDO" }),
        mov({ reference: "OC0005", debit: "4604499", estado: "TRANSFERIDO" }),
        mov({ reference: "OC0005", debit: "4604499", estado: "TRANSFERIDO" }),
      ]);
      expect(avances[0].total).toBe("9208998.00");
      expect(avances[0].avanzado).toBe("9208998.00");
      expect(avances[0].porcentaje).toBe(100);
    });

    it("un registro PENDIENTE es el saldo por pagar, no el total (caso real OC0017)", () => {
      // Contrato en cuotas de $1,5M: 16 pagadas por cartola ($24M) y el
      // registro dice justo lo que falta ($21M = 14 cuotas). Total: $45M.
      const cuotas = Array.from({ length: 16 }, (_, i) =>
        mov({ reference: "OC0017", debit: "1500000", estado: "LIBERADO", date: new Date(2025, 3 + i, 1) }),
      );
      const avances = agruparAvancesOC([
        ...cuotas,
        mov({ reference: "OC0017", esRegistroOC: true, debit: "21000000", estado: "PENDIENTE" }),
      ]);
      expect(avances[0].total).toBe("45000000.00");
      expect(avances[0].avanzado).toBe("24000000.00");
      expect(avances[0].porcentaje).toBe(53);
      expect(avances[0].pendiente).toBe("21000000.00");
    });

    it("una OC parcial suma lo pagado más el saldo del registro (caso real OC0092)", () => {
      const avances = agruparAvancesOC([
        mov({ reference: "OC0092", esRegistroOC: true, debit: "1152884", estado: "PENDIENTE" }),
        mov({ reference: "OC0092", debit: "925714", estado: "LIBERADO" }),
      ]);
      expect(avances[0].total).toBe("2078598.00");
      expect(avances[0].avanzado).toBe("925714.00");
      expect(avances[0].porcentaje).toBe(44);
      expect(avances[0].pendiente).toBe("1152884.00");
    });

    it("un registro pagado sin cartolas vale por su propio estado", () => {
      const avances = agruparAvancesOC([
        mov({ reference: "OC0100", esRegistroOC: true, debit: "500000", estado: "TRANSFERIDO" }),
      ]);
      expect(avances[0].porcentaje).toBe(100);
    });

    it("un registro solo pendiente parte en 0%", () => {
      const avances = agruparAvancesOC([
        mov({ reference: "OC0102", esRegistroOC: true, debit: "800000", estado: "PENDIENTE" }),
      ]);
      expect(avances[0].porcentaje).toBe(0);
      expect(avances[0].pendiente).toBe("800000.00");
    });
  });
});

describe("días de calendario (los movimientos se guardan a las 12:00Z)", () => {
  it("una OC que vence HOY da 0 aunque ya sea la tarde", () => {
    expect(diasDeCalendario(new Date("2026-08-04T15:00:00Z"), new Date("2026-08-04T12:00:00Z"))).toBe(0);
  });
  it("mañana es 1, ayer es -1 — sin correr un día por la hora", () => {
    const tarde = new Date("2026-08-04T18:30:00Z");
    expect(diasDeCalendario(tarde, new Date("2026-08-05T12:00:00Z"))).toBe(1);
    expect(diasDeCalendario(tarde, new Date("2026-08-03T12:00:00Z"))).toBe(-1);
  });
});

describe("OCs pendientes sin fecha (resumen del panel)", () => {
  it("cuenta y suma solo las pendientes sin fecha de próximo pago", () => {
    const avances = agruparAvancesOC([
      mov({ reference: "OC0001", esRegistroOC: true, debit: "100000", estado: "PENDIENTE" }),
      mov({ reference: "OC0002", esRegistroOC: true, debit: "250000", estado: "PENDIENTE" }),
      mov({ reference: "OC0003", debit: "50000", estado: "PENDIENTE", date: new Date("2026-08-10") }),
      mov({ reference: "OC0004", debit: "50000", estado: "TRANSFERIDO" }),
    ]);
    const r = pendientesSinFecha(avances);
    expect(r.cantidad).toBe(2);
    expect(r.total).toBe("350000.00");
  });
});

describe("avisos de OC por tiempo de pago", () => {
  it("avisa lo que vence dentro de la ventana y lo vencido, en ese orden", () => {
    const avances = agruparAvancesOC([
      mov({ reference: "OC0001", date: new Date("2026-08-06") }), // en 2 días
      mov({ reference: "OC0002", date: new Date("2026-07-20") }), // vencida
      mov({ reference: "OC0003", date: new Date("2026-12-01") }), // lejos
    ]);
    const avisos = avisosDeOC(avances, HOY);
    expect(avisos.map((a) => a.referencia)).toEqual(["OC0002", "OC0001"]);
    expect(avisos[0].diasParaVencer).toBeLessThan(0);
  });

  it("una OC 100% avanzada no genera aviso aunque tenga fecha", () => {
    const avances = agruparAvancesOC([
      mov({ estado: "TRANSFERIDO", date: new Date("2026-08-05") }),
    ]);
    expect(avisosDeOC(avances, HOY)).toHaveLength(0);
  });

  it("una OC pendiente sin fecha no puede avisar (queda solo en el avance)", () => {
    const avances = agruparAvancesOC([mov({ date: null })]);
    expect(avances).toHaveLength(1);
    expect(avisosDeOC(avances, HOY)).toHaveLength(0);
  });
});

describe("avisos de etapas CAPEX", () => {
  const etapa = (over: Record<string, unknown>) => ({
    label: "Anticipo",
    percent: "30",
    dueMonth: 8,
    amount: "10000000",
    capexItemId: "cap1",
    descripcion: "Inversor solar",
    companyCode: "RHO",
    companyName: "RHO",
    budgetYear: 2026,
    currency: "CLP",
    ...over,
  });

  it("calcula el monto de la etapa como porcentaje del total", () => {
    const avisos = avisosDeEtapas([etapa({})], HOY);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].monto).toBe("3000000.00");
    expect(avisos[0].mesesParaVencer).toBe(0);
  });

  it("avisa el mes en curso, el próximo y lo vencido — no lo lejano", () => {
    const avisos = avisosDeEtapas(
      [
        etapa({ dueMonth: 6, label: "Vencida" }),
        etapa({ dueMonth: 8, label: "Este mes" }),
        etapa({ dueMonth: 9, label: "Próximo" }),
        etapa({ dueMonth: 12, label: "Lejos" }),
      ],
      HOY,
    );
    expect(avisos.map((a) => a.etapaLabel)).toEqual(["Vencida", "Este mes", "Próximo"]);
  });

  it("ignora etapas de presupuestos de otros años", () => {
    expect(avisosDeEtapas([etapa({ budgetYear: 2025 })], HOY)).toHaveLength(0);
  });
});

describe("suma de porcentajes del cronograma", () => {
  it("suma exacto con decimales (sin flotantes)", () => {
    expect(sumaPorcentajes(["33.33", "33.33", "33.34"]).toString()).toBe("100");
    expect(sumaPorcentajes(["0.1", "0.2"]).toString()).toBe("0.3");
  });
});

describe("sugerencia de pagado en Gastos", () => {
  const linea = { id: "l1", montos: ["0", "1500000", "0"] };

  it("sugiere cuando un movimiento no pendiente calza ±1% con un mes", () => {
    const s = sugerenciasDePago(
      [linea],
      [{ reference: "OC0005", description: null, debit: "1495000", estado: "TRANSFERIDO", date: new Date("2026-03-01") }],
    );
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ lineId: "l1", referencia: "OC0005" });
  });

  it("NO sugiere con movimientos pendientes ni fuera de tolerancia", () => {
    const s = sugerenciasDePago(
      [linea],
      [
        { reference: "A", description: null, debit: "1500000", estado: "PENDIENTE", date: null },
        { reference: "B", description: null, debit: "1300000", estado: "TRANSFERIDO", date: null },
      ],
    );
    expect(s).toHaveLength(0);
  });

  it("elige el calce más cercano cuando hay varios candidatos", () => {
    const s = sugerenciasDePago(
      [linea],
      [
        { reference: "lejano", description: null, debit: "1489000", estado: "TRANSFERIDO", date: null },
        { reference: "exacto", description: null, debit: "1500000", estado: "TRANSFERIDO", date: null },
      ],
    );
    expect(s[0].referencia).toBe("exacto");
  });

  // Regresión: 7 de 9 sugerencias reales calzaban con pagos de 2024/2025 en
  // un presupuesto 2026 — montos redondos calzan de casualidad con cualquier año.
  it("solo sugiere movimientos fechados en el año del presupuesto", () => {
    const s = sugerenciasDePago(
      [linea],
      [
        { reference: "de 2025", description: null, debit: "1500000", estado: "TRANSFERIDO", date: new Date("2025-05-02") },
        { reference: "sin fecha", description: null, debit: "1500000", estado: "TRANSFERIDO", date: null },
        { reference: "de 2026", description: null, debit: "1500000", estado: "TRANSFERIDO", date: new Date("2026-03-01") },
      ],
      2026,
    );
    expect(s).toHaveLength(1);
    expect(s[0].referencia).toBe("de 2026");
  });

  // Regresión: el mismo pago real se ofrecía a dos líneas a la vez, y ambas
  // se podían "Confirmar" con una sola salida de plata.
  it("un movimiento se sugiere a UNA sola línea (el mejor calce se lo lleva)", () => {
    const s = sugerenciasDePago(
      [
        { id: "directorio", montos: ["3000000"] },
        { id: "arriendo", montos: ["3010000"] },
      ],
      [{ reference: "OC0020", description: null, debit: "3000000", estado: "TRANSFERIDO", date: new Date("2026-05-02") }],
      2026,
    );
    expect(s).toHaveLength(1);
    expect(s[0].lineId).toBe("directorio"); // calce exacto le gana al ±1%
  });

  it("dos movimientos iguales sí alcanzan para dos líneas iguales", () => {
    const s = sugerenciasDePago(
      [
        { id: "l1", montos: ["500000"] },
        { id: "l2", montos: ["500000"] },
      ],
      [
        { reference: "caja-1", description: null, debit: "500000", estado: "TRANSFERIDO", date: new Date("2026-02-01") },
        { reference: "caja-2", description: null, debit: "500000", estado: "TRANSFERIDO", date: new Date("2026-02-15") },
      ],
      2026,
    );
    expect(s).toHaveLength(2);
    expect(new Set(s.map((x) => x.lineId))).toEqual(new Set(["l1", "l2"]));
  });
});
