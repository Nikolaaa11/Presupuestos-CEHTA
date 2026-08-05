/**
 * Contenido de la guía de uso, por rol. Vive separado de la página para que
 * el texto se pueda revisar sin leer JSX, y para que sea evidente cuando un
 * cambio en las reglas del circuito deja la guía desactualizada.
 *
 * Las reglas que se describen acá están implementadas en:
 *   - presupuesto: src/lib/budget-policy.ts + src/app/(app)/budget-actions.ts
 *   - pagos:       src/lib/tesoreria.ts + src/app/(app)/bancos/actions.ts
 */

export type Paso = {
  titulo: string;
  detalle: string;
  /** Ruta de la app donde se hace, si aplica. */
  href?: string;
};

export type Guia = {
  /** Cómo se llama el rol en la vida real del fondo. */
  rol: string;
  resumen: string;
  /** Lo que esta persona hace, en orden. */
  pasos: Paso[];
  /** Lo que NO le toca, y quién lo hace. Evita el "¿por qué no veo el botón?". */
  noLeToca: { que: string; quien: string }[];
  /** Dudas que aparecen el primer día. */
  preguntas: { p: string; r: string }[];
};

/** Etapa de un circuito, para dibujarlo resaltando lo que le toca a quien mira. */
export type Etapa = { estado: string; accion: string; responsable: string; rol: string };

export const CIRCUITO_PRESUPUESTO: Etapa[] = [
  { estado: "Borrador", accion: "carga y edita", responsable: "Encargado", rol: "COMPANY_MANAGER" },
  { estado: "Enviado", accion: "da el visto bueno", responsable: "Administradora", rol: "ADMINISTRADORA" },
  { estado: "Revisado", accion: "aprueba", responsable: "Dueño", rol: "DUENO" },
  { estado: "Aprobado", accion: "queda cerrado", responsable: "—", rol: "" },
];

export const CIRCUITO_PAGOS: Etapa[] = [
  { estado: "Pendiente", accion: "libera el pago", responsable: "Dueño", rol: "DUENO" },
  { estado: "Liberado", accion: "sube el comprobante", responsable: "Administradora", rol: "ADMINISTRADORA" },
  { estado: "En transferencia", accion: "confirma la transferencia", responsable: "Dueño", rol: "DUENO" },
  { estado: "Transferido", accion: "queda cerrado", responsable: "—", rol: "" },
];

