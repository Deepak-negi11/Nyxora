import { MARKET_CANDLE_PAIRS, type MarketSymbol } from "@/lib/constants";

/**
 * Binance public market data for the market ratios (BASE/USDT ÷ QUOTE/USDT),
 * used for the 24h change and the indicative spot price. Free, keyless and
 * CORS-open. The chart itself is TradingView's widget on Pyth's feeds.
 */

export type CandleInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// data-api.binance.vision is the market-data-only mirror; api.binance.com is the fallback.
const BINANCE_HOSTS = [
  "https://data-api.binance.vision",
  "https://api.binance.com",
];
const MAX_LIMIT = 1000;

interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

async function fetchKlines(
  symbol: string,
  interval: CandleInterval,
  limit: number,
  endTime: number | undefined,
  signal?: AbortSignal,
): Promise<Bar[]> {
  const params = new URLSearchParams({
    symbol,
    interval,
    limit: String(Math.min(limit, MAX_LIMIT)),
  });
  if (endTime !== undefined) params.set("endTime", String(endTime));

  let lastError: unknown;
  for (const host of BINANCE_HOSTS) {
    try {
      const res = await fetch(`${host}/api/v3/klines?${params}`, { signal });
      if (!res.ok) throw new Error(`${symbol} history: HTTP ${res.status}`);
      const rows = (await res.json()) as unknown[][];
      return rows.map((row) => ({
        t: Number(row[0]),
        o: Number(row[1]),
        h: Number(row[2]),
        l: Number(row[3]),
        c: Number(row[4]),
        v: Number(row[5]),
      }));
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`${symbol} history unavailable`);
}

/**
 * Joins base and quote bars on open time and divides them.
 * The true high/low of a ratio can't be recovered from two OHLC bars, so this uses
 * the widest possible bound (base high ÷ quote low), clamped to include open/close.
 * For a stablecoin quote (USDC) that is exact to within a few bps.
 */
function divideBars(base: Bar[], quote: Bar[]): Candle[] {
  const quoteByTime = new Map(quote.map((bar) => [bar.t, bar]));
  const out: Candle[] = [];

  for (const b of base) {
    const q = quoteByTime.get(b.t);
    if (!q || q.o <= 0 || q.h <= 0 || q.l <= 0 || q.c <= 0) continue;

    const open = b.o / q.o;
    const close = b.c / q.c;
    out.push({
      timestamp: b.t,
      open,
      close,
      high: Math.max(b.h / q.l, open, close),
      low: Math.min(b.l / q.h, open, close),
      // Volume is in the base asset (SOL), the unit traders read.
      volume: b.v,
    });
  }
  return out;
}

/**
 * Loads `limit` candles for a market, ending at `endTime` (ms, inclusive) or now.
 * Results are oldest-first.
 */
export async function fetchMarketCandles(
  market: MarketSymbol,
  timeframe: CandleInterval,
  {
    limit = 500,
    endTime,
    signal,
  }: { limit?: number; endTime?: number; signal?: AbortSignal } = {},
): Promise<Candle[]> {
  const { base, quote } = MARKET_CANDLE_PAIRS[market];
  const [baseBars, quoteBars] = await Promise.all([
    fetchKlines(base, timeframe, limit, endTime, signal),
    fetchKlines(quote, timeframe, limit, endTime, signal),
  ]);
  return divideBars(baseBars, quoteBars);
}

/** Percent change of the market ratio over the last 24 hours, or null if unavailable. */
export async function fetchChange24h(
  market: MarketSymbol,
  signal?: AbortSignal,
): Promise<number | null> {
  const candles = await fetchMarketCandles(market, "1h", { limit: 25, signal });
  if (candles.length < 2) return null;
  const then = candles[0].close;
  const now = candles[candles.length - 1].close;
  return then > 0 ? (now / then - 1) * 100 : null;
}

/**
 * Indicative spot ratio (BASE/USDT ÷ QUOTE/USDT) from Binance, used when the Pyth
 * stream is unavailable. Display only: on-chain trades always settle on Pyth.
 */
export async function fetchSpotRatio(
  market: MarketSymbol,
  signal?: AbortSignal,
): Promise<{ price: number; basePrice: number; quotePrice: number }> {
  const { base, quote } = MARKET_CANDLE_PAIRS[market];
  const symbols = encodeURIComponent(JSON.stringify([base, quote]));

  let lastError: unknown;
  for (const host of BINANCE_HOSTS) {
    try {
      const res = await fetch(
        `${host}/api/v3/ticker/price?symbols=${symbols}`,
        { signal },
      );
      if (!res.ok) throw new Error(`Spot price: HTTP ${res.status}`);
      const rows = (await res.json()) as { symbol: string; price: string }[];
      const basePrice = Number(rows.find((row) => row.symbol === base)?.price);
      const quotePrice = Number(
        rows.find((row) => row.symbol === quote)?.price,
      );
      if (!(basePrice > 0) || !(quotePrice > 0))
        throw new Error("Spot price missing");
      return { price: basePrice / quotePrice, basePrice, quotePrice };
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Spot price unavailable");
}
