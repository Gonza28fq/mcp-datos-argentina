#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";

const server = new McpServer(
  { name: "mcp-datos-argentina", version: "0.1.0" },
  {
    instructions:
      "Datos públicos de Argentina en tiempo real: dólar (oficial, blue, MEP, CCL), cotizaciones y variables del BCRA, " +
      "Central de Deudores, inflación (IPC) y feriados. Para variables del BCRA, buscá primero el id con buscar_variables_bcra.",
  },
);

registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
// stdout está reservado para el protocolo MCP: los logs van a stderr.
console.error("mcp-datos-argentina listo (stdio)");
