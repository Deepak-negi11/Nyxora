import { MARKET_CANDLE_PAIRS } from "@/lib/constants";

/**
 * One shared Binance WebSocket for every spot pair the app needs.
 *
 * - Streams `bookTicker` (best bid/ask) and uses the mid price: it updates
 *   dozens of times a second even when a pair (HYPE) trades rarely.
 * - Ticks are batched and delivered at most every EMIT_INTERVAL_MS, so React
 *   re-renders a few times a second instead of on every message.
 * - The socket opens with the first subscriber, closes shortly after the last
 *   one leaves, and reconnects with backoff (alternating hosts) if it drops.
 *
 * Display only: on-chain trades always settle on the Pyth price.
 */

export type SpotPrices = ReadonlyMap<string, number>;
type Listener = (prices: SpotPrices) => void;

const WS_HOSTS = [
  "wss://data-stream.binance.vision",
  "wss://stream.binance.com:9443",
];
const EMIT_INTERVAL_MS = 250;
const IDLE_CLOSE_MS = 2_000;
const MAX_BACKOFF_MS = 15_000;

const SYMBOLS = Array.from(
  new Set(
    Object.values(MARKET_CANDLE_PAIRS).flatMap(({ base, quote }) => [
      base,
      quote,
    ]),
  ),
);

const listeners = new Set<Listener>();
const prices = new Map<string, number>();

let socket: WebSocket | null = null;
let hostIndex = 0;
let attempt = 0;
let dirty = false;
let emitTimer: ReturnType<typeof setInterval> | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function emit() {
  if (!dirty) return;
  dirty = false;
  const snapshot: SpotPrices = new Map(prices);
  listeners.forEach((listener) => listener(snapshot));
}

function connect() {
  if (socket || typeof WebSocket === "undefined") return;

  const streams = SYMBOLS.map((s) => `${s.toLowerCase()}@bookTicker`).join("/");
  const ws = new WebSocket(`${WS_HOSTS[hostIndex]}/stream?streams=${streams}`);
  socket = ws;

  ws.onopen = () => {
    attempt = 0;
  };

  ws.onmessage = (event) => {
    try {
      const { data } = JSON.parse(event.data as string) as {
        data?: { s?: string; b?: string; a?: string };
      };
      const bid = Number(data?.b);
      const ask = Number(data?.a);
      if (!data?.s || !(bid > 0) || !(ask > 0)) return;
      prices.set(data.s, (bid + ask) / 2);
      dirty = true;
    } catch {
      /* ignore malformed frames */
    }
  };

  ws.onclose = () => {
    if (socket === ws) socket = null;
    if (listeners.size === 0) return;
    // Try the other host next; back off 1s, 2s, 4s… up to 15s.
    hostIndex = (hostIndex + 1) % WS_HOSTS.length;
    const delay = Math.min(1_000 * 2 ** attempt, MAX_BACKOFF_MS);
    attempt += 1;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, delay);
  };

  // onclose always follows onerror, so reconnect logic lives there.
  ws.onerror = () => ws.close();
}

function shutdown() {
  clearInterval(emitTimer);
  clearTimeout(reconnectTimer);
  emitTimer = undefined;
  const ws = socket;
  socket = null;
  ws?.close();
}

/** Subscribe to live spot mid prices keyed by Binance symbol (e.g. "SOLUSDT"). */
export function subscribeSpotPrices(listener: Listener): () => void {
  listeners.add(listener);
  clearTimeout(idleTimer);
  if (prices.size) listener(new Map(prices));

  connect();
  if (emitTimer === undefined) {
    emitTimer = setInterval(emit, EMIT_INTERVAL_MS);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    // Short grace period so a remount (React StrictMode, market switch)
    // reuses the socket instead of reconnecting.
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (listeners.size === 0) shutdown();
    }, IDLE_CLOSE_MS);
  };
}
