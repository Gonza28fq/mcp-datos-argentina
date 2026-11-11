// Regenera la sección "Referencia de tools" de docs/MANUAL.md a partir de lo que
// el servidor publica en tools/list, para que el manual nunca quede desfasado del código.
// Uso: npm run build && npm run docs
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const MANUAL = "docs/MANUAL.md";
const INICIO = "<!-- REFERENCIA:INICIO (generado por scripts/gen-manual.mjs, no editar a mano) -->";
const FIN = "<!-- REFERENCIA:FIN -->";

const CATEGORIAS = [
  ["Dólar y BCRA", ["cotizaciones_dolar", "cotizacion_bcra", "buscar_variables_bcra", "serie_variable_bcra"]],
  ["Mercado", ["riesgo_pais", "plazos_fijos"]],
  ["Inflación", ["inflacion", "ajustar_por_inflacion"]],
  ["Créditos y cheques", ["consultar_deudor", "consultar_cheque_denunciado"]],
  ["Calculadoras", ["calcular_aguinaldo", "cuotas_vs_contado", "simular_credito_uva"]],
  ["Calendario", ["feriados"]],
  ["Geografía (Georef)", ["normalizar_direccion", "normalizar_direcciones_lote", "buscar_lugar", "ubicacion_por_coordenadas"]],
  ["Series oficiales", ["buscar_series", "consultar_series"]],
];

const EJEMPLOS = {
  cotizaciones_dolar: "¿A cuánto está el dólar blue?",
  cotizacion_bcra: "¿Cuál fue la cotización oficial del real brasileño la última semana?",
  buscar_variables_bcra: "¿Qué variables del BCRA hay sobre tasas de interés?",
  serie_variable_bcra: "¿Cómo evolucionaron las reservas internacionales en el último mes?",
  consultar_deudor: "¿Cómo está el CUIT 30-54668997-9 en la Central de Deudores?",
  feriados: "¿Cuándo es el próximo feriado?",
  inflacion: "¿Cuánta inflación acumulada hubo entre enero y junio de 2026?",
  ajustar_por_inflacion: "¿Cuánto son hoy $100.000 de enero de 2023?",
  normalizar_direccion: "Normalizá 'corrientes 1234, caba' y dame las coordenadas",
  normalizar_direcciones_lote: "Normalizá esta lista de domicilios y decime cuáles no se encontraron",
  buscar_lugar: "Listá los municipios de la provincia de Córdoba",
  ubicacion_por_coordenadas: "¿En qué provincia y municipio cae el punto -31.42, -64.18?",
  buscar_series: "Buscá series sobre desempleo",
  consultar_series: "Mostrame la inflación interanual del IPC nacional de los últimos 6 meses",
  riesgo_pais: "¿Cómo viene el riesgo país en el último mes?",
  plazos_fijos: "¿Qué banco paga más por $1.000.000 a 90 días?",
  consultar_cheque_denunciado: "¿El cheque 12345678 del Banco Nación está denunciado?",
  calcular_aguinaldo: "¿Cuánto me toca de aguinaldo si mi mejor sueldo fue $1.500.000 y entré el 15 de septiembre?",
  cuotas_vs_contado: "¿Me conviene pagar $900.000 de contado o 12 cuotas de $85.000?",
  simular_credito_uva: "Simulá un crédito UVA de $60 millones a 20 años al 4,5% con un ingreso de $2.500.000",
};

const celda = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

