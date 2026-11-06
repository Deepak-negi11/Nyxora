/**
 * Shared cache for read-only RPC calls.
 *
 * Several components mount the same data hook (e.g. useUserCollateral runs in
 * the page, the ticket and the positions dock). Without sharing, each instance
 * polls the RPC on its own, which multiplies traffic and trips the public
 * devnet rate limit (HTTP 429).
 *
 * - Callers with the same `key` share one in-flight request.
 * - A finished result is reused for `maxAgeMs` (pass 0 to force a fresh read,
 *   e.g. right after a transaction or an account-change notification).
 * - Failures are never cached, so the next caller retries.
 */

interface Entry {
  at: number;
  pending: boolean;
  promise: Promise<unknown>;
}

const cache = new Map<string, Entry>();

export const POLL_CACHE_MS = 5_000;

export function cachedRpc<T>(
  key: string,
  fetcher: () => Promise<T>,
  maxAgeMs: number = POLL_CACHE_MS,
): Promise<T> {
  const hit = cache.get(key);
  if (hit && (hit.pending || Date.now() - hit.at < maxAgeMs)) {
    return hit.promise as Promise<T>;
  }

  const entry: Entry = { at: Date.now(), pending: true, promise: fetcher() };
  cache.set(key, entry);
  entry.promise.then(
    () => {
      entry.pending = false;
      entry.at = Date.now();
    },
    () => {
      entry.pending = false;
      if (cache.get(key) === entry) cache.delete(key);
    },
  );
  return entry.promise as Promise<T>;
}

/** True while the page is visible; background tabs skip polling. */
export function isPageVisible(): boolean {
  return (
    typeof document === "undefined" || document.visibilityState !== "hidden"
  );
}
