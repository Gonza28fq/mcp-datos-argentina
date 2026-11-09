/**
 * Georef — API oficial de normalización geográfica de Argentina (datos.gob.ar).
 * Direcciones, calles, localidades, municipios, departamentos y provincias, con coordenadas.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getJson, postJson } from "./http.js";
import { fail, HORA, ok, safe, SOLO_LECTURA } from "./comun.js";

const GEOREF = "https://apis.datos.gob.ar/georef/api";

type Ref = { id: string | null; nombre: string | null };
type Coord = { lat: number | null; lon: number | null };

type Direccion = {
  nomenclatura: string;
  calle: Ref & { categoria: string | null };
  altura: { valor: number | null; unidad: string | null };
  piso: string | null;
  calle_cruce_1: Ref;
  calle_cruce_2: Ref;
  departamento: Ref;
  localidad_censal: Ref;
  provincia: Ref;
  ubicacion: Coord;
};

type RespDirecciones = {
  cantidad: number;
  total: number;
  direcciones: Direccion[];
  parametros?: { direccion?: { calles?: string[] } };
};

type Calle = Ref & {
  nomenclatura: string;
  categoria: string;
  departamento: Ref;
  localidad_censal: Ref;
  provincia: Ref;
};

/** Aplana una dirección de Georef a lo que realmente le sirve al modelo. */
const simplificar = (d: Direccion) => ({
  nomenclatura: d.nomenclatura,
  calle: d.calle.nombre,
  altura: d.altura.valor,
  piso: d.piso,
  provincia: d.provincia.nombre,
  departamento: d.departamento.nombre,
  localidad: d.localidad_censal.nombre,
  lat: d.ubicacion.lat,
  lon: d.ubicacion.lon,
  idCalle: d.calle.id,
});

const filtrosGeo = {
  provincia: z.string().optional().describe("Nombre o id de provincia para acotar (ej. 'La Rioja', 'caba', '46')."),
  departamento: z.string().optional().describe("Nombre o id de departamento/partido/comuna."),
  localidad: z.string().optional().describe("Nombre o id de localidad censal."),
};

function setFiltros(p: URLSearchParams, f: { provincia?: string; departamento?: string; localidad?: string }) {
  if (f.provincia) p.set("provincia", f.provincia);
  if (f.departamento) p.set("departamento", f.departamento);
  if (f.localidad) p.set("localidad_censal", f.localidad);
}

