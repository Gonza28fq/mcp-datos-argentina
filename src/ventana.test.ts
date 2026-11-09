import { describe, expect, it } from "vitest";
import { esPorcentual, inicioVentana } from "./ventana.js";

describe("inicioVentana", () => {
  it("modo valor no retrocede", () => {
    expect(inicioVentana("2026-06-01", "month", "value")).toBe("2026-06-01");
  });

  it("variación mensual retrocede dos meses de margen", () => {
    expect(inicioVentana("2026-06-01", "month", "percent_change")).toBe("2026-04-01");
  });

  it("interanual mensual retrocede un año más el margen", () => {
    expect(inicioVentana("2026-06-01", "month", "percent_change_a_year_ago")).toBe("2025-04-01");
  });

  it("interanual trimestral", () => {
    expect(inicioVentana("2026-07-01", "quarter", "change_a_year_ago")).toBe("2025-01-01");
  });

  it("diaria usa días de margen", () => {
    expect(inicioVentana("2026-11-05", "day", "percent_change")).toBe("2026-10-22");
  });

  it("detecta transformaciones porcentuales", () => {
    expect(esPorcentual("percent_change_a_year_ago")).toBe(true);
    expect(esPorcentual("change")).toBe(false);
  });
});
