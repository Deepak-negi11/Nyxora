"use client";

import React, { useEffect, useRef } from "react";
import { MARKET_LABELS, type MarketSymbol } from "@/lib/constants";

/**
 * TradingView's free "Advanced Chart" embed widget.
 *
 * Renders TradingView's own UI (indicators, drawing tools, chart types) inside
 * an iframe, on Pyth's feeds as published on TradingView, so the chart shows
 * the same oracle prices the program settles on. The app can't push data or
 * draw positions into the iframe.
 * Widget docs: https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/
 */

const WIDGET_SRC =
  "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";

/** TradingView symbol (or spread expression) for each market. */
export const TRADINGVIEW_SYMBOLS: Record<MarketSymbol, string> = {
  SOLUSD: "PYTH:SOLUSD",
  SOLHYPE: "PYTH:SOLUSD/PYTH:HYPEUSD",
};

/** Interval when the chart first loads; change it from TradingView's toolbar. */
const DEFAULT_INTERVAL = "15";

function localTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC";
  } catch {
    return "Etc/UTC";
  }
}

export default function TradingViewChart({ market }: { market: MarketSymbol }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    host.replaceChildren();
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";

    const script = document.createElement("script");
    script.src = WIDGET_SRC;
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: TRADINGVIEW_SYMBOLS[market],
      interval: DEFAULT_INTERVAL,
      timezone: localTimezone(),
      theme: "dark",
      style: "1",
      locale: "en",
      backgroundColor: "#151515",
      gridColor: "rgba(255, 255, 255, 0.05)",
      allow_symbol_change: false,
      hide_side_toolbar: false,
      // The 1D/5D/1M… bar duplicates the interval menu and costs ~40px of chart.
      withdateranges: false,
      save_image: true,
      calendar: false,
      details: false,
      hotlist: false,
      support_host: "https://www.tradingview.com",
    });

    host.append(widget, script);
    return () => host.replaceChildren();
  }, [market]);

  return (
    <div className="terminal-chart-stage tv-chart-stage">
      <div className="tradingview-widget-container tv-chart-host" ref={hostRef} />
      <div className="tv-chart-attribution">
        <a
          href={`https://www.tradingview.com/symbols/${encodeURIComponent(
            TRADINGVIEW_SYMBOLS[market].split("/")[0].replace(":", "-"),
          )}/`}
          rel="noopener nofollow noreferrer"
          target="_blank"
        >
          {MARKET_LABELS[market]} chart by TradingView
        </a>
      </div>
    </div>
  );
}
