import { MARKET_BASE_FEED_IDS, MARKET_QUOTE_FEED_IDS } from "@/lib/constants";

/**
 * Server-side proxy for Pyth Hermes.
 *
 * Hermes requires an API key since the Pyth Core upgrade (26 Aug 2026), and its
 * authenticated responses carry no CORS headers, so browsers can't call it
 * directly. This route adds the key on the server (PYTH_API_KEY, never sent to
 * the browser) and forwards only what the app needs:
 *   /api/hermes/v2/updates/price/latest  → signed price updates for trades
 *   /api/hermes/v2/updates/price/stream  → live SSE price stream
 * Only this app's feed ids are allowed, so the route can't be used as an open
 * relay for the key.
 */

export const dynamic = "force-dynamic";

const HERMES_URL = (
  process.env.PYTH_HERMES_URL?.trim() || "https://hermes.pyth.network"
).replace(/\/+$/, "");

const ALLOWED_KINDS = new Set(["latest", "stream"]);
const ALLOWED_FEEDS = new Set(
  [
    ...Object.values(MARKET_BASE_FEED_IDS),
    ...Object.values(MARKET_QUOTE_FEED_IDS),
  ].map((id) => id.toLowerCase()),
);
const ALLOWED_PARAMS = new Set([
  "ids[]",
  "encoding",
  "parsed",
  "ignore_invalid_price_ids",
]);

function jsonError(status: number, error: string) {
  return Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params;
  if (!ALLOWED_KINDS.has(kind)) return jsonError(404, "Not found");

  const apiKey = process.env.PYTH_API_KEY?.trim();
  if (!apiKey) {
    return jsonError(
      503,
      "Pyth API key missing on the server: set PYTH_API_KEY in .env.local (and in Vercel).",
    );
  }

  const incoming = new URL(request.url).searchParams;
  const ids = incoming
    .getAll("ids[]")
    .map((id) => id.replace(/^0x/, "").toLowerCase());
  if (
    !ids.length ||
    ids.length > 4 ||
    ids.some((id) => !ALLOWED_FEEDS.has(id))
  ) {
    return jsonError(400, "Unsupported price feed ids");
  }

  const upstreamParams = new URLSearchParams();
  incoming.forEach((value, key) => {
    if (ALLOWED_PARAMS.has(key) && key !== "ids[]")
      upstreamParams.append(key, value);
  });
  ids.forEach((id) => upstreamParams.append("ids[]", id));

  let upstream: Response;
  try {
    upstream = await fetch(
      `${HERMES_URL}/v2/updates/price/${kind}?${upstreamParams}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
        signal: request.signal,
      },
    );
  } catch {
    return jsonError(502, "Could not reach Pyth Hermes");
  }

  if (!upstream.ok || !upstream.body) {
    return jsonError(
      upstream.status === 401 || upstream.status === 403
        ? 502
        : upstream.status,
      `Pyth Hermes responded with HTTP ${upstream.status}`,
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type":
        upstream.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store, no-transform",
      ...(kind === "stream"
        ? { Connection: "keep-alive", "X-Accel-Buffering": "no" }
        : {}),
    },
  });
}
