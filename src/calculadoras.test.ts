import { describe, expect, it } from "vitest";
import {
  calcularAguinaldo,
  compararCuotasContado,
  cuotaFrancesa,
  promedioUltimos,
  saldoFrances,
  simularCreditoUva,
  tasaImplicita,
  valorPresente,
} from "./calculadoras.js";

describe("aguinaldo", () => {
  it("semestre completo: la mitad del mejor sueldo", () => {
    const r = calcularAguinaldo({ mejorSueldo: 1_000_000, anio: 2026, semestre: 2 });
    expect(r.aguinaldoBruto).toBe(500_000);
    expect(r.proporcional).toBe(false);
    expect(r.diasSemestre).toBe(184);
    expect(r.aportesEstimados).toBe(85_000);
    expect(r.aguinaldoNetoEstimado).toBe(415_000);
    expect(r.vencimiento).toBe("2026-12-18");
  });

  it("proporcional por ingreso a mitad del semestre", () => {
    // 1/10 al 31/12 = 92 de 184 días
    const r = calcularAguinaldo({ mejorSueldo: 1_000_000, anio: 2026, semestre: 2, fechaIngreso: "2026-10-01" });
    expect(r.diasTrabajados).toBe(92);
    expect(r.aguinaldoBruto).toBe(250_000);
    expect(r.proporcional).toBe(true);
  });

  it("proporcional por egreso, y año bisiesto en el primer semestre", () => {
    const r = calcularAguinaldo({ mejorSueldo: 910_000, anio: 2024, semestre: 1, fechaEgreso: "2024-03-31" });
    expect(r.diasSemestre).toBe(182);
    expect(r.diasTrabajados).toBe(91);
    expect(r.aguinaldoBruto).toBe(227_500);
    expect(r.vencimiento).toBe("2024-06-30");
  });

  it("una fecha de ingreso anterior al semestre no cambia nada", () => {
    const r = calcularAguinaldo({ mejorSueldo: 800_000, anio: 2026, semestre: 1, fechaIngreso: "2020-05-10" });
    expect(r.aguinaldoBruto).toBe(400_000);
  });

  it("rechaza fechas fuera del semestre", () => {
    expect(() => calcularAguinaldo({ mejorSueldo: 1, anio: 2026, semestre: 1, fechaIngreso: "2026-08-01" })).toThrow(/posterior/);
    expect(() => calcularAguinaldo({ mejorSueldo: 1, anio: 2026, semestre: 2, fechaEgreso: "2026-03-01" })).toThrow(/anterior/);
  });
});

describe("valor presente y tasa implícita", () => {
  it("con tasa 0 el valor presente es la suma", () => {
    expect(valorPresente(100, 12, 0)).toBeCloseTo(1200);
  });

  it("descuenta desde el mes 1, o desde hoy si la primera cuota es inmediata", () => {
    expect(valorPresente(102, 1, 0.02)).toBeCloseTo(100);
    expect(valorPresente(102, 1, 0.02, true)).toBeCloseTo(102);
  });

  it("encuentra la tasa que iguala cuotas y contado", () => {
    const cuota = cuotaFrancesa(100_000, 0.03, 6);
    expect(tasaImplicita(100_000, cuota, 6)).toBeCloseTo(0.03, 6);
  });

  it("cuotas sin interés: tasa implícita 0", () => {
    expect(tasaImplicita(120_000, 10_000, 12)).toBeCloseTo(0, 6);
  });
});

