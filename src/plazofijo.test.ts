import { describe, expect, it } from "vitest";
import { rendimiento, tasaPara, tasaRealMensualPct, type BancoPlazoFijo } from "./plazofijo.js";

const nacion: BancoPlazoFijo = {
  entidad: "Nación",
  tnaClientes: 0.1925,
  tnaNoClientes: 0,
  tasas: [
    { montoMinimo: null, montoMaximo: null, plazoMinDias: 60, plazoMaxDias: 60, tna: 0.2 },
    { montoMinimo: null, montoMaximo: null, plazoMinDias: 365, plazoMaxDias: 365, tna: 0.23 },
  ],
};

const macro: BancoPlazoFijo = {
  entidad: "Macro",
  tnaClientes: 0.195,
  tnaNoClientes: 0,
  tasas: [
    { montoMinimo: 1, montoMaximo: null, plazoMinDias: 30, plazoMaxDias: 35, tna: 0.195 },
    { montoMinimo: 5_000_000, montoMaximo: null, plazoMinDias: 30, plazoMaxDias: 35, tna: 0.2 },
  ],
};

const voii: BancoPlazoFijo = {
  entidad: "VOII",
  tnaClientes: 0.23,
  tnaNoClientes: 0.23,
  tasas: [{ montoMinimo: null, montoMaximo: null, plazoMinDias: 180, plazoMaxDias: null, tna: 0.2425 }],
};

describe("tasaPara", () => {
  it("usa la TNA de referencia a 30 días", () => {
    expect(tasaPara(nacion, { dias: 30, cliente: true })).toEqual({ tna: 0.1925, origen: "tna_30_dias" });
  });

  it("tnaNoClientes = 0 significa que no ofrece a no clientes", () => {
    expect(tasaPara(nacion, { dias: 30, cliente: false })).toBeNull();
  });

  it("usa el tramo exacto para otros plazos", () => {
    expect(tasaPara(nacion, { dias: 60, cliente: true })?.tna).toBe(0.2);
  });

  it("sin tramo para ese plazo → null", () => {
    expect(tasaPara(nacion, { dias: 45, cliente: true })).toBeNull();
  });

  it("respeta el monto mínimo de cada tramo", () => {
    expect(tasaPara(macro, { dias: 30, monto: 100_000, cliente: true })?.tna).toBe(0.195);
    expect(tasaPara(macro, { dias: 30, monto: 10_000_000, cliente: true })?.tna).toBe(0.2);
  });

  it("tramo sin plazo máximo cubre plazos largos", () => {
    expect(tasaPara(voii, { dias: 400, cliente: true })?.tna).toBe(0.2425);
  });
});

describe("rendimiento", () => {
  it("calcula interés simple del período", () => {
    const r = rendimiento(0.365, 30, 100_000);
    expect(r.interes).toBeCloseTo(3000, 6);
    expect(r.montoFinal).toBeCloseTo(103_000, 6);
  });

  it("TEA mayor que TNA al capitalizar", () => {
    const r = rendimiento(0.2, 30);
    expect(r.teaPct).toBeGreaterThan(20);
    expect(r.teaPct).toBeCloseTo(21.94, 1);
  });

  it("tasa real negativa si la inflación supera al rendimiento", () => {
    expect(tasaRealMensualPct(1.5, 2)).toBeCloseTo(-0.49, 2);
  });
});
