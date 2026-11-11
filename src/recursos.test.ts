import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { aniosFeriados, registerRecursos } from "./recursos.js";
import { registerTools } from "./tools.js";
import { registerGeoref } from "./georef.js";
import { registerSeries } from "./series.js";
import { registerMercado } from "./mercado.js";
import { registerCheques } from "./cheques.js";
import { registerCalculadoras } from "./calculadoras-tools.js";

async function conectar() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server);
  registerGeoref(server);
  registerSeries(server);
  registerMercado(server);
  registerCheques(server);
  registerCalculadoras(server);
  registerRecursos(server);
  const client = new Client({ name: "test", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("resources", () => {
  it("lista los recursos fijos y los feriados del año actual y el próximo", async () => {
    const client = await conectar();
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toEqual(
      expect.arrayContaining([
        "datos-argentina://bcra/situaciones",
        "datos-argentina://bcra/variables",
        "datos-argentina://bcra/entidades-cheques",
        "datos-argentina://georef/provincias",
      ]),
    );
    expect(uris.filter((u) => u.startsWith("datos-argentina://feriados/"))).toHaveLength(2);
  });

  it("publica la plantilla de feriados por año", async () => {
    const client = await conectar();
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate)).toContain("datos-argentina://feriados/{anio}");
  });

  it("lee las situaciones del BCRA sin red", async () => {
    const client = await conectar();
    const r = await client.readResource({ uri: "datos-argentina://bcra/situaciones" });
    const situaciones = JSON.parse(String(r.contents[0].text));
    expect(situaciones).toHaveLength(6);
    expect(situaciones[0]).toEqual({ situacion: 1, descripcion: "Normal" });
  });

  it("rechaza un año fuera de rango", async () => {
    const client = await conectar();
    await expect(client.readResource({ uri: "datos-argentina://feriados/1999" })).rejects.toThrow(/Año inválido/);
  });

  it("autocompleta el año", async () => {
    const client = await conectar();
    const r = await client.complete({
      ref: { type: "ref/resource", uri: "datos-argentina://feriados/{anio}" },
      argument: { name: "anio", value: "201" },
    });
    expect(r.completion.values).toEqual(["2019", "2018", "2017", "2016"]);
  });

  it("aniosFeriados va del año próximo hacia atrás hasta 2016", () => {
    expect(aniosFeriados(2018)).toEqual([2019, 2018, 2017, 2016]);
  });
});

describe("salida estructurada", () => {
  it("todas las tools declaran outputSchema de tipo objeto", async () => {
    const client = await conectar();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(20);
    for (const t of tools) {
      expect(t.outputSchema, t.name).toBeDefined();
      expect(t.outputSchema?.type, t.name).toBe("object");
    }
  });
});