describe("cuotas vs. contado", () => {
  it("12 cuotas sin interés con 2% de inflación mensual: conviene cuotas", () => {
    const r = compararCuotasContado({ precioContado: 120_000, cantidadCuotas: 12, montoCuota: 10_000, tasaDescuentoMensualPct: 2 });
    expect(r.valorPresenteCuotas).toBeCloseTo(105_753.4, 0);
    expect(r.conviene).toBe("cuotas");
    expect(r.recargoNominalPct).toBe(0);
    expect(r.tasaImplicitaMensualPct).toBeCloseTo(0, 3);
    expect(Object.is(r.tasaImplicitaMensualPct, -0)).toBe(false);
  });

  it("recargo mayor a la inflación: conviene contado", () => {
    // 6 cuotas que esconden un 5% mensual contra 2% de inflación
    const cuota = cuotaFrancesa(100_000, 0.05, 6);
    const r = compararCuotasContado({ precioContado: 100_000, cantidadCuotas: 6, montoCuota: cuota, tasaDescuentoMensualPct: 2 });
    expect(r.conviene).toBe("contado");
    expect(r.tasaImplicitaMensualPct).toBeCloseTo(5, 3);
    expect(r.tasaImplicitaAnualPct).toBeCloseTo(79.59, 1);
  });

  it("recargo igual a la inflación: indistinto", () => {
    const cuota = cuotaFrancesa(100_000, 0.02, 6);
    const r = compararCuotasContado({ precioContado: 100_000, cantidadCuotas: 6, montoCuota: cuota, tasaDescuentoMensualPct: 2 });
    expect(r.conviene).toBe("indistinto");
  });

  it("valida las entradas", () => {
    expect(() => compararCuotasContado({ precioContado: 0, cantidadCuotas: 3, montoCuota: 1, tasaDescuentoMensualPct: 2 })).toThrow();
    expect(() => compararCuotasContado({ precioContado: 10, cantidadCuotas: 1.5, montoCuota: 1, tasaDescuentoMensualPct: 2 })).toThrow();
  });
});

describe("sistema francés", () => {
  it("cuota conocida: $100.000 al 1% mensual en 12 cuotas", () => {
    expect(cuotaFrancesa(100_000, 0.01, 12)).toBeCloseTo(8884.88, 2);
  });

  it("el saldo arranca en el capital y termina en cero", () => {
    expect(saldoFrances(100_000, 0.01, 12, 0)).toBeCloseTo(100_000);
    expect(saldoFrances(100_000, 0.01, 12, 12)).toBe(0);
    expect(saldoFrances(100_000, 0.01, 12, 6)).toBeGreaterThan(50_000); // en el francés se amortiza menos al principio
  });

  it("tasa cero: amortización lineal", () => {
    expect(cuotaFrancesa(1200, 0, 12)).toBe(100);
    expect(saldoFrances(1200, 0, 12, 3)).toBe(900);
  });
});

describe("crédito UVA", () => {
  const base = { montoPesos: 50_000_000, plazoMeses: 240, tnaPct: 4.5, valorUva: 2000, inflacionMensualPct: 2 };

  it("convierte a UVAs y calcula la cuota inicial", () => {
    const r = simularCreditoUva(base);
    expect(r.capitalUva).toBe(25_000);
    expect(r.cuotaUva).toBeCloseTo(cuotaFrancesa(25_000, 0.045 / 12, 240), 3);
    expect(r.cuotaInicialPesos).toBeCloseTo(r.cuotaUva * 2000, 0);
    expect(r.interesesUva).toBeCloseTo(r.totalUva - 25_000, 1);
  });

  it("ingreso mínimo con relación cuota/ingreso del 25%", () => {
    const r = simularCreditoUva({ ...base, ingresoMensual: 2_000_000 });
    expect(r.ingresoMinimo).toBeCloseTo(r.cuotaInicialPesos * 4, 1);
    expect(r.relacionCuotaIngresoPct).toBeCloseTo((r.cuotaInicialPesos / 2_000_000) * 100, 1);
    expect(r.calificaPorIngreso).toBe(r.relacionCuotaIngresoPct! <= 25);
  });

  it("proyecta la cuota en pesos con la inflación supuesta", () => {
    const r = simularCreditoUva(base);
    expect(r.proyeccion.map((p) => p.mes)).toEqual([1, 12, 24, 60, 120, 180, 240]);
    const m12 = r.proyeccion.find((p) => p.mes === 12)!;
    expect(m12.valorUva).toBeCloseTo(2000 * 1.02 ** 12, 1);
    expect(r.proyeccion.at(-1)!.saldoUva).toBe(0);
  });

  it("plazos cortos incluyen el último mes", () => {
    const r = simularCreditoUva({ ...base, plazoMeses: 18 });
    expect(r.proyeccion.map((p) => p.mes)).toEqual([1, 12, 18]);
  });
});

describe("promedioUltimos", () => {
  it("promedia los últimos n", () => {
    expect(promedioUltimos([10, 1, 2, 3], 3)).toBe(2);
    expect(() => promedioUltimos([], 3)).toThrow();
  });
});
