/** Tools de cálculo: aguinaldo, cuotas vs. contado y crédito UVA. La matemática está en calculadoras.ts. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getJson } from "./http.js";
import { fail, fechaISO, HORA, hoy, ok, safe, SOLO_LECTURA } from "./comun.js";
import { calcularAguinaldo, compararCuotasContado, promedioUltimos, simularCreditoUva } from "./calculadoras.js";
import { mes, type PuntoInflacion } from "./inflacion.js";
import * as S from "./esquemas.js";

const INFLACION_URL = "https://api.argentinadatos.com/v1/finanzas/indices/inflacion";
const UVA_ID = 31;

const fmt = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 });

/** Inflación mensual de referencia: la que pasó el usuario o el promedio de los últimos `meses` publicados. */
async function inflacionReferencia(explicita: number | undefined, meses: number) {
  if (explicita !== undefined) return { valorPct: explicita, origen: "indicada por el usuario" };
  const serie = await getJson<PuntoInflacion[]>(INFLACION_URL, { ttlMs: 6 * HORA });
  const ult = serie.slice(-meses);
  return {
    valorPct: Number(promedioUltimos(ult.map((p) => p.valor), meses).toFixed(2)),
    origen: `promedio IPC ${mes(ult[0].fecha)} a ${mes(ult[ult.length - 1].fecha)} (INDEC)`,
  };
}

