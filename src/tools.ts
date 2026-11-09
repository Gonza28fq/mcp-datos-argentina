import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { describeError, getJson, HttpError } from "./http.js";
import { esCuitValido, formatearCuit, normalizarCuit } from "./cuit.js";
import { acumulada, ajustarMonto, filtrarPorMes, mes, type PuntoInflacion } from "./inflacion.js";

const BCRA = "https://api.bcra.gob.ar";
const DOLAR_API = "https://dolarapi.com/v1";
const ARG_DATOS = "https://api.argentinadatos.com/v1";

const HORA = 60 * 60_000;

// ---------- helpers ----------

const ok = (data: unknown, resumen?: string): CallToolResult => ({
  content: [
    {
      type: "text",
      text: (resumen ? resumen + "\n\n" : "") + JSON.stringify(data, null, 2),
    },
  ],
});

const fail = (msg: string): CallToolResult => ({
  content: [{ type: "text", text: msg }],
  isError: true,
});

/** Envuelve el handler para que cualquier error de red vuelva como resultado legible. */
function safe<A>(fn: (args: A) => Promise<CallToolResult>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return await fn(args);
    } catch (err) {
      return fail(`Error consultando la fuente: ${describeError(err)}`);
    }
  };
}

const fechaISO = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato esperado: YYYY-MM-DD");
const mesISO = z.string().regex(/^\d{4}-\d{2}$/, "Formato esperado: YYYY-MM");

const hoy = () => new Date().toISOString().slice(0, 10);

// ---------- tipos de las APIs ----------

type Dolar = {
  moneda: string;
  casa: string;
  nombre: string;
  compra: number | null;
  venta: number | null;
  fechaActualizacion: string;
};

type VariableBcra = {
  idVariable: number;
  descripcion: string;
  categoria: string;
  tipoSerie?: string;
  periodicidad?: string;
  unidadExpresion?: string;
  moneda?: string;
  primerFechaInformada?: string;
  ultFechaInformada?: string;
  ultValorInformado?: number;
};

type BcraResp<T> = { status: number; results: T; metadata?: unknown };

type Cotizacion = {
  fecha: string;
  detalle: { codigoMoneda: string; descripcion: string; tipoPase: number; tipoCotizacion: number }[];
};

type EntidadDeuda = {
  entidad: string;
  situacion: number;
  monto: number;
  diasAtrasoPago?: number;
  refinanciaciones?: boolean;
  situacionJuridica?: boolean;
  procesoJud?: boolean;
  enRevision?: boolean;
};

type Deudas = {
  identificacion: number;
  denominacion: string;
  periodos: { periodo: string; entidades: EntidadDeuda[] }[];
};

const SITUACIONES: Record<number, string> = {
  1: "Normal",
  2: "Con seguimiento especial / riesgo bajo",
  3: "Con problemas / riesgo medio",
  4: "Con alto riesgo de insolvencia / riesgo alto",
  5: "Irrecuperable",
  6: "Irrecuperable por disposición técnica",
};

// ---------- registro ----------

