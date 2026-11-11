/**
 * Calculadoras financieras: lógica pura, sin red, para poder testearla a fondo.
 * Las tools (calculadoras-tools.ts) solo buscan los datos de mercado y llaman a estas funciones.
 */

const DIA_MS = 86_400_000;
// "+ 0" convierte -0 en 0, para no mostrar "-0%".
const r2 = (n: number) => Math.round(n * 100) / 100 + 0;
const r4 = (n: number) => Math.round(n * 10_000) / 10_000 + 0;

// ---------- Aguinaldo (SAC) ----------

export type EntradaAguinaldo = {
  mejorSueldo: number;
  anio: number;
  semestre: 1 | 2;
  /** YYYY-MM-DD. Si ingresó durante el semestre, el aguinaldo es proporcional. */
  fechaIngreso?: string;
  /** YYYY-MM-DD. Si dejó de trabajar durante el semestre (aguinaldo proporcional por egreso). */
  fechaEgreso?: string;
};

export type ResultadoAguinaldo = {
  semestre: string;
  periodo: { desde: string; hasta: string };
  diasSemestre: number;
  diasTrabajados: number;
  proporcional: boolean;
  aguinaldoBruto: number;
  aportesEstimados: number;
  aguinaldoNetoEstimado: number;
  vencimiento: string;
};

/** Aportes del empleado en relación de dependencia: jubilación 11% + PAMI 3% + obra social 3%. */
export const APORTES_EMPLEADO_PCT = 17;

const diasEntre = (desde: string, hasta: string) => Math.round((Date.parse(hasta) - Date.parse(desde)) / DIA_MS) + 1;

/**
 * SAC (Ley 23.041): 50% de la mayor remuneración mensual del semestre.
 * Si no trabajó el semestre completo: (mejor sueldo / 2) × días trabajados / días del semestre.
 */
export function calcularAguinaldo(e: EntradaAguinaldo): ResultadoAguinaldo {
  if (!(e.mejorSueldo > 0)) throw new Error("El mejor sueldo tiene que ser mayor que cero.");
  const desde = e.semestre === 1 ? `${e.anio}-01-01` : `${e.anio}-07-01`;
  const hasta = e.semestre === 1 ? `${e.anio}-06-30` : `${e.anio}-12-31`;
  const inicio = e.fechaIngreso && e.fechaIngreso > desde ? e.fechaIngreso : desde;
  const fin = e.fechaEgreso && e.fechaEgreso < hasta ? e.fechaEgreso : hasta;
  if (inicio > hasta) throw new Error(`La fecha de ingreso (${e.fechaIngreso}) es posterior al semestre.`);
  if (fin < desde) throw new Error(`La fecha de egreso (${e.fechaEgreso}) es anterior al semestre.`);
  if (fin < inicio) throw new Error("La fecha de egreso es anterior a la de ingreso.");

  const diasSemestre = diasEntre(desde, hasta);
  const diasTrabajados = diasEntre(inicio, fin);
  const bruto = (e.mejorSueldo / 2) * (diasTrabajados / diasSemestre);
  const aportes = bruto * (APORTES_EMPLEADO_PCT / 100);
  return {
    semestre: `${e.semestre === 1 ? "primer" : "segundo"} semestre ${e.anio}`,
    periodo: { desde: inicio, hasta: fin },
    diasSemestre,
    diasTrabajados,
    proporcional: diasTrabajados < diasSemestre,
    aguinaldoBruto: r2(bruto),
    aportesEstimados: r2(aportes),
    aguinaldoNetoEstimado: r2(bruto - aportes),
    vencimiento: e.semestre === 1 ? `${e.anio}-06-30` : `${e.anio}-12-18`,
  };
}

// ---------- Cuotas vs. contado ----------

export type EntradaCuotas = {
  precioContado: number;
  cantidadCuotas: number;
  montoCuota: number;
  /** Tasa con la que se descuentan las cuotas futuras (normalmente la inflación mensual esperada), en %. */
  tasaDescuentoMensualPct: number;
  /** true si la primera cuota se paga hoy; false (por defecto) si se paga dentro de un mes. */
  primeraCuotaHoy?: boolean;
};

export type ResultadoCuotas = {
  totalEnCuotas: number;
  recargoNominalPct: number;
  valorPresenteCuotas: number;
  diferenciaVsContado: number;
  conviene: "cuotas" | "contado" | "indistinto";
  tasaImplicitaMensualPct: number;
  tasaImplicitaAnualPct: number;
  tasaDescuentoMensualPct: number;
};

/** Valor presente de n pagos iguales descontados a la tasa mensual i (fracción). */
export function valorPresente(cuota: number, n: number, i: number, primeraHoy = false): number {
  let vp = 0;
  for (let k = 0; k < n; k++) vp += cuota / (1 + i) ** (primeraHoy ? k : k + 1);
  return vp;
}