const encargado: Guia = {
  rol: "Encargado de empresa",
  resumen:
    "Vos armás el presupuesto de tu empresa: cuánto esperás vender, cuánto vas a gastar y qué inversiones necesitás. Cuando está listo lo mandás al fondo, que lo revisa y lo aprueba.",
  pasos: [
    {
      titulo: "Cargá por Excel si ya tenés los datos armados",
      detalle:
        "En Ventas, Gastos y CAPEX está el botón «Importar Excel»: descargá la plantilla, llenala y subila. La importación actualiza las líneas que ya existen y crea las nuevas — nunca borra, y lo que no entra te vuelve con fila y motivo. Acordate de borrar las filas de EJEMPLO.",
      href: "/ventas",
    },
    {
      titulo: "Cargá tus ventas mes a mes",
      detalle:
        "Una fila por cliente, y el monto en el mes que esperás facturarlo. Marcá si es contrato firmado o proyección: el fondo lee distinto un ingreso comprometido que uno estimado.",
      href: "/ventas",
    },
    {
      titulo: "Cargá tus gastos por categoría",
      detalle:
        "Una fila por ítem, con su categoría. Los gastos que se repiten todos los meses conviene cargarlos completos de una vez: podés pegar una fila entera desde Excel.",
      href: "/gastos",
    },
    {
      titulo: "Cargá el CAPEX del año",
      detalle:
        "Cada inversión con el mes en que la necesitás, el plazo y de dónde saldría la plata. Si el proyecto va a banco, completá el caso bancable: es lo que mira el comité. Adentro del caso podés armar el cronograma de pago por etapas (30% al pedido, 70% contra entrega) — el panel avisa cuando se acerca cada desembolso.",
      href: "/capex",
    },
    {
      titulo: "Marcá los gastos que ya se pagaron",
      detalle:
        "En la grilla de Gastos, la columna «Pagado» se tilda en cualquier momento (también con el presupuesto aprobado: los pagos ocurren después). Si un movimiento de Bancos calza con el monto, la plataforma lo sugiere — pero nunca marca sola: confirmás vos.",
      href: "/gastos",
    },
    {
      titulo: "Revisá el flujo antes de mandarlo",
      detalle:
        "El panel te muestra el flujo mensual (ventas menos gastos). Si hay meses en rojo, es la primera pregunta que te van a hacer — mejor llegar con la respuesta.",
      href: "/",
    },
    {
      titulo: "Enviá al fondo",
      detalle:
        "Desde el panel. A partir de ahí queda en solo lectura mientras lo revisan. Podés dejar un comentario explicando supuestos o cambios respecto del año anterior.",
      href: "/",
    },
    {
      titulo: "Si te lo observan, corregí y reenvialo",
      detalle:
        "La observación aparece arriba del panel con el comentario de quien la hizo. El presupuesto vuelve a ser editable; corregís lo que piden y lo mandás de nuevo.",
      href: "/",
    },
  ],
  noLeToca: [
    { que: "Aprobar tu propio presupuesto", quien: "La administradora lo revisa y el dueño lo aprueba" },
    { que: "Ver o editar el presupuesto de otra empresa", quien: "Cada encargado ve solo el suyo" },
    { que: "Liberar pagos en Bancos", quien: "El dueño del fondo libera; vos ves los movimientos de tu empresa" },
  ],
  preguntas: [
    {
      p: "¿Puedo pegar datos desde Excel?",
      r: "Sí. Copiá una fila de meses en Excel y pegala sobre la primera celda del mes en la grilla: se reparte sola por columna.",
    },
    {
      p: "Mandé el presupuesto y me faltó una línea.",
      r: "Pedí que te lo observen: quien lo esté revisando lo devuelve a edición con un comentario y podés corregirlo.",
    },
    {
      p: "¿Por qué las celdas están grises?",
      r: "Porque el presupuesto ya salió de tu escritorio — está enviado, revisado o aprobado. Solo se edita en Borrador u Observado.",
    },
    {
      p: "¿Los montos van con IVA?",
      r: "Cargá los montos como los maneja tu empresa y dejalo dicho en el comentario al enviar, para que el fondo consolide con el mismo criterio.",
    },
  ],
};

