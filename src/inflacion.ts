/** Cálculos sobre la serie de inflación mensual (IPC INDEC, % mensual). */

export type PuntoInflacion = { fecha: string; valor: number };

/** "2025-03-31" -> "2025-03" */
export const mes = (fecha: string) => fecha.slice(0, 7);

export function filtrarPorMes(serie: PuntoInflacion[], desde?: string, hasta?: string) {
  return serie.filter((p) => (!desde || mes(p.fecha) >= desde) && (!hasta || mes(p.fecha) <= hasta));
}

/** Inflación acumulada (%) componiendo las tasas mensuales. */
export function acumulada(puntos: PuntoInflacion[]): number {
  const factor = puntos.reduce((f, p) => f * (1 + p.valor / 100), 1);
  return (factor - 1) * 100;
}

export type ResultadoAjuste = {
  montoOriginal: number;
  montoAjustado: number;
  inflacionAcumuladaPct: number;
  mesesConsiderados: number;
  primerMes: string | null;
  ultimoMes: string | null;
  advertencia?: string;
};

/**
 * Lleva un monto expresado en pesos de `desde` (YYYY-MM) a pesos de `hasta` (YYYY-MM).
 * Se componen las inflaciones de los meses posteriores a `desde` hasta `hasta` inclusive:
 * un precio de enero llevado a marzo se multiplica por la inflación de febrero y de marzo.
 */
export function ajustarMonto(
  serie: PuntoInflacion[],
  monto: number,
  desde: string,
  hasta: string,
): ResultadoAjuste {
  if (hasta < desde) {
    const inverso = ajustarMonto(serie, 1, hasta, desde);
    const factor = 1 / (1 + inverso.inflacionAcumuladaPct / 100);
    return {
      ...inverso,
      montoOriginal: monto,
      montoAjustado: monto * factor,
      inflacionAcumuladaPct: (factor - 1) * 100,
    };
  }

  const puntos = serie.filter((p) => mes(p.fecha) > desde && mes(p.fecha) <= hasta);
  const ultimoDisponible = serie.length ? mes(serie[serie.length - 1].fecha) : null;
  const pct = acumulada(puntos);

  const res: ResultadoAjuste = {
    montoOriginal: monto,
    montoAjustado: monto * (1 + pct / 100),
    inflacionAcumuladaPct: pct,
    mesesConsiderados: puntos.length,
    primerMes: puntos.length ? mes(puntos[0].fecha) : null,
    ultimoMes: puntos.length ? mes(puntos[puntos.length - 1].fecha) : null,
  };
  if (ultimoDisponible && hasta > ultimoDisponible) {
    res.advertencia = `El último dato publicado es ${ultimoDisponible}; los meses posteriores no están incluidos.`;
  }
  return res;
}
