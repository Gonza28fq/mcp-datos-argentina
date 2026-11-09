/**
 * Workaround de un bug de la API de Series de Tiempo (datos.gob.ar):
 * al combinar `last`/`limit` con una transformación (percent_change, *_a_year_ago),
 * la ventana se corre hacia atrás y se pierden los períodos más recientes
 * (con percent_change_a_year_ago, ¡un año entero!). Con `start_date` funciona bien.
 *
 * Por eso, para "los últimos N con transformación" hacemos:
 *   1. pedir los últimos N en modo valor (eso sí funciona) → fecha del primero;
 *   2. retroceder lo necesario para que la API pueda calcular la transformación;
 *   3. pedir con start_date y quedarnos con los últimos N.
 */

export type Transformacion =
  | "value"
  | "change"
  | "percent_change"
  | "change_a_year_ago"
  | "percent_change_a_year_ago";

export type Frecuencia = "day" | "week" | "month" | "quarter" | "semester" | "year";

/** Cuántos meses (o días, para frecuencias diarias/semanales) retroceder para tener un período de margen. */
const UN_PERIODO: Record<Frecuencia, { meses?: number; dias?: number }> = {
  day: { dias: 7 }, // margen por fines de semana y feriados
  week: { dias: 14 },
  month: { meses: 1 },
  quarter: { meses: 3 },
  semester: { meses: 6 },
  year: { meses: 12 },
};

function restar(fecha: string, { meses = 0, dias = 0 }: { meses?: number; dias?: number }): string {
  const d = new Date(fecha + "T00:00:00Z");
  if (meses) d.setUTCMonth(d.getUTCMonth() - meses);
  if (dias) d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Fecha desde la cual pedir datos para que la transformación del período `primeraFecha`
 * pueda calcularse. Pide de más a propósito: el excedente se descarta al cortar los últimos N.
 */
export function inicioVentana(primeraFecha: string, frecuencia: Frecuencia, t: Transformacion): string {
  if (t === "value") return primeraFecha;
  const periodo = UN_PERIODO[frecuencia] ?? { meses: 12 };
  // Dos períodos de margen para variaciones contra el período anterior.
  const margen = { meses: (periodo.meses ?? 0) * 2, dias: (periodo.dias ?? 0) * 2 };
  if (t === "change" || t === "percent_change") return restar(primeraFecha, margen);
  // Interanual: un año más un margen.
  return restar(restar(primeraFecha, { meses: 12 }), margen);
}

/** Las transformaciones porcentuales vienen como fracción (0.021) → las pasamos a % (2.1). */
export const esPorcentual = (t: Transformacion) => t.startsWith("percent_");