export function registerGeoref(server: McpServer) {
  // 1. Normalizar una dirección
  server.registerTool(
    "normalizar_direccion",
    {
      title: "Normalizar dirección",
      description:
        "Normaliza y geolocaliza una dirección argentina (ej. 'Av. Rivadavia 1050', 'Corrientes 1234 piso 3') usando Georef. " +
        "Devuelve nomenclatura oficial, provincia, departamento, localidad y coordenadas. " +
        "Si no hay coincidencia exacta con altura, sugiere las calles con ese nombre.",
      inputSchema: {
        direccion: z.string().min(3).describe("Dirección: calle y altura. También acepta intersecciones ('X y Y')."),
        ...filtrosGeo,
        max: z.number().int().min(1).max(20).default(5),
      },
      annotations: SOLO_LECTURA,
    },
    safe(async ({ direccion, max, ...f }) => {
      const p = new URLSearchParams({ direccion, max: String(max) });
      setFiltros(p, f);
      const r = await getJson<RespDirecciones>(`${GEOREF}/direcciones?${p}`, { ttlMs: 24 * HORA });

      if (r.total > 0) {
        const lista = r.direcciones.map(simplificar);
        return ok(lista, `${r.total} coincidencia(s). Mejor resultado: ${lista[0].nomenclatura} (${lista[0].lat}, ${lista[0].lon}).`);
      }

      // Plan B: muchas calles del interior no tienen alturas cargadas → al menos ubicar la calle.
      const nombreCalle = r.parametros?.direccion?.calles?.[0];
      if (!nombreCalle) return fail(`No se encontró la dirección "${direccion}".`);
      const pc = new URLSearchParams({ nombre: nombreCalle, max: "10" });
      setFiltros(pc, f);
      const calles = await getJson<{ total: number; calles: Calle[] }>(`${GEOREF}/calles?${pc}`, { ttlMs: 24 * HORA });
      if (!calles.total) return fail(`No se encontró la dirección "${direccion}" ni una calle llamada "${nombreCalle}".`);
      const sugerencias = calles.calles.map((c) => ({
        calle: c.nombre,
        categoria: c.categoria,
        localidad: c.localidad_censal.nombre,
        departamento: c.departamento.nombre,
        provincia: c.provincia.nombre,
        idCalle: c.id,
      }));
      return ok(
        { direccionEncontrada: false, callesSugeridas: sugerencias },
        `No se pudo geolocalizar la altura exacta (Georef no tiene numeración para esa calle o zona), ` +
          `pero "${nombreCalle}" existe en ${calles.total} lugar(es). Acotá con provincia/localidad si hace falta.`,
      );
    }),
  );

  // 2. Normalización en lote
  server.registerTool(
    "normalizar_direcciones_lote",
    {
      title: "Normalizar direcciones en lote",
      description:
        "Normaliza y geolocaliza hasta 500 direcciones en una sola llamada (ideal para limpiar padrones o cargas masivas de domicilios). " +
        "Devuelve, para cada entrada, si se encontró y su versión normalizada con coordenadas.",
      inputSchema: {
        direcciones: z
          .array(
            z.object({
              direccion: z.string().min(3),
              provincia: z.string().optional(),
              departamento: z.string().optional(),
              localidad: z.string().optional(),
            }),
          )
          .min(1)
          .max(500),
      },
      annotations: SOLO_LECTURA,
    },
    safe(async ({ direcciones }) => {
      const cuerpo = {
        direcciones: direcciones.map((d) => ({
          direccion: d.direccion,
          ...(d.provincia && { provincia: d.provincia }),
          ...(d.departamento && { departamento: d.departamento }),
          ...(d.localidad && { localidad_censal: d.localidad }),
          max: 1,
        })),
      };
      const r = await postJson<{ resultados: RespDirecciones[] }>(`${GEOREF}/direcciones`, cuerpo);
      const filas = r.resultados.map((res, i) => {
        const d = res.direcciones[0];
        return d
          ? { entrada: direcciones[i].direccion, encontrada: true, ...simplificar(d) }
          : { entrada: direcciones[i].direccion, encontrada: false };
      });
      const encontradas = filas.filter((f) => f.encontrada).length;
      return ok(
        filas,
        `${encontradas}/${filas.length} direcciones normalizadas (${((encontradas / filas.length) * 100).toFixed(0)}%).` +
          (encontradas < filas.length
            ? " Las no encontradas suelen ser calles sin numeración en Georef o direcciones ambiguas: probá agregando provincia/localidad, o usá normalizar_direccion para ver sugerencias."
            : ""),
      );
    }),
  );

  // 3. Buscar unidades territoriales
  server.registerTool(
    "buscar_lugar",
    {
      title: "Buscar provincia, municipio, localidad o calle",
      description:
        "Busca unidades territoriales oficiales de Argentina (provincias, departamentos, municipios, localidades o calles) por nombre, " +
        "con su id INDEC y centroide. Sin nombre, lista todas las de ese tipo (ej. todos los municipios de una provincia).",
      inputSchema: {
        tipo: z.enum(["provincias", "departamentos", "municipios", "localidades", "calles"]),
        nombre: z.string().optional().describe("Nombre a buscar (tolera errores de tipeo y falta de acentos)."),
        provincia: z.string().optional().describe("Provincia para acotar (no aplica a tipo=provincias)."),
        max: z.number().int().min(1).max(500).default(20),
      },
      annotations: SOLO_LECTURA,
    },
    safe(async ({ tipo, nombre, provincia, max }) => {
      const p = new URLSearchParams({ max: String(max) });
      if (nombre) p.set("nombre", nombre);
      if (provincia && tipo !== "provincias") p.set("provincia", provincia);
      if (tipo !== "calles") p.set("orden", nombre ? "id" : "nombre");
      const r = await getJson<Record<string, unknown> & { total: number }>(`${GEOREF}/${tipo}?${p}`, {
        ttlMs: 24 * HORA,
      });
      const lista = (r[tipo] as Record<string, unknown>[]) ?? [];
      if (!lista.length) return fail(`No se encontraron ${tipo}${nombre ? ` con nombre "${nombre}"` : ""}.`);
      return ok(lista, `${r.total} ${tipo} encontrados (mostrando ${lista.length}).`);
    }),
  );

  // 4. Geocodificación inversa
  server.registerTool(
    "ubicacion_por_coordenadas",
    {
      title: "¿Dónde queda esta coordenada?",
      description: "Dado un punto (lat, lon), devuelve la provincia, departamento y municipio argentinos que lo contienen.",
      inputSchema: {
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
      },
      annotations: SOLO_LECTURA,
    },
    safe(async ({ lat, lon }) => {
      const r = await getJson<{ ubicacion: { provincia: Ref; departamento: Ref; municipio: Ref } }>(
        `${GEOREF}/ubicacion?lat=${lat}&lon=${lon}`,
        { ttlMs: 24 * HORA },
      );
      const u = r.ubicacion;
      if (!u.provincia.id) return fail(`El punto (${lat}, ${lon}) no cae dentro del territorio argentino.`);
      return ok(
        u,
        `(${lat}, ${lon}) → ${[u.municipio.nombre, u.departamento.nombre, u.provincia.nombre].filter(Boolean).join(", ")}.`,
      );
    }),
  );
}
