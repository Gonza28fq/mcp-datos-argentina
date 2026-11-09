/**
 * Cliente HTTP mínimo con timeout y caché en memoria.
 * Las APIs públicas que usamos cambian a lo sumo un par de veces por día,
 * así que cachear unos minutos evita martillarlas cuando el modelo repite consultas.
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const USER_AGENT = "mcp-datos-argentina/0.1 (+https://github.com/)";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string,
  ) {
    super(`HTTP ${status} en ${url}`);
  }
}

type CacheEntry = { expires: number; value: unknown };
const cache = new Map<string, CacheEntry>();

export async function getJson<T>(
  url: string,
  opts: { ttlMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  const ttl = opts.ttlMs ?? 5 * 60_000;
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.value as T;

  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, url, text);

  const value = JSON.parse(text) as T;
  if (ttl > 0) cache.set(url, { expires: Date.now() + ttl, value });
  return value;
}

/** POST JSON sin caché (se usa para lotes, donde cada cuerpo es distinto). */
export async function postJson<T>(url: string, body: unknown, opts: { timeoutMs?: number } = {}): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, url, text);
  return JSON.parse(text) as T;
}

/**
 * Extrae un mensaje legible de los errores de cada API:
 * BCRA { errorMessages: [...] } · Series { errors: [{ error }] } · Georef { errores: [{ mensaje }] }
 */
export function describeError(err: unknown): string {
  if (err instanceof HttpError) {
    try {
      const parsed = JSON.parse(err.body) as {
        errorMessages?: string[];
        errors?: { error?: string }[];
        errores?: { mensaje?: string }[];
      };
      const msgs = [
        ...(parsed.errorMessages ?? []),
        ...(parsed.errors ?? []).map((e) => e.error),
        ...(parsed.errores ?? []).map((e) => e.mensaje),
      ].filter(Boolean);
      if (msgs.length) return `${err.message}: ${msgs.join("; ")}`;
    } catch {
      /* body no era JSON */
    }
    return err.message;
  }
  if (err instanceof Error) {
    if (err.name === "TimeoutError") return "La API no respondió a tiempo (timeout).";
    return err.message;
  }
  return String(err);
}
