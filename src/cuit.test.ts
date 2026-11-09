import { describe, expect, it } from "vitest";
import { esCuitValido, formatearCuit } from "./cuit.js";

describe("CUIT", () => {
  it("acepta CUITs válidos con y sin guiones", () => {
    expect(esCuitValido("30546689979")).toBe(true); // YPF
    expect(esCuitValido("30-54668997-9")).toBe(true);
    expect(esCuitValido("20-11111111-2")).toBe(true);
  });

  it("rechaza dígito verificador incorrecto", () => {
    expect(esCuitValido("30546689970")).toBe(false);
  });

  it("rechaza formato inválido", () => {
    expect(esCuitValido("123")).toBe(false);
    expect(esCuitValido("99546689979")).toBe(false);
    expect(esCuitValido("abcdefghijk")).toBe(false);
  });

  it("formatea", () => {
    expect(formatearCuit("30546689979")).toBe("30-54668997-9");
  });
});
