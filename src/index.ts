#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";
import { registerGeoref } from "./georef.js";
import { registerSeries } from "./series.js";
import { registerMercado } from "./mercado.js";
import { VERSION } from "./version.js";

const server = new McpServer(
  { name: "mcp-datos-argentina", version: VERSION },
  {
    instructions:
      "Datos públicos de Argentina en tiempo real: dólar (oficial, blue, MEP, CCL), riesgo país, plazos fijos por banco, cotizaciones y variables del BCRA, " +
      "Central de Deudores, inflación (IPC), feriados, normalización geográfica (Georef: direcciones, localidades, coordenadas) " +
      "y series de tiempo oficiales (INDEC y ministerios: salarios, EMAE, empleo, IPC por rubro, etc.). " +
      "Para variables del BCRA buscá el id con buscar_variables_bcra; para series oficiales, con buscar_series.",
  },
);

registerTools(server);
registerGeoref(server);
registerSeries(server);
registerMercado(server);

const transport = new StdioServerTransport();
await server.connect(transport);
// stdout está reservado para el protocolo MCP: los logs van a stderr.
console.error("mcp-datos-argentina listo (stdio)");
