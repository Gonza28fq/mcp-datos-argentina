/**
 * Prompts MCP: plantillas listas que combinan varias tools.
 * En Claude Code aparecen como /mcp__datos-argentina__<nombre>; en Claude Desktop, en el menú "+".
 *
 * Los argumentos de un prompt siempre llegan como texto (así lo define el protocolo),
 * por eso se validan con regex y se convierten acá.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { esCuitValido, formatearCuit, normalizarCuit } from "./cuit.js";

type Mensaje = { role: "user"; content: { type: "text"; text: string } };
const usuario = (text: string): { messages: Mensaje[] } => ({ messages: [{ role: "user", content: { type: "text", text } }] });

const ESTILO =
  "Respondé en español rioplatense, con números formateados al estilo argentino ($ 1.234,56) y citando la fecha de cada dato. " +
  "Si una tool falla o no tiene datos, decilo y seguí con el resto: no inventes valores.";

/** "1.500.000", "1500000", "1,5e6" → 1500000. Acepta puntos de miles y coma decimal. */
export function parsearMonto(texto: string): number | null {
  const limpio = texto.trim().replace(/\$|\s/g, "");
  const normal = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(limpio) ? limpio.replace(/\./g, "").replace(",", ".") : limpio.replace(",", ".");
  const n = Number(normal);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ---------- textos (exportados para testearlos sin levantar el servidor) ----------

export function textoInformeDelDia(): string {
  return [
    "Armá un informe económico breve de Argentina para hoy. Usá estas tools:",
    "1. `cotizaciones_dolar`: oficial, blue, MEP y CCL; calculá la brecha del blue y del MEP contra el oficial.",
    "2. `riesgo_pais` (últimos 30 días): valor actual y tendencia del mes.",
    "3. `inflacion` (últimos 12 meses): último dato mensual, interanual y acumulado del año.",
    "4. `plazos_fijos` (30 días): la mejor TNA y la tasa real contra la última inflación.",
    "5. `feriados` con solo_proximos: el próximo feriado.",
    "",
    "Formato: un titular de una línea, después una tabla con los indicadores (valor, variación, fecha del dato) " +
      "y cerrá con 3 o 4 líneas de lectura: qué se movió y qué significa para alguien con ahorros en pesos. " +
      "No des recomendaciones de inversión.",
    "",
    ESTILO,
  ].join("\n");
}

export function textoAnalisisCrediticio(cuit: string): string {
  return [
    `Hacé un análisis crediticio del CUIT/CUIL ${cuit} con datos públicos del BCRA.`,
    "1. Llamá a `consultar_deudor` con historico=true para ver los últimos 24 meses.",
    "2. Resumí: denominación, cantidad de entidades, monto total del último período y la peor situación (1 a 6).",
    "3. Mostrá la evolución: si la situación mejoró, empeoró o se mantuvo, y desde cuándo hay atrasos si los hay.",
    "4. Indicá si tiene cheques rechazados.",
    "5. Cerrá con una calificación orientativa (bajo / medio / alto riesgo) y explicá en qué te basás.",
    "",
    "Aclaraciones obligatorias: los montos se muestran tal como los informa el BCRA (la unidad no está documentada públicamente, " +
      "no afirmes que son miles de pesos), y esto es información pública orientativa, no un informe de riesgo profesional.",
    "",
    ESTILO,
  ].join("\n");
}

export function textoPlazoFijoVsInflacion(monto: number, dias: number): string {
  const montoTxt = monto.toLocaleString("es-AR", { maximumFractionDigits: 2 });
  return [
    `Quiero saber si conviene un plazo fijo de $ ${montoTxt} a ${dias} días frente a la inflación.`,
    `1. Llamá a \`plazos_fijos\` con monto=${monto} y dias=${dias}: las 5 mejores opciones con interés ganado.`,
    "2. Llamá a `inflacion` para los últimos 6 meses: último dato mensual y promedio.",
    "3. Para la mejor opción calculá la tasa real mensual contra el último dato y contra el promedio de 6 meses: " +
      "(1 + TEM) / (1 + inflación mensual) − 1.",
    "4. Llamá a `cotizaciones_dolar` y mostrá cuántos dólares MEP compraría hoy el monto, y cuál tendría que ser el MEP " +
      "al vencimiento para empatar el plazo fijo (break-even).",
    "",
    "Formato: tabla comparativa de bancos, después la tasa real (positiva o negativa) y el break-even del dólar. " +
      "Aclará que la inflación futura es desconocida y que se usa la pasada como referencia. No es asesoramiento financiero.",
    "",
    ESTILO,
  ].join("\n");
}

export function textoPoderAdquisitivo(monto: number, desde: string): string {
  const montoTxt = monto.toLocaleString("es-AR", { maximumFractionDigits: 2 });
  return [
    `¿Cuánto valen hoy $ ${montoTxt} de ${desde}?`,
    `1. Llamá a \`ajustar_por_inflacion\` con monto=${monto} y desde=${desde}.`,
    `2. Llamá a \`inflacion\` desde ${desde} para mostrar la inflación acumulada y los meses de mayor suba.`,
    "3. Si el período lo permite, compará contra el dólar: usá `cotizacion_bcra` (USD) en la fecha de origen y hoy " +
      "para mostrar cuántos dólares oficiales representaba el monto entonces y ahora.",
    "",
    "Formato: el monto actualizado bien visible, la inflación acumulada y una frase que explique la pérdida de poder adquisitivo.",
    "",
    ESTILO,
  ].join("\n");
}

// ---------- registro ----------

const cuitArg = z
  .string()
  .describe("CUIT/CUIL, con o sin guiones (ej. 30-54668997-9).")
  .refine((s) => esCuitValido(normalizarCuit(s)), "CUIT/CUIL inválido (dígito verificador o formato).");

const montoArg = z
  .string()
  .describe("Monto en pesos (ej. 1000000 o 1.000.000).")
  .refine((s) => parsearMonto(s) !== null, "Monto inválido: usá un número positivo, por ejemplo 1000000.");

export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    "informe_economico_del_dia",
    {
      title: "Informe económico del día",
      description: "Dólar y brechas, riesgo país, inflación, mejor plazo fijo y próximo feriado, en un solo informe.",
    },
    () => usuario(textoInformeDelDia()),
  );

  server.registerPrompt(
    "analisis_crediticio",
    {
      title: "Análisis crediticio de un CUIT",
      description: "Situación en la Central de Deudores del BCRA en los últimos 24 meses, cheques rechazados y una calificación orientativa.",
      argsSchema: { cuit: cuitArg },
    },
    ({ cuit }) => usuario(textoAnalisisCrediticio(formatearCuit(normalizarCuit(cuit)))),
  );

  server.registerPrompt(
    "plazo_fijo_vs_inflacion",
    {
      title: "Plazo fijo vs. inflación",
      description: "Compara los mejores plazos fijos contra la inflación reciente y calcula el dólar de equilibrio.",
      argsSchema: {
        monto: montoArg,
        dias: z
          .string()
          .regex(/^\d+$/, "Días: un número entero entre 30 y 1095.")
          .refine((s) => Number(s) >= 30 && Number(s) <= 1095, "Días: entre 30 y 1095.")
          .optional()
          .describe("Plazo en días (30 a 1095). Por defecto 30."),
      },
    },
    ({ monto, dias }) => usuario(textoPlazoFijoVsInflacion(parsearMonto(monto)!, dias ? Number(dias) : 30)),
  );

  server.registerPrompt(
    "poder_adquisitivo",
    {
      title: "Poder adquisitivo de un monto",
      description: "Actualiza un monto de un mes pasado por inflación y lo compara contra el dólar.",
      argsSchema: {
        monto: montoArg,
        desde: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mes en formato YYYY-MM.").describe("Mes del monto original (YYYY-MM)."),
      },
    },
    ({ monto, desde }) => usuario(textoPoderAdquisitivo(parsearMonto(monto)!, desde)),
  );
}