function tipo(p) {
  if (p.enum) return p.enum.map((v) => `\`${v}\``).join(" · ");
  if (p.type === "array") {
    if (p.items?.type === "object") return `lista de objetos (${Object.keys(p.items.properties).map((k) => `\`${k}\``).join(", ")})`;
    return `lista de ${p.items?.type ?? "valores"}`;
  }
  const base = { integer: "entero", number: "número", boolean: "sí/no", string: "texto" }[p.type] ?? p.type ?? "";
  const r = [];
  if (p.minimum !== undefined) r.push(`mín ${p.minimum}`);
  if (p.maximum !== undefined) r.push(`máx ${p.maximum}`);
  if (p.minItems !== undefined) r.push(`${p.minItems}–${p.maxItems} elementos`);
  if (p.pattern?.includes("\\d{2}-\\d{2}")) r.push("YYYY-MM-DD");
  else if (p.pattern?.includes("\\d{4}-\\d{2}$")) r.push("YYYY-MM");
  if (p.minLength && p.minLength === p.maxLength) r.push(`${p.minLength} caracteres`);
  return base + (r.length ? ` (${r.join(", ")})` : "");
}

const client = new Client({ name: "gen-manual", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"], stderr: "ignore" }));
const { tools } = await client.listTools();
const { prompts } = await client.listPrompts();
const { resources: todos } = await client.listResources();
const { resourceTemplates } = await client.listResourceTemplates();
// Los feriados por año salen de la plantilla: no listar cada año como recurso aparte.
const resources = todos.filter((r) => !resourceTemplates.some((t) => r.uri.startsWith(t.uriTemplate.split("{")[0])));
await client.close();

const porNombre = new Map(tools.map((t) => [t.name, t]));
const sinCategoria = tools.filter((t) => !CATEGORIAS.some(([, ns]) => ns.includes(t.name)));
if (sinCategoria.length) CATEGORIAS.push(["Otras", sinCategoria.map((t) => t.name)]);

let md = `${INICIO}\n\n_${tools.length} tools. Generado desde \`tools/list\`._\n`;
for (const [cat, nombres] of CATEGORIAS) {
  md += `\n### ${cat}\n`;
  for (const n of nombres) {
    const t = porNombre.get(n);
    if (!t) continue;
    const props = Object.entries(t.inputSchema.properties ?? {});
    const req = t.inputSchema.required ?? [];
    md += `\n#### \`${t.name}\`${t.title ? ` · ${t.title}` : ""}\n\n${t.description}\n\n`;
    if (props.length) {
      md += "| Parámetro | Tipo | Por defecto | Descripción |\n|---|---|---|---|\n";
      for (const [k, p] of props) {
        md += `| \`${k}\`${req.includes(k) ? " **(obligatorio)**" : ""} | ${celda(tipo(p))} | ${p.default !== undefined ? `\`${JSON.stringify(p.default)}\`` : "—"} | ${celda(p.description)} |\n`;
      }
    } else md += "_Sin parámetros._\n";
    if (EJEMPLOS[n]) md += `\n> **Preguntale así:** ${EJEMPLOS[n]}\n`;
  }
}
md += "\n### Prompts (plantillas listas)\n\n";
md += "En Claude Code se invocan como `/mcp__datos-argentina__<nombre>`; en Claude Desktop, desde el menú **+**.\n\n";
md += "| Prompt | Qué hace | Argumentos |\n|---|---|---|\n";
for (const p of prompts) {
  const args = (p.arguments ?? []).map((a) => `\`${a.name}\`${a.required ? "" : " (opcional)"}`).join(", ") || "—";
  md += `| \`${p.name}\` · ${celda(p.title)} | ${celda(p.description)} | ${args} |\n`;
}
md += "\n### Resources (catálogos)\n\n";
md += "Datos que se pueden adjuntar como contexto sin llamar una tool. En Claude Code se mencionan con `@`.\n\n";
md += "| URI | Qué contiene |\n|---|---|\n";
for (const r of resources) md += `| \`${r.uri}\` | ${celda(r.description)} |\n`;
for (const t of resourceTemplates) md += `| \`${t.uriTemplate}\` | ${celda(t.description)} |\n`;

md += "\n### Salida estructurada\n\n";
md += "Todas las tools declaran `outputSchema` y devuelven, además del texto, los mismos datos en `structuredContent`. ";
md += "Un cliente o un programa puede leer esos campos tipados sin parsear el texto.\n\n";
md += "| Tool | Campos principales |\n|---|---|\n";
for (const t of tools) {
  const campos = Object.keys(t.outputSchema?.properties ?? {}).map((k) => `\`${k}\``).join(", ");
  md += `| \`${t.name}\` | ${campos || "—"} |\n`;
}
md += `\n${FIN}`;

const actual = readFileSync(MANUAL, "utf8");
const i = actual.indexOf(INICIO), f = actual.indexOf(FIN);
if (i < 0 || f < 0) throw new Error(`No encontré los marcadores de referencia en ${MANUAL}`);
writeFileSync(MANUAL, actual.slice(0, i) + md + actual.slice(f + FIN.length));
console.log(`${MANUAL}: referencia regenerada con ${tools.length} tools, ${prompts.length} prompts y ${resources.length + resourceTemplates.length} resources`);
