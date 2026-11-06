import { HermesClient } from "@pythnetwork/hermes-client";

/**
 * Hermes client for the browser.
 *
 * Pyth Hermes requires an API key since the Pyth Core upgrade (26 Aug 2026), and
 * its authenticated responses have no CORS headers, so the browser talks to our
 * own proxy (app/api/hermes/...), which adds PYTH_API_KEY on the server. The key
 * never reaches the browser.
 */
export function createHermesClient(): HermesClient {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "http://localhost";
  return new HermesClient(`${origin}/api/hermes/`);
}

/** Turns a HermesClient/proxy error into a readable message. */
export function describeHermesError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const body = message.match(/body: (\{.*\})$/)?.[1];
  if (body) {
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error) return parsed.error;
    } catch {
      /* fall through */
    }
  }
  return message;
}
