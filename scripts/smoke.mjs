// Prueba de humo: levanta el servidor por stdio y llama cada tool contra las APIs reales.
// Uso: npm run build && node scripts/smoke.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"] }));

const { tools } = await client.listTools();
console.log("Tools:", tools.map((t) => t.name).join(", "), "\n");

const casos = [
  ["cotizaciones_dolar", {}],
  ["cotizacion_bcra", { moneda: "EUR", desde: "2026-11-01" }],
  ["buscar_variables_bcra", { texto: "uva", limite: 3 }],
  ["serie_variable_bcra", { id: 1, limite: 3 }],
  ["consultar_deudor", { cuit: "30-54668997-9" }],
  ["consultar_deudor", { cuit: "30-54668997-0" }],
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
];

let fallos = 0;
for (const [name, args] of casos) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content[0].text;
  console.log(`== ${name} ${JSON.stringify(args)} ${r.isError ? "[isError]" : ""}`);
  console.log(text.split("\n\n")[0].slice(0, 400), "\n");
}
await client.close();
process.exit(fallos ? 1 : 0);
