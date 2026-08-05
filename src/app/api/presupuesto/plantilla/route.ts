import * as XLSX from "xlsx";
import { auth } from "@/auth";

/**
 * Plantillas Excel para la carga masiva del presupuesto:
 *   ?modulo=ventas|gastos|capex
 *
 * La plantilla trae los encabezados que el parser reconoce y dos filas de
 * ejemplo con prefijo EJEMPLO — el importador las RECHAZA con motivo si no se
 * editan (así subir la plantilla cruda no infla el presupuesto con ficticios). El parser es tolerante — acepta también otros
 * encabezados equivalentes — pero partir de la plantilla evita sorpresas.
 */

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

const PLANTILLAS: Record<string, { nombre: string; filas: (string | number)[][] }> = {
  ventas: {
    nombre: "plantilla-ventas.xlsx",
    filas: [
      ["Cliente", "Tipo", "Canal", ...MESES],
      ["EJEMPLO — Cliente SpA (borrá esta fila)", "Contrato", "PPA", 1500000, 1500000, 1500000, 1500000, 1500000, 1500000, 1500000, 1500000, 1500000, 1500000, 1500000, 1500000],
      ["EJEMPLO — Venta proyectada (borrá esta fila)", "Proyección", "", 0, 0, 500000, 500000, 500000, 500000, 500000, 500000, 500000, 500000, 500000, 500000],
    ],
  },
  gastos: {
    nombre: "plantilla-gastos.xlsx",
    filas: [
      ["Categoría", "Ítem", ...MESES],
      ["RRHH", "EJEMPLO — Sueldos (borrá esta fila)", 4500000, 4500000, 4500000, 4500000, 4500000, 4500000, 4500000, 4500000, 4500000, 4500000, 4500000, 4500000],
      ["Administración", "EJEMPLO — Arriendo (borrá esta fila)", 800000, 800000, 800000, 800000, 800000, 800000, 800000, 800000, 800000, 800000, 800000, 800000],
    ],
  },
  capex: {
    nombre: "plantilla-capex.xlsx",
    filas: [
      ["Inversión", "Para qué", "Monto", "Moneda", "Mes requerido", "Plazo", "Fuente", "Iniciativa"],
      ["EJEMPLO — Inversor solar 50kW (borrá esta fila)", "Reemplazo equipo dañado", 140000, "USD", "Mar", 18, "Banco", ""],
      ["EJEMPLO — Camioneta (borrá esta fila)", "Faenas en terreno", 25000000, "CLP", "Jul", "", "Caja propia", ""],
    ],
  },
};

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return new Response("No autenticado", { status: 401 });

  const modulo = new URL(request.url).searchParams.get("modulo") ?? "";
  const plantilla = PLANTILLAS[modulo];
  if (!plantilla) {
    return Response.json({ error: "Módulo inválido (ventas, gastos o capex)" }, { status: 400 });
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(plantilla.filas);
  // Anchos razonables para que la plantilla se abra legible.
  ws["!cols"] = plantilla.filas[0].map((h, i) => ({ wch: i < 3 ? 24 : 12 }));
  XLSX.utils.book_append_sheet(wb, ws, "Plantilla");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${plantilla.nombre}"`,
    },
  });
}