/** Tasa mensual r tal que el valor presente de las cuotas iguala al precio de contado (bisección). */
export function tasaImplicita(precio: number, cuota: number, n: number, primeraHoy = false): number {
  let lo = -0.99;
  let hi = 10;
  // valorPresente es decreciente en r: si en lo es menor al precio, no hay solución en el rango.
  if (valorPresente(cuota, n, lo, primeraHoy) < precio || valorPresente(cuota, n, hi, primeraHoy) > precio) return NaN;
  for (let iter = 0; iter < 200; iter++) {
    const mid = (lo + hi) / 2;
    if (valorPresente(cuota, n, mid, primeraHoy) > precio) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function compararCuotasContado(e: EntradaCuotas): ResultadoCuotas {
  if (!(e.precioContado > 0) || !(e.montoCuota > 0)) throw new Error("Precio y cuota tienen que ser mayores que cero.");
  if (!Number.isInteger(e.cantidadCuotas) || e.cantidadCuotas < 1) throw new Error("La cantidad de cuotas tiene que ser un entero ≥ 1.");
  const i = e.tasaDescuentoMensualPct / 100;
  const primeraHoy = e.primeraCuotaHoy ?? false;
  const total = e.montoCuota * e.cantidadCuotas;
  const vp = valorPresente(e.montoCuota, e.cantidadCuotas, i, primeraHoy);
  const dif = vp - e.precioContado;
  const r = tasaImplicita(e.precioContado, e.montoCuota, e.cantidadCuotas, primeraHoy);
  // Menos de 0,5% del precio de diferencia se considera indistinto.
  const umbral = e.precioContado * 0.005;
  return {
    totalEnCuotas: r2(total),
    recargoNominalPct: r2((total / e.precioContado - 1) * 100),
    valorPresenteCuotas: r2(vp),
    diferenciaVsContado: r2(dif),
    conviene: Math.abs(dif) <= umbral ? "indistinto" : dif < 0 ? "cuotas" : "contado",
    tasaImplicitaMensualPct: r4(r * 100),
    tasaImplicitaAnualPct: r2(((1 + r) ** 12 - 1) * 100),
    tasaDescuentoMensualPct: e.tasaDescuentoMensualPct,
  };
}

// ---------- Crédito UVA (sistema francés en UVAs) ----------

export type EntradaCreditoUva = {
  montoPesos: number;
  plazoMeses: number;
  tnaPct: number;
  valorUva: number;
  /** Inflación mensual supuesta para proyectar la UVA, en %. */
  inflacionMensualPct: number;
  ingresoMensual?: number;
  /** Relación cuota/ingreso máxima que suelen exigir los bancos, en %. */
  relacionCuotaIngresoMaxPct?: number;
};

export type FilaProyeccion = { mes: number; valorUva: number; cuotaPesos: number; saldoUva: number; saldoPesos: number };

export type ResultadoCreditoUva = {
  capitalUva: number;
  cuotaUva: number;
  cuotaInicialPesos: number;
  totalUva: number;
  interesesUva: number;
  ingresoMinimo: number;
  relacionCuotaIngresoPct: number | null;
  calificaPorIngreso: boolean | null;
  proyeccion: FilaProyeccion[];
};

/** Cuota del sistema francés para un capital, tasa mensual i (fracción) y n cuotas. */
export function cuotaFrancesa(capital: number, i: number, n: number): number {
  return i === 0 ? capital / n : (capital * i) / (1 - (1 + i) ** -n);
}

/** Saldo de capital después de pagar k cuotas del sistema francés. */
export function saldoFrances(capital: number, i: number, n: number, k: number): number {
  if (k >= n) return 0;
  if (i === 0) return capital * (1 - k / n);
  const c = cuotaFrancesa(capital, i, n);
  return capital * (1 + i) ** k - c * (((1 + i) ** k - 1) / i);
}

export function simularCreditoUva(e: EntradaCreditoUva): ResultadoCreditoUva {
  if (!(e.montoPesos > 0) || !(e.valorUva > 0)) throw new Error("Monto y valor UVA tienen que ser mayores que cero.");
  if (!Number.isInteger(e.plazoMeses) || e.plazoMeses < 1) throw new Error("El plazo tiene que ser un entero de meses ≥ 1.");
  const i = e.tnaPct / 100 / 12;
  const n = e.plazoMeses;
  const capitalUva = e.montoPesos / e.valorUva;
  const cuotaUva = cuotaFrancesa(capitalUva, i, n);
  const cuotaInicial = cuotaUva * e.valorUva;
  const relMax = e.relacionCuotaIngresoMaxPct ?? 25;
  const relacion = e.ingresoMensual ? (cuotaInicial / e.ingresoMensual) * 100 : null;

  const infl = e.inflacionMensualPct / 100;
  const meses = [...new Set([1, 12, 24, 60, 120, 180, 240, 360].filter((m) => m <= n).concat(n))].sort((a, b) => a - b);
  const proyeccion = meses.map((m) => {
    const uva = e.valorUva * (1 + infl) ** m;
    const saldo = saldoFrances(capitalUva, i, n, m);
    return { mes: m, valorUva: r2(uva), cuotaPesos: r2(cuotaUva * uva), saldoUva: r2(saldo), saldoPesos: r2(saldo * uva) };
  });

  return {
    capitalUva: r2(capitalUva),
    cuotaUva: r4(cuotaUva),
    cuotaInicialPesos: r2(cuotaInicial),
    totalUva: r2(cuotaUva * n),
    interesesUva: r2(cuotaUva * n - capitalUva),
    ingresoMinimo: r2(cuotaInicial / (relMax / 100)),
    relacionCuotaIngresoPct: relacion === null ? null : r2(relacion),
    calificaPorIngreso: relacion === null ? null : relacion <= relMax,
    proyeccion,
  };
}

/** Promedio simple de los últimos n valores (para estimar la inflación mensual esperada). */
export function promedioUltimos(valores: number[], n: number): number {
  const ult = valores.slice(-n);
  if (!ult.length) throw new Error("No hay datos para promediar.");
  return ult.reduce((a, b) => a + b, 0) / ult.length;
}
