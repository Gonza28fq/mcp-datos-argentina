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

/** Extrae un mensaje legible de los errores del BCRA ({ errorMessages: [...] }). */
export function describeError(err: unknown): string {
  if (err instanceof HttpError) {
    try {
      const parsed = JSON.parse(err.body) as { errorMessages?: string[] };
      if (parsed.errorMessages?.length) return `${err.message}: ${parsed.errorMessages.join("; ")}`;
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
