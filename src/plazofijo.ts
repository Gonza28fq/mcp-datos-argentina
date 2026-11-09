/** Lógica de tasas de plazo fijo (datos de argentinadatos.com, originados en el BCRA y las entidades). */

export type TramoTasa = {
  montoMinimo: number | null;
  montoMaximo: number | null;
  plazoMinDias: number | null;
  plazoMaxDias: number | null;
  tna: number; // fracción: 0.2 = 20%
};

export type BancoPlazoFijo = {
  entidad: string;
  tnaClientes: number | null; // TNA a 30 días, fracción
  tnaNoClientes: number | null; // 0 o null = no ofrece a no clientes
  enlace?: string | null;
  tasas?: TramoTasa[];
};

export type Consulta = { dias: number; monto?: number; cliente: boolean };

export type TasaElegida = { tna: number; origen: "tramo" | "tna_30_dias" };

/** Las TNA de referencia que publica el BCRA son a 30 días; aceptamos hasta 35 como "30 días". */
const ES_PLAZO_BASE = (dias: number) => dias >= 30 && dias <= 35;

const tramoAplica = (t: TramoTasa, { dias, monto }: Consulta) =>
  (t.plazoMinDias ?? 0) <= dias &&
  dias <= (t.plazoMaxDias ?? Infinity) &&
  (monto === undefined || ((t.montoMinimo ?? 0) <= monto && monto <= (t.montoMaximo ?? Infinity)));

/**
 * Elige la tasa que el banco pagaría para ese plazo/monto.
 * - Si hay tramos publicados que aplican, toma el de mayor TNA (los tramos son para clientes).
 * - Si no, y el plazo es ~30 días, usa la TNA de referencia (clientes o no clientes).
 * - Si no, el banco no publica tasa para ese plazo → null.
 */
export function tasaPara(b: BancoPlazoFijo, c: Consulta): TasaElegida | null {
  if (c.cliente) {
    const tramos = (b.tasas ?? []).filter((t) => tramoAplica(t, c) && t.tna > 0);
    if (tramos.length) return { tna: Math.max(...tramos.map((t) => t.tna)), origen: "tramo" };
  }
  if (ES_PLAZO_BASE(c.dias)) {
    const tna = c.cliente ? b.tnaClientes : b.tnaNoClientes;
    if (tna && tna > 0) return { tna, origen: "tna_30_dias" };
  }
  return null;
}

/** Interés simple del plazo fijo y tasa efectiva anual equivalente (renovando al mismo plazo). */
export function rendimiento(tna: number, dias: number, monto?: number) {
  const tasaPeriodo = (tna * dias) / 365;
  const tea = Math.pow(1 + tasaPeriodo, 365 / dias) - 1;
  const efectivaMensual = Math.pow(1 + tea, 1 / 12) - 1;
  return {
    tnaPct: tna * 100,
    teaPct: tea * 100,
    efectivaMensualPct: efectivaMensual * 100,
    ...(monto !== undefined && {
      interes: monto * tasaPeriodo,
      montoFinal: monto * (1 + tasaPeriodo),
    }),
  };
}

/** Tasa real mensual: cuánto gana (o pierde) contra la inflación mensual. */
export const tasaRealMensualPct = (efectivaMensualPct: number, inflacionMensualPct: number) =>
  ((1 + efectivaMensualPct / 100) / (1 + inflacionMensualPct / 100) - 1) * 100;
