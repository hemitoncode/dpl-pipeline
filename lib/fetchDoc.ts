/**
 * Document fetching with retries and a per-process in-memory cache.
 *
 * The cache makes reruns within one server process reproducible and polite
 * to state legislature sites. (For frozen, cross-process reproducibility,
 * archive fetched documents alongside the run — each output row's
 * text_sha256 lets you verify a re-fetch matches the original coding.)
 */

export interface FetchedDoc {
  url: string;
  bytes: Uint8Array;
  contentType: string;
  fromCache: boolean;
}

export class FetchError extends Error {}

const USER_AGENT = "dpl-pipeline/0.2 (legislative research; contact repository owner)";
const TIMEOUT_MS = 60_000;
const RETRIES = 3;

const cache = new Map<string, { bytes: Uint8Array; contentType: string }>();

export async function fetchDoc(url: string): Promise<FetchedDoc> {
  const hit = cache.get(url);
  if (hit) return { url, bytes: hit.bytes, contentType: hit.contentType, fromCache: true };

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!resp.ok) throw new FetchError(`HTTP ${resp.status} for ${url}`);
      const bytes = new Uint8Array(await resp.arrayBuffer());
      const contentType = resp.headers.get("content-type") ?? "";
      cache.set(url, { bytes, contentType });
      return { url, bytes, contentType, fromCache: false };
    } catch (e) {
      lastErr = e;
      if (attempt < RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }
  throw new FetchError(`failed to fetch ${url}: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

/** Test hook: seed or clear the cache. */
export function _seedCache(url: string, bytes: Uint8Array, contentType: string): void {
  cache.set(url, { bytes, contentType });
}
