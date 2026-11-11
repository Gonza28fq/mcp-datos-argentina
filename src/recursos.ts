/**
 * Resources MCP: catálogos que el usuario (o la app) puede adjuntar como contexto,
 * sin que el modelo tenga que llamar una tool. En Claude Code se mencionan con @.
 *
 * Usan las mismas URLs que las tools, así que comparten la caché de http.ts.
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getJson } from "./http.js";
import { HORA, hoy } from "./comun.js";
import { SITUACIONES } from "./tools.js";
import { entidadesCheques } from "./cheques.js";

const BASE = "datos-argentina://";
const JSON_MIME = "application/json";

const json = (uri: URL, data: unknown) => ({
  contents: [{ uri: uri.href, mimeType: JSON_MIME, text: JSON.stringify(data, null, 2) }],
});

type VariableBcra = {
  idVariable: number;
  descripcion: string;
  categoria: string;
  periodicidad?: string;
  unidadExpresion?: string;
  ultFechaInformada?: string;
};

/** Años que tiene sentido ofrecer: argentinadatos publica feriados desde 2016. */
export function aniosFeriados(actual: number): number[] {
  const anios: number[] = [];
  for (let a = actual + 1; a >= 2016; a--) anios.push(a);
  return anios;
}

export function registerRecursos(server: McpServer) {
  server.registerResource(
    "situaciones_bcra",
    `${BASE}bcra/situaciones`,
    {
      title: "Situaciones de la Central de Deudores",
      description: "Qué significa cada situación (1 a 6) que informa la Central de Deudores del BCRA.",
      mimeType: JSON_MIME,
    },
    async (uri) =>
      json(
        uri,
        Object.entries(SITUACIONES).map(([codigo, descripcion]) => ({ situacion: Number(codigo), descripcion })),
      ),
  );

  server.registerResource(
    "entidades_cheques",
    `${BASE}bcra/entidades-cheques`,
    {
      title: "Entidades bancarias (cheques)",
      description: "Bancos con su código de entidad del BCRA, para consultar_cheque_denunciado.",
      mimeType: JSON_MIME,
    },
    async (uri) => json(uri, await entidadesCheques()),
  );

  server.registerResource(
    "variables_bcra",
    `${BASE}bcra/variables`,
    {
      title: "Catálogo de variables del BCRA",
      description:
        "Las ~1600 variables monetarias del BCRA (API v4) con id, descripción, categoría, unidad y periodicidad. " +
        "El id se usa en serie_variable_bcra.",
      mimeType: JSON_MIME,
    },
    async (uri) => {
      const r = await getJson<{ results: VariableBcra[] }>("https://api.bcra.gob.ar/estadisticas/v4.0/monetarias?limit=3000", {
        ttlMs: 6 * HORA,
      });
      return json(
        uri,
        r.results.map((v) => ({
          id: v.idVariable,
          descripcion: v.descripcion.trim(),
          categoria: v.categoria,
          unidad: v.unidadExpresion,
          periodicidad: v.periodicidad,
          ultimaFecha: v.ultFechaInformada,
        })),
      );
    },
  );

  server.registerResource(
    "provincias",
    `${BASE}georef/provincias`,
    {
      title: "Provincias argentinas",
      description: "Las 24 jurisdicciones con su id INDEC y centroide (Georef). El id sirve como filtro en las tools de Georef.",
      mimeType: JSON_MIME,
    },
    async (uri) => {
      const r = await getJson<{ provincias: { id: string; nombre: string; centroide: { lat: number; lon: number } }[] }>(
        "https://apis.datos.gob.ar/georef/api/provincias?campos=id,nombre,centroide&orden=id&max=30",
        { ttlMs: 24 * HORA },
      );
      return json(uri, r.provincias);
    },
  );

  server.registerResource(
    "feriados",
    new ResourceTemplate(`${BASE}feriados/{anio}`, {
      list: async () => {
        const actual = Number(hoy().slice(0, 4));
        return {
          resources: [actual, actual + 1].map((a) => ({
            uri: `${BASE}feriados/${a}`,
            name: `feriados_${a}`,
            title: `Feriados ${a}`,
            mimeType: JSON_MIME,
          })),
        };
      },
      complete: {
        anio: (valor) =>
          aniosFeriados(Number(hoy().slice(0, 4)))
            .map(String)
            .filter((a) => a.startsWith(valor)),
      },
    }),
    {
      title: "Feriados nacionales por año",
      description: "Calendario de feriados nacionales (inamovibles, trasladables y no laborables) de un año, desde 2016.",
      mimeType: JSON_MIME,
    },
    async (uri, { anio }) => {
      const a = Number(Array.isArray(anio) ? anio[0] : anio);
      if (!Number.isInteger(a) || a < 2016 || a > 2100) throw new Error(`Año inválido: ${anio}. Usá un año entre 2016 y 2100.`);
      const lista = await getJson<{ fecha: string; tipo: string; nombre: string }[]>(
        `https://api.argentinadatos.com/v1/feriados/${a}`,
        { ttlMs: 24 * HORA },
      );
      return json(uri, lista);
    },
  );
}
