import { describe, expect, it } from "vitest";
import { resolverEntidad, type EntidadCheques } from "./cheques.js";

// Muestra real de GET /cheques/v1.0/entidades
const ENTIDADES: EntidadCheques[] = [
  { codigoEntidad: 11, denominacion: "BANCO DE LA NACION ARGENTINA" },
  { codigoEntidad: 7, denominacion: "BANCO DE GALICIA Y BUENOS AIRES S.A." },
  { codigoEntidad: 14, denominacion: "BANCO DE LA PROVINCIA DE BUENOS AIRES" },
  { codigoEntidad: 20, denominacion: "BANCO DE LA PROVINCIA DE CORDOBA S.A." },
  { codigoEntidad: 17, denominacion: "BANCO BBVA ARGENTINA S.A." },
  { codigoEntidad: 72, denominacion: "BANCO SANTANDER ARGENTINA S.A." },
  { codigoEntidad: 15, denominacion: "INDUSTRIAL AND COMMERCIAL BANK OF CHINA" },
  { codigoEntidad: 322, denominacion: "BANCO INDUSTRIAL" },
  { codigoEntidad: 34, denominacion: "BANCO PATAGONIA  S.A." },
];

const codigo = (q: string) => {
  const r = resolverEntidad(q, ENTIDADES);
  return Array.isArray(r) ? r.map((e) => e.codigoEntidad) : r.codigoEntidad;
};

describe("resolverEntidad", () => {
  it.each([
    ["11", 11],
    ["nacion", 11],
    ["Banco Nación", 11],
    ["galicia", 7],
    ["Santander", 72],
    ["patagonia", 34],
    ["provincia de buenos aires", 14],
    ["icbc", 15],
    ["Francés", 17],
    ["bapro", 14],
    ["industrial", 322], // coincidencia exacta gana sobre ICBC
  ])("%s → %d", (q, esperado) => expect(codigo(q)).toBe(esperado));

  it("devuelve candidatas si es ambiguo", () => {
    expect(codigo("provincia")).toEqual([14, 20]);
  });

  it("devuelve lista vacía si no existe", () => {
    expect(codigo("9999")).toEqual([]);
    expect(codigo("banco inventado")).toEqual([]);
  });
});