export function registerCalculadoras(server: McpServer) {
  server.registerTool(
    "calcular_aguinaldo",
    {
      title: "Calcular aguinaldo (SAC)",
      description:
        "Calcula el aguinaldo (sueldo anual complementario) de un semestre: 50% del mejor sueldo bruto mensual, " +
        "proporcional a los días trabajados si hubo ingreso o egreso durante el semestre. Incluye un neto estimado (aportes del 17%) y la fecha de vencimiento.",
      inputSchema: {
        mejor_sueldo: z.number().positive().describe("Mayor remuneración mensual bruta del semestre, en pesos."),
        anio: z.number().int().min(2000).max(2100).optional().describe("Año (por defecto el actual)."),
        semestre: z.union([z.literal(1), z.literal(2)]).optional().describe("1 = enero-junio, 2 = julio-diciembre. Por defecto el semestre en curso."),
        fecha_ingreso: fechaISO.optional().describe("Si empezó a trabajar durante el semestre (YYYY-MM-DD)."),
        fecha_egreso: fechaISO.optional().describe("Si dejó de trabajar durante el semestre (YYYY-MM-DD)."),
      },
      outputSchema: S.salidaAguinaldo,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async ({ mejor_sueldo, anio, semestre, fecha_ingreso, fecha_egreso }) => {
      const h = hoy();
      const sem = semestre ?? (Number(h.slice(5, 7)) <= 6 ? 1 : 2);
      let r;
      try {
        r = calcularAguinaldo({
          mejorSueldo: mejor_sueldo,
          anio: anio ?? Number(h.slice(0, 4)),
          semestre: sem,
          fechaIngreso: fecha_ingreso,
          fechaEgreso: fecha_egreso,
        });
      } catch (e) {
        return fail((e as Error).message);
      }
      const resumen =
        `Aguinaldo del ${r.semestre}: $${fmt(r.aguinaldoBruto)} bruto` +
        (r.proporcional ? ` (proporcional: ${r.diasTrabajados} de ${r.diasSemestre} días)` : "") +
        `, unos $${fmt(r.aguinaldoNetoEstimado)} netos. Vence el ${r.vencimiento}.\n` +
        "El neto es estimado (jubilación 11%, PAMI 3%, obra social 3%); no considera ganancias ni otros descuentos del recibo.";
      return ok(r, resumen);
    }),
  );

  server.registerTool(
    "cuotas_vs_contado",
    {
      title: "¿Cuotas o contado?",
      description:
        "Compara pagar en cuotas contra pagar de contado trayendo las cuotas a valor presente con la inflación esperada. " +
        "Devuelve el valor presente de las cuotas, cuánto se ahorra o se pierde, y la tasa de interés implícita en las cuotas (mensual y anual). " +
        "Por defecto usa como inflación esperada el promedio de los últimos 3 meses publicados.",
      inputSchema: {
        precio_contado: z.number().positive().describe("Precio pagando de contado (con el descuento, si lo hay)."),
        cantidad_cuotas: z.number().int().min(1).max(120),
        monto_cuota: z.number().positive().optional().describe("Valor de cada cuota. Indicar esto o total_financiado."),
        total_financiado: z.number().positive().optional().describe("Total a pagar en cuotas. Indicar esto o monto_cuota."),
        inflacion_mensual_pct: z.number().min(-10).max(100).optional().describe("Inflación mensual esperada en %. Por defecto, el promedio de los últimos 3 meses."),
        primera_cuota_hoy: z.boolean().default(false).describe("true si la primera cuota se paga en el momento de la compra."),
      },
      outputSchema: S.salidaCuotasVsContado,
      annotations: SOLO_LECTURA,
    },
    safe(async ({ precio_contado, cantidad_cuotas, monto_cuota, total_financiado, inflacion_mensual_pct, primera_cuota_hoy }) => {
      const cuota = monto_cuota ?? (total_financiado !== undefined ? total_financiado / cantidad_cuotas : undefined);
      if (cuota === undefined) return fail("Indicá monto_cuota o total_financiado.");
      const infl = await inflacionReferencia(inflacion_mensual_pct, 3);
      const r = compararCuotasContado({
        precioContado: precio_contado,
        cantidadCuotas: cantidad_cuotas,
        montoCuota: cuota,
        tasaDescuentoMensualPct: infl.valorPct,
        primeraCuotaHoy: primera_cuota_hoy,
      });
      const veredicto =
        r.conviene === "cuotas"
          ? `conviene en cuotas: a valor de hoy pagás $${fmt(-r.diferenciaVsContado)} menos`
          : r.conviene === "contado"
            ? `conviene de contado: las cuotas cuestan $${fmt(r.diferenciaVsContado)} más a valor de hoy`
            : "es prácticamente indistinto";
      const resumen =
        `${cantidad_cuotas} cuotas de $${fmt(cuota)} (total $${fmt(r.totalEnCuotas)}, ${r.recargoNominalPct >= 0 ? "+" : ""}${fmt(r.recargoNominalPct)}% sobre contado) ` +
        `vs. $${fmt(precio_contado)} de contado: ${veredicto}. ` +
        `Las cuotas tienen un interés implícito de ${fmt(r.tasaImplicitaMensualPct)}% mensual (${fmt(r.tasaImplicitaAnualPct)}% anual efectivo), ` +
        `contra una inflación esperada de ${fmt(infl.valorPct)}% mensual (${infl.origen}).\n` +
        "La inflación futura es incierta: si baja, las cuotas convienen menos.";
      return ok({ ...r, cuota: Number(cuota.toFixed(2)), inflacionUsada: infl }, resumen);
    }),
  );

  server.registerTool(
    "simular_credito_uva",
    {
      title: "Simular crédito UVA",
      description:
        "Simula un crédito hipotecario o personal en UVAs (sistema francés): capital y cuota en UVAs, cuota inicial en pesos con el valor UVA de hoy (BCRA), " +
        "ingreso mínimo según la relación cuota/ingreso y una proyección de la cuota y el saldo en pesos con una inflación supuesta " +
        "(por defecto, el promedio de los últimos 6 meses).",
      inputSchema: {
        monto: z.number().positive().describe("Monto del préstamo en pesos."),
        plazo_meses: z.number().int().min(6).max(480).describe("Plazo en meses (ej. 240 = 20 años)."),
        tna_pct: z.number().min(0).max(100).describe("Tasa nominal anual sobre UVA, en % (ej. 4.5)."),
        ingreso_mensual: z.number().positive().optional().describe("Ingreso neto mensual del grupo familiar, para verificar la relación cuota/ingreso."),
        relacion_cuota_ingreso_max_pct: z.number().min(5).max(50).default(25).describe("Relación cuota/ingreso máxima que exige el banco, en %."),
        inflacion_mensual_pct: z.number().min(-10).max(100).optional().describe("Inflación mensual supuesta para proyectar la UVA. Por defecto, el promedio de los últimos 6 meses."),
      },
      outputSchema: S.salidaCreditoUva,
      annotations: SOLO_LECTURA,
    },
    safe(async ({ monto, plazo_meses, tna_pct, ingreso_mensual, relacion_cuota_ingreso_max_pct, inflacion_mensual_pct }) => {
      const [uvaResp, infl] = await Promise.all([
        getJson<{ results: { detalle: { fecha: string; valor: number }[] }[] }>(
          // El BCRA publica la UVA por adelantado: pedir hasta hoy para no tomar un valor futuro.
          `https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/${UVA_ID}?hasta=${hoy()}&limit=1`,
          { ttlMs: HORA },
        ),
        inflacionReferencia(inflacion_mensual_pct, 6),
      ]);
      const uva = uvaResp.results[0]?.detalle[0];
      if (!uva) return fail("No se pudo obtener el valor de la UVA del BCRA.");

      const r = simularCreditoUva({
        montoPesos: monto,
        plazoMeses: plazo_meses,
        tnaPct: tna_pct,
        valorUva: uva.valor,
        inflacionMensualPct: infl.valorPct,
        ingresoMensual: ingreso_mensual,
        relacionCuotaIngresoMaxPct: relacion_cuota_ingreso_max_pct,
      });
      const ultima = r.proyeccion.find((p) => p.mes === 12) ?? r.proyeccion.at(-1)!;
      const resumen =
        `$${fmt(monto)} a ${plazo_meses} meses con TNA ${fmt(tna_pct)}% + UVA (UVA $${fmt(uva.valor)} al ${uva.fecha}): ` +
        `${fmt(r.capitalUva)} UVAs, cuota de ${fmt(r.cuotaUva)} UVAs = $${fmt(r.cuotaInicialPesos)} hoy. ` +
        `Ingreso mínimo (${relacion_cuota_ingreso_max_pct}%): $${fmt(r.ingresoMinimo)}` +
        (r.relacionCuotaIngresoPct !== null
          ? `; con tu ingreso la cuota es el ${fmt(r.relacionCuotaIngresoPct)}% (${r.calificaPorIngreso ? "califica" : "no califica"}).`
          : ".") +
        ` Con ${fmt(infl.valorPct)}% de inflación mensual (${infl.origen}), en el mes ${ultima.mes} la cuota sería $${fmt(ultima.cuotaPesos)}.\n` +
        "La cuota en UVAs es fija, pero en pesos sube con la inflación. Es una simulación: cada banco tiene sus propias condiciones, seguros y gastos.";
      return ok({ ...r, valorUva: uva, inflacionUsada: infl }, resumen);
    }),
  );
}
