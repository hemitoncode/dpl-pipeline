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

export class FetchError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

const USER_AGENT = "dpl-pipeline/0.2 (legislative research; contact repository owner)";
const TIMEOUT_MS = 60_000;
const RETRIES = 3;

const cache = new Map<string, { bytes: Uint8Array; contentType: string }>();

export async function fetchDoc(url: string): Promise<FetchedDoc> {
  if (url.startsWith("legiscan-api://")) return fetchLegiScanApi(url);
  if (!/^https?:\/\//i.test(url)) {
    throw new FetchError(`unsupported URL scheme (need http/https): ${url}`);
  }
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
      if (!resp.ok) throw new FetchError(`HTTP ${resp.status} for ${url}`, resp.status);
      const bytes = new Uint8Array(await resp.arrayBuffer());
      const contentType = resp.headers.get("content-type") ?? "";
      cache.set(url, { bytes, contentType });
      return { url, bytes, contentType, fromCache: false };
    } catch (e) {
      lastErr = e;
      // 4xx (except 429) won't get better on retry — fail fast to the next
      // source candidate instead of burning backoff time.
      const s = e instanceof FetchError ? e.status : undefined;
      if (s !== undefined && s >= 400 && s < 500 && s !== 429) break;
      if (attempt < RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }
  throw new FetchError(`failed to fetch ${url}: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

/**
 * Fetch a bill document through LegiScan's API (op=getBillText) instead of
 * scraping the viewer page. `url` is our internal "legiscan-api://<docId>"
 * marker produced by sourceCandidates(); requires LEGISCAN_API_KEY.
 */
async function fetchLegiScanApi(url: string): Promise<FetchedDoc> {
  const hit = cache.get(url);
  if (hit) return { url, bytes: hit.bytes, contentType: hit.contentType, fromCache: true };

  const docId = url.slice("legiscan-api://".length);
  const key = process.env.LEGISCAN_API_KEY;
  if (!key) throw new FetchError("LEGISCAN_API_KEY is not set");
  const apiUrl = `https://api.legiscan.com/?key=${encodeURIComponent(key)}&op=getBillText&id=${encodeURIComponent(docId)}`;
  const resp = await fetch(apiUrl, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) throw new FetchError(`LegiScan API HTTP ${resp.status} for doc ${docId}`);
  const data = (await resp.json()) as {
    status?: string;
    text?: { doc?: string; mime?: string };
  };
  if (data.status !== "OK" || !data.text?.doc) {
    throw new FetchError(`LegiScan API returned no document for doc ${docId} (status: ${data.status})`);
  }
  const bytes = new Uint8Array(Buffer.from(data.text.doc, "base64"));
  const contentType = data.text.mime ?? "";
  cache.set(url, { bytes, contentType });
  return { url, bytes, contentType, fromCache: false };
}

/** Test hook: seed or clear the cache. */
export function _seedCache(url: string, bytes: Uint8Array, contentType: string): void {
  cache.set(url, { bytes, contentType });
}