const administradora: Guia = {
  rol: "Administradora del fondo",
  resumen:
    "Vos sos el primer control. Revisás los presupuestos que mandan las empresas y, en el circuito de pagos, ejecutás las transferencias que el dueño ya liberó.",
  pasos: [
    {
      titulo: "Mirá qué llegó para revisar",
      detalle:
        "El panel muestra las 10 entidades con su estado. Las que dicen «Enviado» están esperándote a vos.",
      href: "/",
    },
    {
      titulo: "Entrá al detalle antes de firmar",
      detalle:
        "Desde cada tarjeta llegás a Ventas, Gastos y CAPEX de esa empresa. Mirá el flujo mensual y los supuestos: el visto bueno tuyo es lo que habilita la aprobación del dueño.",
      href: "/",
    },
    {
      titulo: "Dale el visto bueno, o devolvelo con una observación",
      detalle:
        "«Revisar (visto bueno)» lo deja listo para el dueño. «Observar» lo devuelve al encargado — el comentario es obligatorio, y es lo que esa persona va a leer para corregir.",
      href: "/",
    },
    {
      titulo: "En pagos: subí el comprobante de lo que el dueño liberó",
      detalle:
        "Cuando el dueño libera un lote, se genera la nómina para el banco. Hecha la transferencia, cargás el comprobante y el pago queda «En transferencia» hasta que el dueño lo confirme.",
      href: "/bancos",
    },
    {
      titulo: "Completá los datos bancarios que faltan",
      detalle:
        "Cada movimiento muestra «✓ se puede pagar» cuando tiene RUT, banco y cuenta completos, o «⚠ falta…» cuando no. Completalos con «Editar» antes de que el dueño libere: el banco rechaza transferencias incompletas. Al ponerles fecha, además, el aviso de vencimiento se activa solo.",
      href: "/bancos",
    },
  ],
  noLeToca: [
    { que: "Aprobar presupuestos", quien: "Esa firma es del dueño, después de tu revisión" },
    { que: "Liberar pagos", quien: "El dueño libera; vos ejecutás la transferencia" },
    { que: "Confirmar que un pago se transfirió", quien: "También el dueño — así nadie cierra su propio movimiento" },
  ],
  preguntas: [
    {
      p: "¿Por qué no veo el botón de aprobar?",
      r: "Porque la plataforma separa las dos firmas a propósito: vos revisás y el dueño aprueba. Si una sola persona hiciera ambas, la aprobación no tendría dos manos.",
    },
    {
      p: "Le di el visto bueno y encontré un error.",
      r: "Mientras el dueño no lo apruebe, podés observarlo y vuelve a edición del encargado.",
    },
    {
      p: "¿Qué pasa si el dueño no está?",
      r: "El administrador de la plataforma puede aprobar. Queda registrado quién firmó, igual que siempre.",
    },
  ],
};

const dueno: Guia = {
  rol: "Dueño del fondo",
  resumen:
    "Vos firmás. Aprobás los presupuestos que la administradora ya revisó, y en pagos autorizás la salida de plata y confirmás que se transfirió.",
  pasos: [
    {
      titulo: "Mirá los avisos de pago al entrar",
      detalle:
        "El panel del dashboard junta lo que vence: órdenes de compra con saldo pendiente y etapas de CAPEX del mes. Las OCs sin fecha programada aparecen resumidas — al ponerles fecha en Bancos, el aviso se activa solo.",
      href: "/",
    },
    {
      titulo: "Aprobá lo que ya está revisado",
      detalle:
        "En el panel, las empresas en «Revisado» esperan tu firma. La tarjeta te dice quién dio el visto bueno y cuándo. Aprobar deja el presupuesto inmutable como versión de auditoría.",
      href: "/",
    },
    {
      titulo: "Observá si algo no cierra",
      detalle:
        "Podés devolver el presupuesto al encargado con un comentario, aunque la administradora ya lo haya revisado.",
      href: "/",
    },
    {
      titulo: "Reabrí un presupuesto aprobado si hace falta",
      detalle:
        "Crea una versión nueva (v2, v3…) y deja intacta la aprobada. El historial conserva las dos.",
      href: "/",
    },
    {
      titulo: "En pagos: liberá lo que se va a pagar",
      detalle:
        "Seleccionás los movimientos y los liberás en lote. Ahí se genera la nómina de transferencias masivas para subir al banco, y la administradora ejecuta.",
      href: "/bancos",
    },
    {
      titulo: "Confirmá las transferencias hechas",
      detalle:
        "Cuando la administradora sube el comprobante, vos marcás «Transferida». Recién ahí el pago queda cerrado.",
      href: "/bancos",
    },
  ],
  noLeToca: [
    { que: "Dar el visto bueno a un presupuesto", quien: "Es de la administradora — si vos revisaras y aprobaras, firmarías los dos pasos" },
    { que: "Cargar ventas, gastos o CAPEX", quien: "Cada encargado carga los de su empresa" },
    { que: "Aprobar algo que revisaste vos mismo", quien: "La plataforma lo rechaza aunque tengas el permiso" },
  ],
  preguntas: [
    {
      p: "¿Por qué no puedo dar el visto bueno?",
      r: "Porque después tendrías que aprobar lo mismo, y la aprobación dejaría de tener dos manos. La revisión es de la administradora; si no está, la hace el administrador de la plataforma.",
    },
    {
      p: "Aprobé un presupuesto y hay que cambiarlo.",
      r: "Usá «Reabrir». Se crea una versión nueva editable y la versión aprobada queda guardada tal cual para auditoría.",
    },
    {
      p: "¿Qué es la nómina de transferencias?",
      r: "Un Excel con formato de banco que junta todo lo que liberaste en ese lote: RUT, cuenta, monto y glosa. Se descarga desde Bancos.",
    },
  ],
};

