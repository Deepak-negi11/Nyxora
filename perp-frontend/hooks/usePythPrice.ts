"use client";

import { useState, useEffect } from "react";
import {
  DEFAULT_MARKET,
  MARKET_BASE_FEED_IDS,
  MARKET_CANDLE_PAIRS,
  MARKET_QUOTE_FEED_IDS,
  type MarketSymbol,
} from "@/lib/constants";
import { createHermesClient } from "@/lib/hermes";
import { fetchSpotRatio } from "@/lib/candles";
import { subscribeSpotPrices } from "@/lib/spotStream";

export type PriceSource = "pyth" | "spot";

interface PythPriceData {
  price: number;
  basePrice: number;
  quotePrice: number;
  confidence: number;
  publishTime: number;
  /** "pyth" = live oracle stream; "spot" = live Binance WebSocket (indicative). */
  source: PriceSource;
}

const STREAM_RETRY_MS = 30_000;

function readPythPrice(parsedPrice: {
  price: string;
  conf: string;
  expo: number;
  publish_time: number;
}) {
  return {
    price: Number(parsedPrice.price) * Math.pow(10, parsedPrice.expo),
    confidence: Number(parsedPrice.conf) * Math.pow(10, parsedPrice.expo),
    publishTime: parsedPrice.publish_time,
  };
}

function normalizeFeedId(id: string) {
  return id.replace(/^0x/, "").toLowerCase();
}

export function usePythPrice(marketSymbol: MarketSymbol = DEFAULT_MARKET) {
  const [priceData, setPriceData] = useState<PythPriceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const baseId = normalizeFeedId(MARKET_BASE_FEED_IDS[marketSymbol]);
    const quoteId = normalizeFeedId(MARKET_QUOTE_FEED_IDS[marketSymbol]);
    const hermes = createHermesClient();
    const spotAbort = new AbortController();

    let eventSource: Awaited<
      ReturnType<typeof hermes.getPriceUpdatesStream>
    > | null = null;
    let cancelled = false;
    let streamLive = false;
    let unsubscribeSpot: (() => void) | undefined;
    let gotSpotTick = false;
    const { base: baseSymbol, quote: quoteSymbol } =
      MARKET_CANDLE_PAIRS[marketSymbol];
    let retryTimer: number | undefined;

    function publishSpot(basePrice: number, quotePrice: number) {
      if (cancelled || streamLive) return;
      if (!(basePrice > 0) || !(quotePrice > 0)) return;
      setPriceData({
        price: basePrice / quotePrice,
        basePrice,
        quotePrice,
        confidence: 0,
        publishTime: Math.floor(Date.now() / 1000),
        source: "spot",
      });
      setLoading(false);
    }

    function startSpotFallback() {
      if (unsubscribeSpot || cancelled) return;
      // One REST call so a price shows before the first socket tick arrives.
      fetchSpotRatio(marketSymbol, spotAbort.signal)
        .then((spot) => {
          if (!gotSpotTick) publishSpot(spot.basePrice, spot.quotePrice);
        })
        .catch(() => {});
      unsubscribeSpot = subscribeSpotPrices((spot) => {
        const basePrice = spot.get(baseSymbol);
        const quotePrice = spot.get(quoteSymbol);
        if (basePrice === undefined || quotePrice === undefined) return;
        gotSpotTick = true;
        publishSpot(basePrice, quotePrice);
      });
    }

    function stopSpotFallback() {
      unsubscribeSpot?.();
      unsubscribeSpot = undefined;
    }

    async function startStream() {
      try {
        eventSource = await hermes.getPriceUpdatesStream(
          [`0x${baseId}`, `0x${quoteId}`],
          {
            parsed: true,
          },
        );
      } catch {
        handleStreamFailure();
        return;
      }
      if (cancelled) {
        eventSource.close();
        return;
      }

      eventSource.onmessage = (event) => {
        const parsed = JSON.parse(event.data)?.parsed as
          | { id: string; price: Parameters<typeof readPythPrice>[0] }[]
          | undefined;
        // Match feeds by id: the stream doesn't promise to keep request order.
        const baseFeed = parsed?.find(
          (feed) => normalizeFeedId(feed.id) === baseId,
        );
        const quoteFeed = parsed?.find(
          (feed) => normalizeFeedId(feed.id) === quoteId,
        );
        if (!baseFeed || !quoteFeed) return;

        const base = readPythPrice(baseFeed.price);
        const quote = readPythPrice(quoteFeed.price);
        if (!(quote.price > 0)) return;

        streamLive = true;
        stopSpotFallback();
        setPriceData({
          price: base.price / quote.price,
          basePrice: base.price,
          quotePrice: quote.price,
          confidence: base.confidence + quote.confidence,
          publishTime: Math.min(base.publishTime, quote.publishTime),
          source: "pyth",
        });
        setLoading(false);
        setConnected(true);
      };

      // Don't let the client hammer a failing stream (e.g. 401 without a key):
      // close it, show the fallback price, and retry later.
      eventSource.onerror = handleStreamFailure;
    }

    function handleStreamFailure() {
      eventSource?.close();
      eventSource = null;
      streamLive = false;
      if (cancelled) return;
      setConnected(false);
      startSpotFallback();
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => void startStream(), STREAM_RETRY_MS);
    }

    // Pyth stream via our /api/hermes proxy; if it fails (e.g. no server key),
    // handleStreamFailure shows the Binance price and retries later.
    void startStream();
    // Show something useful while the stream connects.
    const warmupTimer = window.setTimeout(() => {
      if (!streamLive) startSpotFallback();
    }, 4_000);

    return () => {
      cancelled = true;
      spotAbort.abort();
      stopSpotFallback();
      window.clearTimeout(retryTimer);
      window.clearTimeout(warmupTimer);
      eventSource?.close();
    };
  }, [marketSymbol]);

  return { priceData, loading, connected };
}
