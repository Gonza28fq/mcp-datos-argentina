/** Cheques denunciados (extraviados, robados, adulterados) — API de Cheques del BCRA. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getJson, HttpError } from "./http.js";
import { fail, HORA, ok, safe, SOLO_LECTURA } from "./comun.js";
import * as S from "./esquemas.js";

const CHEQUES = "https://api.bcra.gob.ar/cheques/v1.0";

export type EntidadCheques = { codigoEntidad: number; denominacion: string };

type RespDenunciado = {
  results: {
    numeroCheque: number;
    denunciado: boolean;
    fechaProcesamiento: string;
    denominacionEntidad: string;
    detalles: { sucursal?: number; numeroCuenta?: number; causal?: string }[];
  };
};

export const entidadesCheques = () =>
  getJson<{ results: EntidadCheques[] }>(`${CHEQUES}/entidades`, { ttlMs: 24 * HORA }).then((r) => r.results);

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\b(banco|s\.?a\.?u?\.?|sociedad anonima|de la|de|del|y)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Nombres comerciales o siglas que no aparecen en la denominación oficial (ya normalizados). */
const ALIAS: Record<string, string> = {
  icbc: "industrial and commercial bank of china",
  frances: "bbva",
  bapro: "provincia buenos aires",
  bpba: "provincia buenos aires",
  bna: "nacion argentina",
};

/**
 * Resuelve la entidad por código o por nombre. Devuelve la entidad o la lista de candidatas si hay ambigüedad.
 * "nacion" → Banco de la Nación; "galicia" → Banco de Galicia; "11" → código 11.
 */
export function resolverEntidad(texto: string, entidades: EntidadCheques[]): EntidadCheques | EntidadCheques[] {
  const t = texto.trim();
  if (/^\d+$/.test(t)) {
    const e = entidades.find((x) => x.codigoEntidad === Number(t));
    return e ?? [];
  }
  const q0 = norm(t);
  const q = ALIAS[q0] ?? q0;
  if (!q) return [];
  const exactas = entidades.filter((e) => norm(e.denominacion) === q);
  if (exactas.length === 1) return exactas[0];
  const terminos = q.split(" ");
  const parciales = entidades.filter((e) => {
    const d = norm(e.denominacion);
    return terminos.every((w) => d.split(" ").some((p) => p.startsWith(w)));
  });
  return parciales.length === 1 ? parciales[0] : parciales;
}

export function registerCheques(server: McpServer) {
  server.registerTool(
    "consultar_cheque_denunciado",
    {
      title: "¿El cheque está denunciado?",
      description:
        "Verifica en el BCRA si un cheque fue denunciado como extraviado, robado o adulterado, a partir del banco emisor y el número de cheque. " +
        "Útil antes de aceptar un cheque. El banco se puede indicar por nombre ('Nación', 'Galicia') o por código BCRA.",
      inputSchema: {
        entidad: z.string().min(1).describe("Banco emisor: nombre (ej. 'Nación', 'Santander') o código de entidad del BCRA (ej. '11')."),
        numero_cheque: z.number().int().positive().describe("Número del cheque, sin ceros a la izquierda."),
      },
      outputSchema: S.salidaChequeDenunciado,
      annotations: SOLO_LECTURA,
    },
    safe(async ({ entidad, numero_cheque }) => {
      const entidades = await entidadesCheques();
      const e = resolverEntidad(entidad, entidades);
      if (Array.isArray(e)) {
        if (!e.length) return fail(`No encontré la entidad "${entidad}". Probá con otro nombre o con el código (resource datos-argentina://bcra/entidades-cheques).`);
        return fail(
          `"${entidad}" coincide con varias entidades; indicá una más precisa o su código:\n` +
            e.slice(0, 15).map((x) => `${x.codigoEntidad}: ${x.denominacion}`).join("\n"),
        );
      }
      let r: RespDenunciado;
      try {
        r = await getJson<RespDenunciado>(`${CHEQUES}/denunciados/${e.codigoEntidad}/${numero_cheque}`, { ttlMs: HORA });
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) return fail(`El BCRA no reconoce la consulta: ${err.body}`);
        throw err;
      }
      const c = r.results;
      const detalles = c.detalles.map((d) => ({ sucursal: d.sucursal ?? null, numeroCuenta: d.numeroCuenta ?? null, causal: d.causal ?? null }));
      const resumen = c.denunciado
        ? `⚠ El cheque N° ${c.numeroCheque} de ${c.denominacionEntidad} ESTÁ DENUNCIADO` +
          (detalles.length ? `: ${detalles.map((d) => d.causal ?? "sin causal informada").join("; ")}` : "") +
          `. Datos al ${c.fechaProcesamiento}. No lo aceptes sin verificar con el banco.`
        : `El cheque N° ${c.numeroCheque} de ${c.denominacionEntidad} no figura como denunciado (datos al ${c.fechaProcesamiento}). ` +
          "Esto no garantiza que tenga fondos.";
      return ok(
        {
          entidad: { codigo: e.codigoEntidad, denominacion: c.denominacionEntidad },
          numeroCheque: c.numeroCheque,
          denunciado: c.denunciado,
          fechaProcesamiento: c.fechaProcesamiento,
          detalles,
        },
        resumen,
      );
    }),
  );
}