export function registerTools(server: McpServer) {
  // 1. Dólar (todas las cotizaciones de mercado)
  server.registerTool(
    "cotizaciones_dolar",
    {
      title: "Cotizaciones del dólar",
      description:
        "Cotizaciones actuales del dólar en Argentina: oficial, blue, bolsa (MEP), contado con liquidación (CCL), mayorista, cripto y tarjeta. Fuente: dolarapi.com.",
      inputSchema: {
        casa: z
          .enum(["oficial", "blue", "bolsa", "contadoconliqui", "mayorista", "cripto", "tarjeta"])
          .optional()
          .describe("Tipo de dólar. Si se omite, devuelve todos."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async ({ casa }) => {
      const url = casa ? `${DOLAR_API}/dolares/${casa}` : `${DOLAR_API}/dolares`;
      const data = await getJson<Dolar | Dolar[]>(url, { ttlMs: 2 * 60_000 });
      const lista = Array.isArray(data) ? data : [data];
      const resumen = lista
        .map((d) => `${d.nombre}: compra ${d.compra ?? "-"} / venta ${d.venta ?? "-"}`)
        .join("\n");
      return ok(lista, resumen);
    }),
  );

  // 2. Cotización oficial BCRA de cualquier moneda
  server.registerTool(
    "cotizacion_bcra",
    {
      title: "Cotización oficial BCRA",
      description:
        "Tipo de cambio oficial publicado por el BCRA (Comunicación A 3500 / estadísticas cambiarias) para una moneda (USD, EUR, BRL, etc.). Sin fechas devuelve la última publicación de todas las monedas.",
      inputSchema: {
        moneda: z
          .string()
          .length(3)
          .optional()
          .describe("Código ISO de la moneda, ej. USD, EUR, BRL. Si se omite, devuelve todas."),
        desde: fechaISO.optional().describe("Fecha inicial YYYY-MM-DD (requiere moneda)."),
        hasta: fechaISO.optional().describe("Fecha final YYYY-MM-DD (por defecto hoy)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async ({ moneda, desde, hasta }) => {
      if (!moneda) {
        const r = await getJson<BcraResp<Cotizacion>>(`${BCRA}/estadisticascambiarias/v1.0/Cotizaciones`);
        return ok(r.results, `Cotizaciones BCRA del ${r.results.fecha}`);
      }
      const cod = moneda.toUpperCase();
      const params = new URLSearchParams();
      if (desde) {
        params.set("fechadesde", desde);
        params.set("fechahasta", hasta ?? hoy());
      }
      const url = `${BCRA}/estadisticascambiarias/v1.0/Cotizaciones/${cod}${params.size ? "?" + params : ""}`;
      const r = await getJson<BcraResp<Cotizacion[]>>(url);
      const serie = r.results.map((c) => ({
        fecha: c.fecha,
        cotizacion: c.detalle[0]?.tipoCotizacion,
        pase: c.detalle[0]?.tipoPase,
      }));
      return ok(serie, `${cod}: ${serie.length} cotizaciones (más reciente primero).`);
    }),
  );

  // 3. Buscar variables monetarias BCRA
  server.registerTool(
    "buscar_variables_bcra",
    {
      title: "Buscar variables del BCRA",
      description:
        "Busca entre las ~1600 variables monetarias del BCRA (reservas, base monetaria, tasas BADLAR/TAMAR, CER, UVA, ICL, inflación, bandas cambiarias, etc.) y devuelve su id y último valor. Usar el id con serie_variable_bcra.",
      inputSchema: {
        texto: z
          .string()
          .optional()
          .describe("Texto a buscar en la descripción (sin distinguir mayúsculas ni acentos). Si se omite, devuelve las 'Principales Variables'."),
        limite: z.number().int().min(1).max(100).default(25),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async ({ texto, limite }) => {
      const r = await getJson<BcraResp<VariableBcra[]>>(
        `${BCRA}/estadisticas/v4.0/monetarias?limit=3000`,
        { ttlMs: 6 * HORA },
      );
      const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
      const terminos = texto ? norm(texto).split(/\s+/).filter(Boolean) : [];
      const filtradas = r.results.filter((v) =>
        terminos.length
          ? terminos.every((t) => norm(v.descripcion).includes(t))
          : v.categoria === "Principales Variables",
      );
      const out = filtradas.slice(0, limite).map((v) => ({
        id: v.idVariable,
        descripcion: v.descripcion.trim(),
        categoria: v.categoria,
        unidad: v.unidadExpresion,
        periodicidad: v.periodicidad,
        ultimaFecha: v.ultFechaInformada,
        ultimoValor: v.ultValorInformado,
      }));
      return ok(out, `${filtradas.length} variables encontradas (mostrando ${out.length}).`);
    }),
  );

  // 4. Serie de una variable BCRA
  server.registerTool(
    "serie_variable_bcra",
    {
      title: "Serie histórica de variable BCRA",
      description:
        "Devuelve los valores de una variable monetaria del BCRA por id (ej. 1 = Reservas, 4 = dólar minorista, 7 = BADLAR, 27 = inflación mensual, 30 = CER, 31 = UVA, 40 = ICL). Usar buscar_variables_bcra para encontrar ids.",
      inputSchema: {
        id: z.number().int().positive().describe("idVariable del BCRA."),
        desde: fechaISO.optional(),
        hasta: fechaISO.optional(),
        limite: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .default(30)
          .describe("Cantidad máxima de valores (los más recientes primero)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async ({ id, desde, hasta, limite }) => {
      const params = new URLSearchParams({ limit: String(limite) });
      if (desde) params.set("desde", desde);
      if (hasta) params.set("hasta", hasta);
      const r = await getJson<BcraResp<{ idVariable: number; detalle: { fecha: string; valor: number }[] }[]>>(
        `${BCRA}/estadisticas/v4.0/monetarias/${id}?${params}`,
      );
      const detalle = r.results[0]?.detalle ?? [];
      if (!detalle.length) return fail(`La variable ${id} no tiene datos en el rango pedido.`);
      return ok(detalle, `Variable ${id}: ${detalle.length} valores, último ${detalle[0].fecha} = ${detalle[0].valor}.`);
    }),
  );

  // 5. Central de Deudores
  server.registerTool(
    "consultar_deudor",
    {
      title: "Central de Deudores BCRA",
      description:
        "Consulta la situación crediticia de un CUIT/CUIL en la Central de Deudores del BCRA (deudas por entidad, situación 1-6) y cheques rechazados. Montos tal como los informa el BCRA (unidad no documentada públicamente). Información pública del BCRA.",
      inputSchema: {
        cuit: z.string().describe("CUIT/CUIL, con o sin guiones."),
        historico: z
          .boolean()
          .default(false)
          .describe("Si es true, incluye los últimos 24 meses en lugar de solo el último período."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async ({ cuit, historico }) => {
      const id = normalizarCuit(cuit);
      if (!esCuitValido(id)) return fail(`El CUIT/CUIL "${cuit}" no es válido (dígito verificador incorrecto o formato inválido).`);

      const opcional = async <T>(url: string): Promise<T | null> => {
        try {
          return await getJson<T>(url, { ttlMs: HORA });
        } catch (e) {
          if (e instanceof HttpError && e.status === 404) return null;
          throw e;
        }
      };

      const [deudas, cheques] = await Promise.all([
        opcional<BcraResp<Deudas>>(
          `${BCRA}/centraldedeudores/v1.0/Deudas/${historico ? "Historicas/" : ""}${id}`,
        ),
        opcional<BcraResp<unknown>>(`${BCRA}/centraldedeudores/v1.0/ChequesRechazados/${id}`),
      ]);

      if (!deudas) {
        return ok(
          { cuit: formatearCuit(id), deudas: [], chequesRechazados: cheques?.results ?? null },
          `${formatearCuit(id)}: sin deudas informadas en la Central de Deudores.`,
        );
      }

      const periodos = deudas.results.periodos.map((p) => ({
        periodo: `${p.periodo.slice(0, 4)}-${p.periodo.slice(4)}`,
        montoTotal: p.entidades.reduce((s, e) => s + e.monto, 0),
        peorSituacion: Math.max(...p.entidades.map((e) => e.situacion)),
        entidades: p.entidades.map((e) => ({
          entidad: e.entidad,
          situacion: e.situacion,
          situacionDescripcion: SITUACIONES[e.situacion] ?? "Desconocida",
          monto: e.monto,
          diasAtraso: e.diasAtrasoPago,
          procesoJudicial: e.procesoJud,
        })),
      }));
      const ult = periodos[0];
      const fmt = (n: number) => n.toLocaleString("es-AR");
      const irregulares = ult.entidades.filter((e) => e.situacion > 1);
      const montoIrregular = irregulares.reduce((s, e) => s + e.monto, 0);
      const detalleIrregular = irregulares.length
        ? `${irregulares.length} con situación irregular por $${fmt(montoIrregular)} ` +
          `(${((montoIrregular / ult.montoTotal) * 100).toFixed(2)}% del total): ` +
          irregulares
            .map((e) => `${e.entidad} sit. ${e.situacion} $${fmt(e.monto)}`)
            .join("; ") +
          "."
        : "todas en situación 1 (Normal).";
      const resumen =
        `${deudas.results.denominacion} (${formatearCuit(id)}) — período ${ult.periodo}: ` +
        `${ult.entidades.length} entidades, monto total $${fmt(ult.montoTotal)}; ${detalleIrregular} ` +
        `Cheques rechazados: ${cheques ? "SÍ, ver detalle" : "no registra"}.`;
      return ok(
        { denominacion: deudas.results.denominacion, cuit: formatearCuit(id), periodos, chequesRechazados: cheques?.results ?? null },
        resumen,
      );
    }),
  );

  // 6. Feriados
  server.registerTool(
    "feriados",
    {
      title: "Feriados nacionales",
      description:
        "Feriados nacionales de Argentina (inamovibles, trasladables y días no laborables con fines turísticos) para un año. Con solo_proximos=true devuelve los que faltan a partir de hoy.",
      inputSchema: {
        anio: z.number().int().min(2016).max(2100).optional().describe("Año (por defecto el actual)."),
        solo_proximos: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async ({ anio, solo_proximos }) => {
      const year = anio ?? new Date().getFullYear();
      const lista = await getJson<{ fecha: string; tipo: string; nombre: string }[]>(
        `${ARG_DATOS}/feriados/${year}`,
        { ttlMs: 24 * HORA },
      );
      const hoyStr = hoy();
      const out = solo_proximos ? lista.filter((f) => f.fecha >= hoyStr) : lista;
      const resumen = out.length
        ? `${out.length} feriados${solo_proximos ? " próximos" : ""} en ${year}. Próximo: ${
            lista.find((f) => f.fecha >= hoyStr)?.fecha ?? "ninguno este año"
          }.`
        : `No quedan feriados en ${year}.`;
      return ok(out, resumen);
    }),
  );

  // 7. Inflación
  const serieInflacion = () =>
    getJson<PuntoInflacion[]>(`${ARG_DATOS}/finanzas/indices/inflacion`, { ttlMs: 6 * HORA });

  server.registerTool(
    "inflacion",
    {
      title: "Inflación mensual (IPC)",
      description:
        "Inflación mensual del IPC (INDEC) y acumulada para un rango de meses. Sin rango devuelve los últimos 12 meses publicados.",
      inputSchema: {
        desde: mesISO.optional().describe("Mes inicial YYYY-MM."),
        hasta: mesISO.optional().describe("Mes final YYYY-MM."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async ({ desde, hasta }) => {
      const serie = await serieInflacion();
      const puntos = desde || hasta ? filtrarPorMes(serie, desde, hasta) : serie.slice(-12);
      if (!puntos.length) return fail("No hay datos de inflación para ese rango.");
      const datos = puntos.map((p) => ({ mes: mes(p.fecha), inflacionPct: p.valor }));
      const acum = acumulada(puntos);
      return ok(
        { meses: datos, acumuladaPct: Number(acum.toFixed(2)) },
        `Inflación ${datos[0].mes} a ${datos[datos.length - 1].mes}: acumulada ${acum.toFixed(2)}% (${datos.length} meses).`,
      );
    }),
  );

  // 8. Ajustar monto por inflación
  server.registerTool(
    "ajustar_por_inflacion",
    {
      title: "Ajustar monto por inflación",
      description:
        "Convierte un monto en pesos de un mes a pesos de otro mes usando el IPC (ej. '¿cuánto son hoy $100.000 de enero 2023?'). También funciona hacia atrás.",
      inputSchema: {
        monto: z.number().describe("Monto en pesos."),
        desde: mesISO.describe("Mes en que está expresado el monto (YYYY-MM)."),
        hasta: mesISO.optional().describe("Mes destino (YYYY-MM). Por defecto el último mes publicado."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async ({ monto, desde, hasta }) => {
      const serie = await serieInflacion();
      const destino = hasta ?? mes(serie[serie.length - 1].fecha);
      const r = ajustarMonto(serie, monto, desde, destino);
      const fmt = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 });
      return ok(
        { ...r, montoAjustado: Number(r.montoAjustado.toFixed(2)), inflacionAcumuladaPct: Number(r.inflacionAcumuladaPct.toFixed(2)) },
        `$${fmt(monto)} de ${desde} equivalen a $${fmt(r.montoAjustado)} de ${destino} (inflación acumulada ${r.inflacionAcumuladaPct.toFixed(2)}%).` +
          (r.advertencia ? `\n⚠ ${r.advertencia}` : ""),
      );
    }),
  );
}
