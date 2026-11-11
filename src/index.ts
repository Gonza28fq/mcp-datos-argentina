#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";
import { registerGeoref } from "./georef.js";
import { registerSeries } from "./series.js";
import { registerMercado } from "./mercado.js";
import { registerPrompts } from "./prompts.js";
import { registerCheques } from "./cheques.js";
import { registerCalculadoras } from "./calculadoras-tools.js";
import { registerRecursos } from "./recursos.js";
import { VERSION } from "./version.js";

const server = new McpServer(
  { name: "mcp-datos-argentina", version: VERSION },
  {
    instructions:
      "Datos públicos de Argentina en tiempo real: dólar (oficial, blue, MEP, CCL), riesgo país, plazos fijos por banco, cotizaciones y variables del BCRA, " +
      "Central de Deudores, cheques denunciados, inflación (IPC), feriados, normalización geográfica (Georef: direcciones, localidades, coordenadas) " +
      "y series de tiempo oficiales (INDEC y ministerios: salarios, EMAE, empleo, IPC por rubro, etc.), " +
      "y calculadoras (aguinaldo, cuotas vs. contado, crédito UVA). " +
      "Para variables del BCRA buscá el id con buscar_variables_bcra; para series oficiales, con buscar_series. " +
      "Hay prompts listos: informe_economico_del_dia, analisis_crediticio, plazo_fijo_vs_inflacion y poder_adquisitivo. " +
      "Resources: datos-argentina://bcra/variables, datos-argentina://bcra/situaciones, datos-argentina://bcra/entidades-cheques, datos-argentina://georef/provincias y datos-argentina://feriados/{anio}.",
  },
);

registerTools(server);
registerGeoref(server);
registerSeries(server);
registerMercado(server);
registerCheques(server);
registerCalculadoras(server);
registerPrompts(server);
registerRecursos(server);

const transport = new StdioServerTransport();
await server.connect(transport);
// stdout está reservado para el protocolo MCP: los logs van a stderr.
console.error("mcp-datos-argentina listo (stdio)");