const fundAdmin: Guia = {
  rol: "Administrador de la plataforma",
  resumen:
    "Ves las 10 entidades, consolidás el fondo y podés destrabar cualquier etapa cuando falta alguien. Todo lo que hacés queda en el historial con tu nombre.",
  pasos: [
    {
      titulo: "Seguí el avance de las 10 entidades",
      detalle: "El panel muestra en qué estado está cada presupuesto y quién movió la ficha por última vez.",
      href: "/",
    },
    {
      titulo: "Consolidá el fondo",
      detalle:
        "Ventas, gastos, flujo y CAPEX de todas las entidades juntas, con la ejecución real contra el presupuesto. Se exporta a Excel.",
      href: "/consolidado",
    },
    {
      titulo: "Destrabá el circuito cuando falte alguien",
      detalle:
        "Podés revisar y aprobar presupuestos, y operar el circuito de pagos completo. Con un límite que no se puede saltar: no podés aprobar un presupuesto que revisaste vos.",
      href: "/",
    },
    {
      titulo: "Administrá empresas y usuarios",
      detalle: "Datos de las entidades, categorías de gasto y tipos de cambio.",
      href: "/configuracion",
    },
  ],
  noLeToca: [
    { que: "Cargar el presupuesto de una empresa", quien: "Es del encargado — el fondo consolida y aprueba, no carga" },
    { que: "Aprobar lo que vos mismo revisaste", quien: "Otra persona con facultad de aprobar" },
  ],
  preguntas: [
    {
      p: "¿Puedo editar las líneas de una empresa?",
      r: "No. El fondo ve todo pero no carga: si el dato está mal, se observa el presupuesto y lo corrige el encargado. Así la cifra siempre tiene un dueño.",
    },
    {
      p: "¿Cómo devuelvo a edición un presupuesto importado?",
      r: "Observalo, o reabrilo si ya estaba aprobado.",
    },
  ],
};

const soloLectura: Guia = {
  rol: "Consulta",
  resumen: "Tenés acceso de lectura al presupuesto del fondo y sus empresas. No podés modificar ni firmar nada.",
  pasos: [
    { titulo: "Mirá el avance de las entidades", detalle: "El panel muestra el estado de cada presupuesto.", href: "/" },
    { titulo: "Entrá al detalle", detalle: "Ventas, gastos y CAPEX de cada empresa, en solo lectura.", href: "/ventas" },
  ],
  noLeToca: [
    { que: "Cargar o editar cifras", quien: "El encargado de cada empresa" },
    { que: "Revisar o aprobar", quien: "La administradora revisa y el dueño aprueba" },
  ],
  preguntas: [
    { p: "Necesito cargar datos.", r: "Pedí al administrador de la plataforma que te asigne el rol de encargado de tu empresa." },
  ],
};

const GUIAS: Record<string, Guia> = {
  COMPANY_MANAGER: encargado,
  ADMINISTRADORA: administradora,
  DUENO: dueno,
  FUND_ADMIN: fundAdmin,
  FUND_ANALYST: soloLectura,
  VIEWER: soloLectura,
};

export function guiaDe(role: string): Guia {
  return GUIAS[role] ?? soloLectura;
}
