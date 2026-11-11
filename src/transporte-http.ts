/**
 * Transporte Streamable HTTP, en modo sin estado: cada POST /mcp crea un servidor y un transporte nuevos.
 * Como todas las tools son de solo lectura y no hay sesiones, cualquier instancia puede atender cualquier pedido
 * (escala horizontalmente detrás de un balanceador). La caché de http.ts es global al proceso, así que se comparte.
 *
 * Seguridad:
 * - Validación del header Host (protección contra DNS rebinding) cuando escucha en localhost o hay MCP_ALLOWED_HOSTS.
 * - Validación del header Origin: solo se aceptan navegadores de orígenes permitidos.
 * - Token opcional (MCP_AUTH_TOKEN): si está configurado, exige "Authorization: Bearer <token>".
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VERSION } from "./version.js";

export type OpcionesHttp = {
  host: string;
  port: number;
  /** Hostnames aceptados en el header Host. Vacío = sin validación (solo si se escucha fuera de localhost). */
  allowedHosts: string[];
  /** Orígenes aceptados (ej. "https://miapp.com"). Los pedidos sin Origin (clientes no navegador) siempre pasan. */
  allowedOrigins: string[];
  authToken?: string;
  crearServidor: () => McpServer;
  /** Para tests: no escribir logs. */
  silencioso?: boolean;
};

const LIMITE_BODY = 1024 * 1024; // 1 MB: el lote de Georef de 500 direcciones entra holgado
const LOCALES = ["localhost", "127.0.0.1", "[::1]", "::1"];

export const esHostLocal = (host: string) => LOCALES.includes(host);

/** Hostname sin el puerto: "localhost:3000" → "localhost", "[::1]:3000" → "[::1]". */
export function hostname(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.split(":")[0];
}

/** Lee la configuración de variables de entorno y argumentos (--port, --host). */
export function opcionesDesdeEntorno(argv: string[], env: NodeJS.ProcessEnv): Omit<OpcionesHttp, "crearServidor"> {
  const arg = (nombre: string) => {
    const i = argv.indexOf(`--${nombre}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const lista = (s?: string) => (s ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

  const host = arg("host") ?? env.HOST ?? "127.0.0.1";
  const port = Number(arg("port") ?? env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Puerto inválido: ${port}`);

  let allowedHosts = lista(env.MCP_ALLOWED_HOSTS);
  if (!allowedHosts.length && esHostLocal(host)) allowedHosts = LOCALES;
  const allowedOrigins = lista(env.MCP_ALLOWED_ORIGINS);
  return { host, port, allowedHosts, allowedOrigins, authToken: env.MCP_AUTH_TOKEN || undefined };
}

function origenPermitido(origin: string, o: OpcionesHttp): boolean {
  const lo = origin.toLowerCase();
  if (o.allowedOrigins.includes("*") || o.allowedOrigins.includes(lo)) return true;
  // Un navegador en localhost (ej. MCP Inspector) puede hablar con un servidor local.
  try {
    return esHostLocal(o.host) && esHostLocal(new URL(lo).hostname);
  } catch {
    return false;
  }
}

function tokenValido(header: string | undefined, token: string): boolean {
  const m = /^Bearer (.+)$/i.exec(header ?? "");
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

const errorJsonRpc = (res: ServerResponse, status: number, mensaje: string, codigo = -32000) => {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: codigo, message: mensaje }, id: null }));
};

function leerJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let tam = 0;
    const partes: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      tam += c.length;
      if (tam > LIMITE_BODY) {
        reject(Object.assign(new Error("Cuerpo demasiado grande"), { status: 413 }));
        req.destroy();
        return;
      }
      partes.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(partes).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("JSON inválido"), { status: 400, codigo: -32700 }));
      }
    });
    req.on("error", reject);
  });
}

export function crearServidorHttp(o: OpcionesHttp): Server {
  const log = (msg: string) => {
    if (!o.silencioso) console.error(msg);
  };

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const origin = req.headers.origin;

    // 1. Host (DNS rebinding)
    if (o.allowedHosts.length && !o.allowedHosts.includes(hostname(req.headers.host ?? ""))) {
      return errorJsonRpc(res, 403, `Host no permitido: ${req.headers.host ?? "(vacío)"}`);
    }
    // 2. Origin (navegadores)
    if (origin && !origenPermitido(origin, o)) {
      return errorJsonRpc(res, 403, `Origen no permitido: ${origin}`);
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, Mcp-Protocol-Version");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
        "Access-Control-Max-Age": "86400",
      });
      return res.end();
    }

    // 3. Salud (sin token: lo usan los balanceadores y Docker)
    if (url.pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ status: "ok", name: "mcp-datos-argentina", version: VERSION }));
    }

    if (url.pathname !== "/mcp") return errorJsonRpc(res, 404, "No encontrado. El endpoint MCP es /mcp.");

    // 4. Token
    if (o.authToken && !tokenValido(req.headers.authorization, o.authToken)) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="mcp-datos-argentina"');
      return errorJsonRpc(res, 401, "Falta el token o es inválido (Authorization: Bearer <token>).");
    }

    // 5. Sin estado: no hay stream GET ni sesiones que cerrar.
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return errorJsonRpc(res, 405, "Método no permitido: este servidor es sin estado y solo acepta POST.");
    }

    let body: unknown;
    try {
      body = await leerJson(req);
    } catch (e) {
      const err = e as Error & { status?: number; codigo?: number };
      return errorJsonRpc(res, err.status ?? 400, err.message, err.codigo ?? -32600);
    }

    const server = o.crearServidor();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      log(`Error atendiendo /mcp: ${(e as Error).message}`);
      errorJsonRpc(res, 500, "Error interno del servidor", -32603);
    }
  });
}

/** Levanta el servidor HTTP y resuelve cuando ya está escuchando. */
export async function iniciarHttp(o: OpcionesHttp): Promise<Server> {
  const http = crearServidorHttp(o);
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(o.port, o.host, resolve);
  });
  if (!o.silencioso) {
    const addr = http.address();
    const puerto = typeof addr === "object" && addr ? addr.port : o.port;
    const hostUrl = o.host.includes(":") ? `[${o.host}]` : o.host;
    console.error(`mcp-datos-argentina ${VERSION} escuchando en http://${hostUrl}:${puerto}/mcp`);
    if (!o.allowedHosts.length) console.error("⚠ Sin validación de Host: configurá MCP_ALLOWED_HOSTS con tu dominio.");
    if (!esHostLocal(o.host) && !o.authToken) console.error("⚠ Expuesto fuera de localhost sin MCP_AUTH_TOKEN: cualquiera puede usarlo.");
  }
  return http;
}
