#!/usr/bin/env node
/**
 * Punto de entrada.
 *   mcp-datos-argentina                  → stdio (Claude Desktop, Claude Code, etc.)
 *   mcp-datos-argentina --http [--port 3000] [--host 127.0.0.1]
 *                                        → Streamable HTTP en /mcp (también con MCP_TRANSPORT=http)
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { crearServidor } from "./servidor.js";
import { iniciarHttp, opcionesDesdeEntorno } from "./transporte-http.js";
import { VERSION } from "./version.js";

const argv = process.argv.slice(2);

if (argv.includes("--version") || argv.includes("-v")) {
  console.log(VERSION);
} else if (argv.includes("--http") || process.env.MCP_TRANSPORT === "http") {
  const http = await iniciarHttp({ ...opcionesDesdeEntorno(argv, process.env), crearServidor });
  const cerrar = () => http.close(() => process.exit(0));
  process.on("SIGINT", cerrar);
  process.on("SIGTERM", cerrar);
} else {
  const server = crearServidor();
  await server.connect(new StdioServerTransport());
  // stdout está reservado para el protocolo MCP: los logs van a stderr.
  console.error(`mcp-datos-argentina ${VERSION} listo (stdio)`);
}
