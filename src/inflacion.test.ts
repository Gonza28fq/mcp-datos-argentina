import { describe, expect, it } from "vitest";
import { acumulada, ajustarMonto } from "./inflacion.js";

const serie = [
  { fecha: "2025-01-31", valor: 10 },
  { fecha: "2025-02-28", valor: 10 },
  { fecha: "2025-03-31", valor: 10 },
];

describe("inflación", () => {
  it("compone tasas mensuales", () => {
    expect(acumulada(serie)).toBeCloseTo(33.1, 5);
  });

  it("ajusta hacia adelante usando los meses posteriores al origen", () => {
    const r = ajustarMonto(serie, 100, "2025-01", "2025-03");
    expect(r.mesesConsiderados).toBe(2);
    expect(r.montoAjustado).toBeCloseTo(121, 5);
  });

  it("ajusta hacia atrás (inverso)", () => {
    const r = ajustarMonto(serie, 121, "2025-03", "2025-01");
    expect(r.montoAjustado).toBeCloseTo(100, 5);
  });

  it("mismo mes no cambia el monto", () => {
    expect(ajustarMonto(serie, 100, "2025-02", "2025-02").montoAjustado).toBe(100);
  });

  it("advierte si se pide un mes sin datos", () => {
    const r = ajustarMonto(serie, 100, "2025-01", "2025-06");
    expect(r.advertencia).toMatch(/2025-03/);
  });
});
