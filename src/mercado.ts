/** Riesgo país y plazos fijos (argentinadatos.com). */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getJson } from "./http.js";
import { fail, fechaISO, HORA, ok, safe, SOLO_LECTURA } from "./comun.js";
import { rendimiento, tasaPara, tasaRealMensualPct, type BancoPlazoFijo } from "./plazofijo.js";
import type { PuntoInflacion } from "./inflacion.js";

const ARG_DATOS = "https://api.argentinadatos.com/v1/finanzas";

const r2 = (n: number) => Number(n.toFixed(2));
const signo = (n: number) => (n > 0 ? "+" : "") + n.toLocaleString("es-AR", { maximumFractionDigits: 2 });

export function registerMercado(server: McpServer) {
  server.registerTool(
    "riesgo_pais",
    {
      title: "Riesgo país",
      description:
        "Riesgo país de Argentina (EMBI, en puntos básicos): último valor, variación diaria y en el período, mínimo y máximo, y la serie. " +
        "Por defecto los últimos 30 días hábiles; historia disponible desde 1999.",
      inputSchema: {
        desde: fechaISO.optional(),
        hasta: fechaISO.optional(),
        ultimos: z.number().int().min(1).max(2000).default(30).describe("Si no hay 'desde', cantidad de días hábiles más recientes."),
      },
      annotations: SOLO_LECTURA,
    },
    safe(async ({ desde, hasta, ultimos }) => {
      const serie = await getJson<{ fecha: string; valor: number }[]>(`${ARG_DATOS}/indices/riesgo-pais`, { ttlMs: HORA });
      const puntos = desde
        ? serie.filter((p) => p.fecha >= desde && (!hasta || p.fecha <= hasta))
        : serie.filter((p) => !hasta || p.fecha <= hasta).slice(-ultimos);
      if (!puntos.length) return fail("No hay datos de riesgo país para ese rango.");

      const ult = puntos[puntos.length - 1];
      const ant = puntos.length > 1 ? puntos[puntos.length - 2] : null;
      const ini = puntos[0];
      const min = puntos.reduce((a, b) => (b.valor < a.valor ? b : a));
      const max = puntos.reduce((a, b) => (b.valor > a.valor ? b : a));
      const varPeriodo = ult.valor - ini.valor;

      const resumen =
        `Riesgo país ${ult.valor} pb (${ult.fecha})` +
        (ant ? `, ${signo(ult.valor - ant.valor)} pb vs ${ant.fecha}` : "") +
        `. En el período ${ini.fecha} → ${ult.fecha}: ${signo(varPeriodo)} pb (${signo((varPeriodo / ini.valor) * 100)}%); ` +
        `mínimo ${min.valor} (${min.fecha}), máximo ${max.valor} (${max.fecha}).`;
      return ok(
        {
          ultimo: ult,
          variacionDiariaPb: ant ? ult.valor - ant.valor : null,
          variacionPeriodoPb: varPeriodo,
          variacionPeriodoPct: r2((varPeriodo / ini.valor) * 100),
          minimo: min,
          maximo: max,
          serie: puntos,
        },
        resumen,
      );
    }),
  );

  server.registerTool(
    "plazos_fijos",
    {
      title: "Plazos fijos por banco",
      description:
        "Compara las tasas de plazo fijo en pesos de bancos y billeteras (TNA, TEA, rendimiento mensual) ordenadas de mayor a menor. " +
        "Con monto calcula el interés de cada uno, y compara el rendimiento contra la última inflación mensual (tasa real).",
      inputSchema: {
        dias: z.number().int().min(30).max(1095).default(30).describe("Plazo en días (mínimo legal 30)."),
        monto: z.number().positive().optional().describe("Monto a invertir en pesos, para calcular el interés."),
        cliente: z
          .boolean()
          .default(true)
          .describe("true = tasas para clientes del banco; false = solo bancos que aceptan no clientes."),
        limite: z.number().int().min(1).max(50).default(10),
      },
      annotations: SOLO_LECTURA,
    },
    safe(async ({ dias, monto, cliente, limite }) => {
      const [bancos, inflacion] = await Promise.all([
        getJson<BancoPlazoFijo[]>(`${ARG_DATOS}/tasas/plazoFijo`, { ttlMs: HORA }),
        getJson<PuntoInflacion[]>(`https://api.argentinadatos.com/v1/finanzas/indices/inflacion`, { ttlMs: 6 * HORA }).catch(
          () => null, // la comparación con inflación es un extra: si falla, seguimos sin ella
        ),
      ]);

      const consulta = { dias, monto, cliente };
      const conTasa = bancos
        .map((b) => ({ b, t: tasaPara(b, consulta) }))
        .filter((x): x is { b: BancoPlazoFijo; t: NonNullable<typeof x.t> } => x.t !== null)
        .sort((a, z2) => z2.t.tna - a.t.tna);

      if (!conTasa.length) {
        return fail(
          `Ningún banco publica una tasa para ${dias} días${cliente ? "" : " para no clientes"}. ` +
            `Los plazos más comunes son 30, 60, 90 y 365 días.`,
        );
      }

      const ultInfl = inflacion?.at(-1);
      const filas = conTasa.slice(0, limite).map(({ b, t }) => {
        const r = rendimiento(t.tna, dias, monto);
        return {
          entidad: b.entidad,
          tnaPct: r2(r.tnaPct),
          teaPct: r2(r.teaPct),
          efectivaMensualPct: r2(r.efectivaMensualPct),
          ...(ultInfl && { tasaRealMensualPct: r2(tasaRealMensualPct(r.efectivaMensualPct, ultInfl.valor)) }),
          ...(r.interes !== undefined && { interes: r2(r.interes), montoFinal: r2(r.montoFinal!) }),
          origenTasa: t.origen === "tramo" ? `tramo publicado para ${dias} días` : "TNA de referencia a 30 días",
          enlace: b.enlace ?? undefined,
        };
      });

      const mejor = filas[0];
      const fmt = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 });
      let resumen =
        `${conTasa.length} de ${bancos.length} entidades publican tasa a ${dias} días${cliente ? "" : " para no clientes"}. ` +
        `Mejor: ${mejor.entidad} con TNA ${fmt(mejor.tnaPct)}% (TEA ${fmt(mejor.teaPct)}%)` +
        (mejor.interes !== undefined ? `: $${fmt(monto!)} → $${fmt(mejor.montoFinal!)} (interés $${fmt(mejor.interes)})` : "") +
        ".";
      if (ultInfl && mejor.tasaRealMensualPct !== undefined) {
        resumen +=
          ` Contra la última inflación mensual (${fmt(ultInfl.valor)}% en ${ultInfl.fecha.slice(0, 7)}), ` +
          `rinde ${signo(mejor.tasaRealMensualPct)}% real por mes ` +
          `(${mejor.tasaRealMensualPct >= 0 ? "le gana" : "pierde contra"} la inflación).`;
      }
      return ok(filas, resumen + "\nNota: las tasas se actualizan con demora; confirmalas con el banco antes de invertir.");
    }),
  );
}
