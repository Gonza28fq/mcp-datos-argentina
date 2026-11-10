import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parsearMonto, registerPrompts } from "./prompts.js";

async function conectar() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerPrompts(server);
  const client = new Client({ name: "test", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const texto = (r: { messages: { content: { type: string; text?: string } }[] }) => r.messages[0].content.text ?? "";

describe("parsearMonto", () => {
  it.each([
    ["1000000", 1_000_000],
    ["1.000.000", 1_000_000],
    ["$ 1.500.000,50", 1_500_000.5],
    ["2500,75", 2500.75],
    ["1.5", 1.5],
  ])("%s → %d", (entrada, esperado) => expect(parsearMonto(entrada)).toBe(esperado));

  it.each(["", "abc", "-5", "0"])("rechaza %j", (entrada) => expect(parsearMonto(entrada)).toBeNull());
});

describe("prompts MCP", () => {
  it("lista los 4 prompts con sus argumentos", async () => {
    const client = await conectar();
    const { prompts } = await client.listPrompts();
    const porNombre = Object.fromEntries(prompts.map((p) => [p.name, p]));
    expect(Object.keys(porNombre).sort()).toEqual(
      ["analisis_crediticio", "informe_economico_del_dia", "plazo_fijo_vs_inflacion", "poder_adquisitivo"],
    );
    expect(porNombre.analisis_crediticio.arguments).toEqual([expect.objectContaining({ name: "cuit", required: true })]);
    expect(porNombre.plazo_fijo_vs_inflacion.arguments?.find((a) => a.name === "dias")?.required).toBe(false);
  });

  it("el informe del día menciona todas las tools que usa", async () => {
    const client = await conectar();
    const t = texto(await client.getPrompt({ name: "informe_economico_del_dia" }));
    for (const tool of ["cotizaciones_dolar", "riesgo_pais", "inflacion", "plazos_fijos", "feriados"]) expect(t).toContain(tool);
  });

  it("formatea el CUIT y advierte sobre la unidad de los montos", async () => {
    const client = await conectar();
    const t = texto(await client.getPrompt({ name: "analisis_crediticio", arguments: { cuit: "30546689979" } }));
    expect(t).toContain("30-54668997-9");
    expect(t).toContain("historico=true");
    expect(t).toMatch(/no afirmes que son miles de pesos/);
  });

  it("rechaza un CUIT con dígito verificador inválido", async () => {
    const client = await conectar();
    await expect(client.getPrompt({ name: "analisis_crediticio", arguments: { cuit: "30-54668997-0" } })).rejects.toThrow(/inválido/);
  });

  it("plazo fijo: parsea el monto y usa 30 días por defecto", async () => {
    const client = await conectar();
    const t = texto(await client.getPrompt({ name: "plazo_fijo_vs_inflacion", arguments: { monto: "1.000.000" } }));
    expect(t).toContain("monto=1000000 y dias=30");
    expect(t).toContain("$ 1.000.000");
  });

  it("plazo fijo: rechaza plazos fuera de rango", async () => {
    const client = await conectar();
    await expect(
      client.getPrompt({ name: "plazo_fijo_vs_inflacion", arguments: { monto: "1000", dias: "10" } }),
    ).rejects.toThrow(/30 y 1095/);
  });

  it("poder adquisitivo: valida el mes", async () => {
    const client = await conectar();
    const t = texto(await client.getPrompt({ name: "poder_adquisitivo", arguments: { monto: "100000", desde: "2023-01" } }));
    expect(t).toContain("desde=2023-01");
    await expect(client.getPrompt({ name: "poder_adquisitivo", arguments: { monto: "100000", desde: "2023-13" } })).rejects.toThrow();
  });
});
