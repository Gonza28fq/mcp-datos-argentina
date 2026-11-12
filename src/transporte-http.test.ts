import { afterEach, describe, expect, it } from "vitest";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { crearServidor } from "./servidor.js";
import { crearLimitador, hostname, iniciarHttp, opcionesDesdeEntorno, type OpcionesHttp } from "./transporte-http.js";
import { VERSION } from "./version.js";

let http: Server | undefined;
afterEach(async () => {
  await new Promise<void>((r) => (http ? http.close(() => r()) : r()));
  http = undefined;
});

async function levantar(extra: Partial<OpcionesHttp> = {}) {
  http = await iniciarHttp({
    ...opcionesDesdeEntorno([], {}),
    port: 0,
    crearServidor,
    silencioso: true,
    ...extra,
  });
  return `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
}

/** Pedido crudo (fetch no deja cambiar el header Host). */
function pedir(base: string, opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string }) {
  const u = new URL(opts.path ?? "/mcp", base);
  return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
    const req = request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: opts.method ?? "GET", headers: opts.headers },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

const INIT = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
});
const HEADERS_MCP = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

async function cliente(base: string, token?: string) {
  const client = new Client({ name: "test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("/mcp", base), {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
  await client.connect(transport);
  return client;
}

describe("opcionesDesdeEntorno", () => {
  it("por defecto escucha en 127.0.0.1:3000 y valida Host local", () => {
    const o = opcionesDesdeEntorno([], {});
    expect(o).toMatchObject({ host: "127.0.0.1", port: 3000, authToken: undefined, limitePorMinuto: 0, confiarEnProxy: false });
    expect(o.allowedHosts).toContain("localhost");
  });

  it("los argumentos ganan a las variables de entorno", () => {
    const o = opcionesDesdeEntorno(["--port", "8080", "--host", "0.0.0.0"], { PORT: "9000", HOST: "localhost" });
    expect(o).toMatchObject({ host: "0.0.0.0", port: 8080 });
    expect(o.allowedHosts).toEqual([]); // fuera de localhost, solo si se configura MCP_ALLOWED_HOSTS
  });

  it("lee hosts, orígenes y token", () => {
    const o = opcionesDesdeEntorno([], {
      HOST: "0.0.0.0",
      MCP_ALLOWED_HOSTS: "mcp.ejemplo.com, Otro.com",
      MCP_ALLOWED_ORIGINS: "https://app.ejemplo.com",
      MCP_AUTH_TOKEN: "secreto",
    });
    expect(o.allowedHosts).toEqual(["mcp.ejemplo.com", "otro.com"]);
    expect(o.allowedOrigins).toEqual(["https://app.ejemplo.com"]);
    expect(o.authToken).toBe("secreto");
  });

  it("lee el límite, el proxy y el dominio de Render", () => {
    const o = opcionesDesdeEntorno([], {
      HOST: "0.0.0.0",
      MCP_RATE_LIMIT: "60",
      MCP_TRUST_PROXY: "1",
      RENDER_EXTERNAL_HOSTNAME: "mcp-datos-argentina.onrender.com",
    });
    expect(o).toMatchObject({ limitePorMinuto: 60, confiarEnProxy: true, allowedHosts: ["mcp-datos-argentina.onrender.com"] });
    expect(() => opcionesDesdeEntorno([], { MCP_RATE_LIMIT: "-1" })).toThrow(/MCP_RATE_LIMIT/);
  });

  it("el limitador corta al pasar el límite y se renueva al minuto", () => {
    let t = 0;
    const limitar = crearLimitador(2, () => t);
    expect([limitar("a"), limitar("a"), limitar("b")]).toEqual([0, 0, 0]);
    t = 15_000;
    expect(limitar("a")).toBe(45);
    t = 60_000;
    expect(limitar("a")).toBe(0);
    expect(crearLimitador(0)("x")).toBe(0);
  });

  it("rechaza un puerto inválido", () => {
    expect(() => opcionesDesdeEntorno(["--port", "abc"], {})).toThrow(/Puerto inválido/);
  });

  it("hostname quita el puerto", () => {
    expect(hostname("localhost:3000")).toBe("localhost");
    expect(hostname("[::1]:3000")).toBe("[::1]");
    expect(hostname("Ejemplo.com")).toBe("ejemplo.com");
  });
});

describe("transporte HTTP", () => {
  it("un cliente MCP lista y llama tools por HTTP", async () => {
    const client = await cliente(await levantar());
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(20);
    // calcular_aguinaldo no usa red
    const r = await client.callTool({ name: "calcular_aguinaldo", arguments: { mejor_sueldo: 1_000_000, anio: 2026, semestre: 1 } });
    expect(r.structuredContent).toMatchObject({ aguinaldoBruto: 500_000 });
    const { prompts } = await client.listPrompts();
    expect(prompts.length).toBe(4);
    await client.close();
  });

  it("/health responde sin token", async () => {
    const base = await levantar({ authToken: "secreto" });
    const r = await pedir(base, { path: "/health" });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ status: "ok", name: "mcp-datos-argentina", version: VERSION });
  });

  it("rechaza un Host ajeno (DNS rebinding)", async () => {
    const base = await levantar();
    const r = await pedir(base, { method: "POST", headers: { ...HEADERS_MCP, Host: "evil.com" }, body: INIT });
    expect(r.status).toBe(403);
    expect(r.body).toMatch(/Host no permitido/);
  });

  it("rechaza un Origin ajeno y acepta uno local", async () => {
    const base = await levantar();
    const malo = await pedir(base, { method: "POST", headers: { ...HEADERS_MCP, Origin: "https://evil.com" }, body: INIT });
    expect(malo.status).toBe(403);
    const bueno = await pedir(base, { method: "POST", headers: { ...HEADERS_MCP, Origin: "http://localhost:6274" }, body: INIT });
    expect(bueno.status).toBe(200);
    expect(bueno.headers["access-control-allow-origin"]).toBe("http://localhost:6274");
  });

  it("con token: 401 sin él, OK con él", async () => {
    const base = await levantar({ authToken: "secreto" });
    const sin = await pedir(base, { method: "POST", headers: HEADERS_MCP, body: INIT });
    expect(sin.status).toBe(401);
    expect(sin.headers["www-authenticate"]).toMatch(/Bearer/);
    const malo = await pedir(base, { method: "POST", headers: { ...HEADERS_MCP, Authorization: "Bearer otro" }, body: INIT });
    expect(malo.status).toBe(401);
    const client = await cliente(base, "secreto");
    expect((await client.listTools()).tools.length).toBe(20);
    await client.close();
  });

  it("GET /mcp devuelve 405 (sin estado), y otras rutas 404", async () => {
    const base = await levantar();
    expect((await pedir(base, { headers: { Accept: "text/event-stream" } })).status).toBe(405);
    expect((await pedir(base, { path: "/otra" })).status).toBe(404);
  });

  it("JSON inválido devuelve un error JSON-RPC de parseo", async () => {
    const base = await levantar();
    const r = await pedir(base, { method: "POST", headers: HEADERS_MCP, body: "{no es json" });
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body).error.code).toBe(-32700);
  });

  it("con límite responde 429 con Retry-After, por IP de X-Forwarded-For", async () => {
    const base = await levantar({ limitePorMinuto: 1, confiarEnProxy: true });
    const h = (ip: string) => ({ ...HEADERS_MCP, "X-Forwarded-For": `${ip}, 10.0.0.1` });
    expect((await pedir(base, { method: "POST", headers: h("1.1.1.1"), body: INIT })).status).toBe(200);
    const r = await pedir(base, { method: "POST", headers: h("1.1.1.1"), body: INIT });
    expect(r.status).toBe(429);
    expect(Number(r.headers["retry-after"])).toBeGreaterThan(0);
    expect((await pedir(base, { method: "POST", headers: h("2.2.2.2"), body: INIT })).status).toBe(200);
    expect((await pedir(base, { path: "/health" })).status).toBe(200); // /health no cuenta
  });

  it("responde el preflight CORS de un origen permitido", async () => {
    const base = await levantar({ allowedOrigins: ["https://app.ejemplo.com"] });
    const r = await pedir(base, { method: "OPTIONS", headers: { Origin: "https://app.ejemplo.com" } });
    expect(r.status).toBe(204);
    expect(r.headers["access-control-allow-headers"]).toMatch(/Mcp-Protocol-Version/);
  });
});
