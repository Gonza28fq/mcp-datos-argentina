// Copia la versión de package.json a server.json (ficha del Registro MCP).
// Lo ejecuta `npm version` automáticamente (script "version"), así el tag ya lleva server.json al día.
import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const server = JSON.parse(readFileSync("server.json", "utf8"));

server.version = pkg.version;
for (const p of server.packages ?? []) if (p.identifier === pkg.name) p.version = pkg.version;

writeFileSync("server.json", JSON.stringify(server, null, 2) + "\n");
console.log(`server.json → ${pkg.version}`);
