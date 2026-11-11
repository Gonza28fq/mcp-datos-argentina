// Prueba de humo: levanta el servidor y llama cada tool contra las APIs reales.
// Uso: npm run build && node scripts/smoke.mjs           (por stdio)
//      npm run build && node scripts/smoke.mjs --http    (por Streamable HTTP)
// Falla si una tool no declara outputSchema, si devuelve error donde no se espera,
// o si su structuredContent no cumple el esquema (el cliente del SDK lo valida al llamar).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { spawn } from "node:child_process";

const porHttp = process.argv.includes("--http");
const client = new Client({ name: "smoke", version: "0.0.0" });
let servidorHttp;

if (porHttp) {
  const port = 39_000 + Math.floor(Math.random() * 1000);
  servidorHttp = spawn("node", ["dist/index.js", "--http", "--port", String(port)], { stdio: ["ignore", "ignore", "inherit"] });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch {}
    if (i > 50) throw new Error("El servidor HTTP no arrancó");
    await new Promise((r) => setTimeout(r, 100));
  }
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  console.log(`Transporte: Streamable HTTP (${base}/mcp)`);
} else {
  await client.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"] }));
  console.log("Transporte: stdio");
}

const { tools } = await client.listTools();
console.log("Tools:", tools.map((t) => t.name).join(", "), "\n");
const sinEsquema = tools.filter((t) => !t.outputSchema).map((t) => t.name);
if (sinEsquema.length) console.log("SIN outputSchema:", sinEsquema.join(", "), "\n");

// Casos que deben devolver isError (entradas inválidas a propósito).
const ERROR_ESPERADO = new Set([
  'consultar_deudor {"cuit":"30-54668997-0"}',
  'ubicacion_por_coordenadas {"lat":40.4,"lon":-3.7}',
  'consultar_series {"ids":["NO_EXISTE_123"]}',
  'consultar_cheque_denunciado {"entidad":"provincia","numero_cheque":1}',
]);

const casos = [
  ["cotizaciones_dolar", {}],
  ["cotizacion_bcra", {}],
  ["cotizacion_bcra", { moneda: "EUR", desde: "2026-11-01" }],
  ["buscar_variables_bcra", { texto: "uva", limite: 3 }],
  ["serie_variable_bcra", { id: 1, limite: 3 }],
  ["consultar_deudor", { cuit: "30-54668997-9" }],
  ["consultar_deudor", { cuit: "30-54668997-0" }],
  ["feriados", {}],
  ["feriados", { solo_proximos: true }],
  ["inflacion", {}],
  ["ajustar_por_inflacion", { monto: 100000, desde: "2023-01" }],
  // Georef
  ["normalizar_direccion", { direccion: "Av Rivadavia 1050", provincia: "caba" }],
  ["normalizar_direccion", { direccion: "San Martin 300", provincia: "La Rioja" }],
  ["normalizar_direcciones_lote", { direcciones: [
    { direccion: "Corrientes 1234", provincia: "caba" },
    { direccion: "Av Colon 500", provincia: "cordoba" },
    { direccion: "calle inventada xyz 99" },
  ] }],
  ["buscar_lugar", { tipo: "municipios", provincia: "La Rioja", max: 3 }],
  ["ubicacion_por_coordenadas", { lat: -29.4131, lon: -66.8558 }],
  ["ubicacion_por_coordenadas", { lat: 40.4, lon: -3.7 }],
  // Series de tiempo
  ["buscar_series", { texto: "salario minimo", limite: 3 }],
  ["consultar_series", { ids: ["148.3_INIVELNAL_DICI_M_26"], ultimos: 3 }],
  ["consultar_series", { ids: ["148.3_INIVELNAL_DICI_M_26"], transformacion: "variacion_pct", ultimos: 3 }],
  ["consultar_series", { ids: ["148.3_INIVELNAL_DICI_M_26"], transformacion: "variacion_interanual_pct", ultimos: 3 }],
  ["consultar_series", { ids: ["148.3_INIVELNAL_DICI_M_26"], frecuencia: "year", ultimos: 3 }],
  ["consultar_series", { ids: ["NO_EXISTE_123"] }],
  // Mercado
  ["riesgo_pais", {}],
  ["riesgo_pais", { desde: "2026-01-01" }],
  ["plazos_fijos", { monto: 1000000, limite: 5 }],
  ["plazos_fijos", { cliente: false, limite: 3 }],
  ["plazos_fijos", { dias: 365, monto: 1000000, limite: 3 }],
  ["plazos_fijos", { dias: 47 }],
  // Cheques
  ["consultar_cheque_denunciado", { entidad: "nacion", numero_cheque: 12345678 }],
  ["consultar_cheque_denunciado", { entidad: "provincia", numero_cheque: 1 }],
  // Calculadoras
  ["calcular_aguinaldo", { mejor_sueldo: 1500000 }],
  ["calcular_aguinaldo", { mejor_sueldo: 1500000, anio: 2026, semestre: 2, fecha_ingreso: "2026-09-15" }],
  ["cuotas_vs_contado", { precio_contado: 900000, cantidad_cuotas: 12, monto_cuota: 85000 }],
  ["cuotas_vs_contado", { precio_contado: 900000, cantidad_cuotas: 6, total_financiado: 900000, inflacion_mensual_pct: 2.5 }],
  ["simular_credito_uva", { monto: 60000000, plazo_meses: 240, tna_pct: 4.5, ingreso_mensual: 2500000 }],
];

let fallos = sinEsquema.length;
for (const [name, args] of casos) {
  const caso = `${name} ${JSON.stringify(args)}`;
  let r;
  try {
    r = await client.callTool({ name, arguments: args });
  } catch (e) {
    fallos++;
    console.log(`== ${caso} FALLO: ${e.message}\n`);
    continue;
  }
  const esperado = ERROR_ESPERADO.has(caso);
  const malo = Boolean(r.isError) !== esperado || (!r.isError && !r.structuredContent);
  if (malo) fallos++;
  console.log(`== ${caso} ${r.isError ? "[isError]" : ""}${malo ? " FALLO" : ""}`);
  console.log(r.content[0].text.split("\n\n")[0].slice(0, 400), "\n");
}
// Resources: que cada uno se pueda leer y sea JSON con contenido.
const { resources } = await client.listResources();
for (const { uri } of resources) {
  try {
    const r = await client.readResource({ uri });
    const datos = JSON.parse(r.contents[0].text);
    const n = Array.isArray(datos) ? datos.length : Object.keys(datos).length;
    if (!n) throw new Error("vacío");
    console.log(`== resource ${uri}: ${n} elementos`);
  } catch (e) {
    fallos++;
    console.log(`== resource ${uri} FALLO: ${e.message}`);
  }
}

console.log(fallos ? `\n${fallos} caso(s) fallaron.` : `\nTodos los casos OK (${casos.length} tools, ${resources.length} resources).`);
await client.close();
servidorHttp?.kill();
process.exit(fallos ? 1 : 0);
