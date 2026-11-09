/**
 * Series de Tiempo — API oficial de datos.gob.ar con decenas de miles de series
 * (INDEC, Economía, Trabajo, BCRA, etc.): IPC por rubro, salarios, EMAE, empleo, canasta, comercio exterior…
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getJson } from "./http.js";
import { fail, fechaISO, HORA, ok, safe, SOLO_LECTURA } from "./comun.js";
import { esPorcentual, inicioVentana, type Frecuencia, type Transformacion } from "./ventana.js";

const SERIES = "https://apis.datos.gob.ar/series/api";

type RespBusqueda = {
  count?: number;
  data: {
    field: {
      id: string;
      description: string;
      units: string;
      frequency: string;
      time_index_start: string;
      time_index_end: string;
    };
    dataset: { title: string; source?: string; theme?: string };
  }[];
};

type RespSeries = {
  data: (string | number | null)[][];
  count: number;
  meta: (
    | { frequency: Frecuencia; start_date: string; end_date: string }
    | { field: { id: string; description: string; units: string; representation_mode_units?: string }; dataset: { title: string; source?: string } }
  )[];
};

const FREC_ISO: Record<string, string> = {
  R_P1D: "diaria",
  R_P1W: "semanal",
  R_P1M: "mensual",
  R_P3M: "trimestral",
  R_P6M: "semestral",
  R_P1Y: "anual",
};

const TRANSFORMACIONES: Record<string, Transformacion> = {
  valor: "value",
  variacion: "change",
  variacion_pct: "percent_change",
  variacion_interanual: "change_a_year_ago",
  variacion_interanual_pct: "percent_change_a_year_ago",
};

export function registerSeries(server: McpServer) {
  server.registerTool(
    "buscar_series",
    {
      title: "Buscar series de tiempo oficiales",
      description:
        "Busca entre las series oficiales de datos.gob.ar (INDEC y ministerios): IPC por rubro y región, salarios, salario mínimo, " +
        "EMAE/actividad, desempleo, canasta básica, exportaciones, recaudación, etc. Devuelve ids para usar en consultar_series.",
      inputSchema: {
        texto: z.string().min(2).describe("Términos de búsqueda, ej. 'salario minimo', 'ipc alimentos', 'emae', 'canasta basica'."),
        limite: z.number().int().min(1).max(50).default(10),
      },
      annotations: SOLO_LECTURA,
    },
    safe(async ({ texto, limite }) => {
      const p = new URLSearchParams({ q: texto, limit: String(limite) });
      const r = await getJson<RespBusqueda>(`${SERIES}/search/?${p}`, { ttlMs: 6 * HORA });
      if (!r.data.length) return fail(`No se encontraron series para "${texto}". Probá con otros términos.`);
      const lista = r.data.map(({ field: f, dataset: d }) => ({
        id: f.id,
        descripcion: f.description,
        unidades: f.units,
        frecuencia: FREC_ISO[f.frequency.replace("/", "_")] ?? f.frequency,
        desde: f.time_index_start,
        hasta: f.time_index_end,
        dataset: d.title,
        fuente: d.source,
      }));
      return ok(lista, `${lista.length} series encontradas para "${texto}".`);
    }),
  );

  server.registerTool(
    "consultar_series",
    {
      title: "Consultar series de tiempo",
      description:
        "Devuelve valores de una o más series oficiales (ids de buscar_series), con transformaciones (variación, variación interanual en %) " +
        "y cambio de frecuencia (ej. mensual → anual promedio). Sin fechas devuelve los últimos N valores.",
      inputSchema: {
        ids: z.array(z.string()).min(1).max(10).describe("Ids de series, ej. ['148.3_INIVELNAL_DICI_M_26']."),
        transformacion: z
          .enum(["valor", "variacion", "variacion_pct", "variacion_interanual", "variacion_interanual_pct"])
          .default("valor")
          .describe("valor original, variación contra el período anterior, o contra el mismo período del año anterior (absoluta o en %)."),
        frecuencia: z
          .enum(["day", "week", "month", "quarter", "semester", "year"])
          .optional()
          .describe("Agregar a una frecuencia menor (ej. 'year' sobre una serie mensual)."),
        agregacion: z
          .enum(["avg", "sum", "end_of_period", "min", "max"])
          .default("avg")
          .describe("Cómo agregar al cambiar la frecuencia."),
        desde: fechaISO.optional(),
        hasta: fechaISO.optional(),
        ultimos: z.number().int().min(1).max(500).default(12).describe("Si no hay 'desde', cantidad de valores más recientes."),
      },
      annotations: SOLO_LECTURA,
    },
    safe(async ({ ids, transformacion, frecuencia, agregacion, desde, hasta, ultimos }) => {
      const t = TRANSFORMACIONES[transformacion];
      const base = new URLSearchParams({ ids: ids.join(",") });
      if (frecuencia) {
        base.set("collapse", frecuencia);
        base.set("collapse_aggregation", agregacion);
      }
      const url = (extra: Record<string, string>) => {
        const p = new URLSearchParams(base);
        for (const [k, v] of Object.entries(extra)) p.set(k, v);
        return `${SERIES}/series/?${p}`;
      };

      let r: RespSeries;
      if (desde) {
        r = await getJson<RespSeries>(url({ start_date: desde, ...(hasta && { end_date: hasta }), representation_mode: t, limit: "1000" }));
      } else if (t === "value") {
        r = await getJson<RespSeries>(url({ last: String(ultimos), ...(hasta && { end_date: hasta }) }));
      } else {
        // Workaround del bug de la API: ver ventana.ts
        const ref = await getJson<RespSeries>(url({ last: String(ultimos), metadata: "simple", ...(hasta && { end_date: hasta }) }));
        const meta = ref.meta[0] as { frequency: Frecuencia; start_date: string; end_date: string };
        const inicio = inicioVentana(meta.start_date, meta.frequency, t);
        r = await getJson<RespSeries>(
          url({ start_date: inicio, end_date: meta.end_date, representation_mode: t, limit: "1000" }),
        );
        r = { ...r, data: r.data.slice(-ultimos) };
      }

      if (!r.data.length) return fail("La consulta no devolvió valores para ese rango.");

      const porcentual = esPorcentual(t);
      const columnas = r.meta.slice(1).map((m) => {
        const f = (m as Extract<RespSeries["meta"][number], { field: unknown }>).field;
        return { id: f.id, descripcion: f.description, unidades: porcentual ? "%" : f.units };
      });
      const filas = r.data.map(([fecha, ...valores]) => {
        const fila: Record<string, string | number | null> = { fecha: String(fecha) };
        valores.forEach((v, i) => {
          fila[columnas[i].id] = typeof v === "number" ? Number((porcentual ? v * 100 : v).toFixed(4)) : null;
        });
        return fila;
      });

      const ultima = filas[filas.length - 1];
      const resumen =
        `${filas.length} valores (${transformacion}${frecuencia ? `, frecuencia ${frecuencia}/${agregacion}` : ""}), ` +
        `de ${filas[0].fecha} a ${ultima.fecha}. Último: ` +
        columnas.map((c) => `${c.descripcion} = ${ultima[c.id] ?? "s/d"}${porcentual ? "%" : ""}`).join(" | ");
      return ok({ series: columnas, datos: filas }, resumen);
    }),
  );
}
