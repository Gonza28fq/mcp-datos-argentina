/** Utilidades compartidas por todos los módulos de tools. */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { describeError } from "./http.js";

export const HORA = 60 * 60_000;

/**
 * Resultado OK: un resumen legible arriba y el JSON completo abajo (para clientes que solo leen texto),
 * y los mismos datos en structuredContent, validados contra el outputSchema de la tool.
 */
export const ok = (data: Record<string, unknown>, resumen?: string): CallToolResult => ({
  structuredContent: data,
  content: [
    {
      type: "text",
      text: (resumen ? resumen + "\n\n" : "") + JSON.stringify(data, null, 2),
    },
  ],
});

export const fail = (msg: string): CallToolResult => ({
  content: [{ type: "text", text: msg }],
  isError: true,
});

/** Envuelve el handler para que cualquier error de red vuelva como resultado legible. */
export function safe<A>(fn: (args: A) => Promise<CallToolResult>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return await fn(args);
    } catch (err) {
      return fail(`Error consultando la fuente: ${describeError(err)}`);
    }
  };
}

export const fechaISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato esperado: YYYY-MM-DD");
export const mesISO = z.string().regex(/^\d{4}-\d{2}$/, "Formato esperado: YYYY-MM");

/** Fecha de hoy (YYYY-MM-DD) en hora argentina: en UTC, después de las 21 h ya sería mañana y las APIs rechazan fechas futuras. */
export const hoy = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());

export const SOLO_LECTURA = { readOnlyHint: true, openWorldHint: true } as const;
