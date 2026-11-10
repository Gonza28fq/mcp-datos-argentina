import { readFileSync } from "node:fs";

/**
 * Versión leída de package.json (que viaja en el paquete npm), para tener una sola fuente de verdad.
 * Funciona igual desde src/ (tests) y desde dist/: ambos están un nivel debajo de package.json.
 */
export const VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

export const REPO_URL = "https://github.com/Gonza28fq/mcp-datos-argentina";

export const USER_AGENT = `mcp-datos-argentina/${VERSION} (+${REPO_URL})`;
