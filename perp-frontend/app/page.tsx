"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { Check, ChevronDown, Copy, LogOut, Maximize2, Minimize2 } from "lucide-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useMarket } from "@/hooks/useMarket";
import { usePosition } from "@/hooks/usePosition";
import { usePythPrice } from "@/hooks/usePythPrice";
import { useTradeHistory } from "@/hooks/useTradeHistory";
import { useUserCollateral } from "@/hooks/useUserCollateral";
import {
  formatBps,
  formatPrice,
  lamportsToToken,
  shortenAddress,
} from "@/lib/format";
import { fetchChange24h } from "@/lib/candles";
import {
  DEFAULT_MARKET,
  MARKET_DESCRIPTIONS,
  MARKET_LABELS,
  MARKET_SYMBOLS,
  type MarketSymbol,
} from "@/lib/constants";
import AdminPanel from "./components/AdminPanel";
import TradingViewChart from "./components/TradingViewChart";
import PositionsDock from "./components/PositionsDock";
import TradeTicket from "./components/TradeTicket";
import OnChainActivity from "./components/OnChainActivity";
import {
  PoolPage,
  PositionsPage,
  ProfilePage,
} from "./components/NyxoraPages";

const WalletMultiButton = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false },
);

const DEFAULT_TRADING_FEE_BPS = 10;
const CONFIGURED_ADMIN_WALLET = process.env.NEXT_PUBLIC_ADMIN_WALLET?.trim();
type AppView = "trade" | "positions" | "pool" | "profile";
const NAV_ITEMS: { id: AppView; label: string }[] = [
  { id: "trade", label: "Trade" },
  { id: "positions", label: "Positions" },
  { id: "pool", label: "Pool" },
  { id: "profile", label: "Profile" },
];

function beginPointerResize(
  event: React.PointerEvent,
  axis: "x" | "y",
  startValue: number,
  min: number,
  max: number,
  onResize: (value: number) => void,
) {
  event.preventDefault();
  const startPointer = axis === "x" ? event.clientX : event.clientY;

  const handleMove = (moveEvent: PointerEvent) => {
    const pointer = axis === "x" ? moveEvent.clientX : moveEvent.clientY;
    const next = startValue - (pointer - startPointer);
    onResize(Math.min(max, Math.max(min, next)));
  };

  const handleUp = () => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
  };

  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleUp);
}

export default function Home() {
  const chartPanelRef = useRef<HTMLDivElement>(null);
  const [chartExpanded, setChartExpanded] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState<MarketSymbol>(DEFAULT_MARKET);
  const [isMarketMenuOpen, setIsMarketMenuOpen] = useState(false);
  const [marketMenuDirection, setMarketMenuDirection] = useState<"up" | "down">("down");
  const marketMenuRef = useRef<HTMLDivElement>(null);
  const [activeView, setActiveView] = useState<AppView>("trade");
  const [ticketWidth, setTicketWidth] = useState(360);
  const [dockHeight, setDockHeight] = useState(170);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [solBalance, setSolBalance] = useState(0);
  const [change24h, setChange24h] = useState<number | null>(null);

  const { connection } = useConnection();
  const { publicKey, disconnect } = useWallet();
  const { priceData: solUsdPriceData } = usePythPrice("SOLUSD");
  const { priceData: solHypePriceData } = usePythPrice("SOLHYPE");
  const marketPrices = {
    SOLUSD: solUsdPriceData,
    SOLHYPE: solHypePriceData,
  };
  const priceData = marketPrices[selectedMarket];
  const {
    market,
    loading: marketLoading,
    error: marketError,
    refetch: refetchMarket,
  } = useMarket(selectedMarket);
  const { refetch: refetchCollateral, availableAmount } =
    useUserCollateral(selectedMarket);
  const { positions, refetch: refetchPosition } = usePosition(selectedMarket);
  const { history, refetch: refetchHistory } = useTradeHistory();

  
  const price = priceData?.price ?? 0;
  const displayPrice = price;
  const oiLong = market ? lamportsToToken(market.openInterestLong) : 0;
  const oiShort = market ? lamportsToToken(market.openInterestShort) : 0;
  const openInterest = oiLong + oiShort;
  const poolBalance = market ? lamportsToToken(market.poolBalance) : 0;
  const feeText = formatBps(
    market ? market.tradingFeesBps.toNumber() : DEFAULT_TRADING_FEE_BPS,
  );
  const marketPair = MARKET_LABELS[selectedMarket];
  const marketDash = marketPair.replace("/", "-");
  const [baseAsset, quoteAsset] = marketPair.split("/");
  const availableBalance = lamportsToToken(availableAmount);
  const isConfiguredAdmin =
    Boolean(CONFIGURED_ADMIN_WALLET) &&
    publicKey?.toBase58() === CONFIGURED_ADMIN_WALLET;
  const poolUtilization =
    poolBalance > 0 ? Math.min(999, (openInterest / poolBalance) * 100) : 0;
  // Funding proxy derived from real open-interest skew (longs vs shorts).
  const fundingRate =
    openInterest > 0 ? ((oiLong - oiShort) / openInterest) * 0.05 : 0;
  const isProgramMissing = marketError === "Program not deployed on devnet";
  // Only real setup states get the banner; transient RPC errors (e.g. 429 rate
  // limits from the public devnet RPC) must not claim the market is missing.
  const needsMarketSetup =
    isProgramMissing || marketError === "Market not initialized";
  const marketStats = [
    { label: selectedMarket === "SOLUSD" ? "Price" : "Ratio", value: formatPrice(displayPrice) },
    {
      label: "24H",
      value:
        change24h === null
          ? "-"
          : `${change24h >= 0 ? "+" : ""}${change24h.toFixed(2)}%`,
      className:
        change24h === null ? "" : change24h >= 0 ? "positive" : "negative",
    },
    {
      label: "Funding / HR",
      value: `${fundingRate >= 0 ? "+" : ""}${fundingRate.toFixed(4)}%`,
      className: fundingRate >= 0 ? "" : "negative",
    },
    { label: "Open Interest", value: `${openInterest.toFixed(0)} USDC` },
    {
      label: "Pool Util",
      value: `${poolUtilization.toFixed(1)}%`,
      className: poolUtilization > 75 ? "negative" : "",
    },
    { label: "Trading Fee", value: feeText },
    { label: "Pool Balance", value: `${poolBalance.toFixed(2)} USDC` },
  ];

  // Expanded chart: a fixed overlay that works everywhere (incl. iPhone, which
  // has no element fullscreen), upgraded to native fullscreen when allowed.
  useEffect(() => {
    if (!chartExpanded) return;
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setChartExpanded(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setChartExpanded(false);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    window.addEventListener("keydown", onKeyDown);
    document.documentElement.classList.add("chart-expanded-lock");
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("keydown", onKeyDown);
      document.documentElement.classList.remove("chart-expanded-lock");
    };
  }, [chartExpanded]);

  const toggleChartExpanded = useCallback(() => {
    if (chartExpanded) {
      setChartExpanded(false);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      return;
    }
    setChartExpanded(true);
    chartPanelRef.current
      ?.requestFullscreen?.()
      .catch(() => {
        /* not allowed here: the CSS overlay still fills the window */
      });
  }, [chartExpanded]);

  useEffect(() => {
    const abort = new AbortController();
    async function load24h() {
      try {
        const change = await fetchChange24h(selectedMarket, abort.signal);
        if (!abort.signal.aborted) setChange24h(change);
      } catch {
        /* keep last value on failure */
      }
    }
    load24h();
    const interval = setInterval(load24h, 60_000);
    return () => {
      abort.abort();
      clearInterval(interval);
    };
  }, [selectedMarket]);

  useEffect(() => {
    if (!isMarketMenuOpen) return;

    const closeMenu = (event: MouseEvent) => {
      if (!marketMenuRef.current?.contains(event.target as Node)) {
        setIsMarketMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMarketMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isMarketMenuOpen]);

  const toggleMarketMenu = () => {
    if (!isMarketMenuOpen && marketMenuRef.current) {
      const rect = marketMenuRef.current.getBoundingClientRect();
      const menuHeight = 154;
      const spaceBelow = window.innerHeight - rect.bottom;
      setMarketMenuDirection(spaceBelow < menuHeight && rect.top > menuHeight ? "up" : "down");
    }
    setIsMarketMenuOpen((open) => !open);
  };

  useEffect(() => {
    if (!publicKey) return;

    let cancelled = false;
    connection
      .getBalance(publicKey, "confirmed")
      .then((lamports) => {
        if (!cancelled) setSolBalance(lamports / LAMPORTS_PER_SOL);
      })
      .catch(() => {
        if (!cancelled) setSolBalance(0);
      });

    return () => {
      cancelled = true;
    };
  }, [connection, publicKey]);

  const handleUpdate = () => {
    refetchMarket();
    refetchCollateral();
    refetchPosition();
    refetchHistory();
  };

  const handleCopyAddress = async () => {
    if (!publicKey) return;
    await navigator.clipboard?.writeText(publicKey.toBase58());
    setIsAccountMenuOpen(false);
  };

  const handleDisconnect = async () => {
    setIsAccountMenuOpen(false);
    await disconnect();
  };

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) =>
      beginPointerResize(event, "x", ticketWidth, 320, 520, setTicketWidth),
    [ticketWidth],
  );

  const startVerticalResize = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) =>
      beginPointerResize(event, "y", dockHeight, 80, 700, setDockHeight),
    [dockHeight],
  );

  return (
    <div className="perp-shell">
      <header className="terminal-topnav">
        <div className="terminal-nav-cluster">
          <div className="brand-lockup">
            <div className="brand-mark">
              <Image
                src="/nyxora-star-logo.jpg"
                alt="Nyxora"
                width={1024}
                height={1024}
                priority
              />
            </div>
            <strong>Nyxora</strong>
          </div>

          <nav className="terminal-nav" aria-label="Primary">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                className={activeView === item.id ? "active" : ""}
                onClick={() => setActiveView(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="terminal-actions">
          {publicKey ? (
            <div className="account-menu-wrap">
              <button
                className="balance-chip account-trigger"
                onClick={() => setIsAccountMenuOpen((open) => !open)}
              >
                <span className="wallet-status-dot" />
                {availableBalance.toFixed(2)} USDC
                <span className="trigger-divider" />
                {shortenAddress(publicKey.toBase58(), 4)}
                <ChevronDown size={13} />
              </button>
              {isAccountMenuOpen ? (
                <div className="account-dropdown">
                  <div className="account-dropdown-head">
                    <span>ON-CHAIN · DEVNET</span>
                    <div className="account-logo">
                      <Image
                        src="/nyxora-star-logo.jpg"
                        alt=""
                        width={1024}
                        height={1024}
                      />
                    </div>
                  </div>
                  <div className="account-dropdown-row">
                    <span>USDC</span>
                    <strong>{availableBalance.toFixed(2)}</strong>
                  </div>
                  <div className="account-dropdown-row">
                    <span>SOL</span>
                    <strong>{solBalance.toFixed(4)}</strong>
                  </div>
                  <button
                    className="account-dropdown-action"
                    onClick={handleCopyAddress}
                  >
                    <Copy size={16} />
                    Copy address
                  </button>
                  <button
                    className="account-dropdown-action disconnect-action"
                    onClick={handleDisconnect}
                  >
                    <LogOut size={16} />
                    Disconnect
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <WalletMultiButton className="wallet-btn" />
          )}
        </div>
      </header>

      <main className="terminal-main">
        {activeView === "trade" ? (
          <>
            <section className="market-strip" aria-label="Selected market">
          <div className="market-title">
            <div className="market-menu-wrap" ref={marketMenuRef}>
              <button
                type="button"
                className="market-select"
                aria-haspopup="listbox"
                aria-expanded={isMarketMenuOpen}
                onClick={toggleMarketMenu}
              >
                <span>{marketDash}</span>
                <ChevronDown
                  size={15}
                  className={isMarketMenuOpen ? "market-chevron open" : "market-chevron"}
                />
              </button>
              {isMarketMenuOpen ? (
                <div
                  className={`market-menu ${marketMenuDirection}`}
                  role="listbox"
                  aria-label="Select market"
                >
                  <div className="market-menu-label">Markets</div>
                  {MARKET_SYMBOLS.map((symbol) => {
                    const selected = symbol === selectedMarket;
                    return (
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={selected ? "market-option selected" : "market-option"}
                        key={symbol}
                        onClick={() => {
                          setSelectedMarket(symbol);
                          setIsMarketMenuOpen(false);
                        }}
                      >
                        <span className="market-option-check">
                          {selected ? <Check size={19} /> : null}
                        </span>
                        <span className="market-option-copy">
                          <strong>{MARKET_LABELS[symbol].replace("/", "-")}</strong>
                        </span>
                        <span className="market-option-price">
                          {marketPrices[symbol]?.price.toFixed(symbol === "SOLUSD" ? 2 : 6) ?? "—"}
                        </span>
                        <span className="market-option-change">
                          {symbol === selectedMarket && change24h !== null
                            ? `${change24h >= 0 ? "+" : ""}${change24h.toFixed(2)}%`
                            : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <div className="market-pair">
              <span>{MARKET_DESCRIPTIONS[selectedMarket]}</span>
              <strong>
                {quoteAsset === "USD"
                  ? `${baseAsset}/USD · Pyth oracle`
                  : `${baseAsset}/USD ÷ ${quoteAsset}/USD`}
              </strong>
            </div>
          </div>

          <div className="market-stat-grid">
            {marketStats.map((stat) => (
              <div key={stat.label}>
                <span>{stat.label}</span>
                <strong className={stat.className}>{stat.value}</strong>
              </div>
            ))}
          </div>

          <div className="market-pyth-prices">
            <span
              title={
                priceData?.source === "spot"
                  ? "Live Binance spot price (WebSocket). Indicative only: trades settle on the Pyth oracle price."
                  : undefined
              }
            >
              {marketPair} · {priceData?.source === "spot" ? "BINANCE LIVE" : "PYTH"}
            </span>
            <strong>
              ${priceData?.basePrice?.toFixed(2) ?? "-"} · $
              {priceData?.quotePrice?.toFixed(2) ?? "-"}
            </strong>
          </div>
        </section>

        {needsMarketSetup ? (
          <div className="terminal-alert setup-alert">
            <span>
              {isProgramMissing
                ? "Program deployment required"
                : "Market setup required"}
            </span>
            <strong>
              {isProgramMissing
                ? "Deploy the Anchor program to devnet or update the frontend PROGRAM_ID to the deployed program."
                : isConfiguredAdmin
                  ? `Initialize the ${marketPair} market from the admin setup panel below.`
                  : `The ${marketPair} market is not initialized yet. Ask the configured admin wallet to initialize it.`}
            </strong>
          </div>
        ) : null}

        {!market && !isProgramMissing && isConfiguredAdmin ? (
          <div className="setup-inline-panel">
            <AdminPanel
              key={selectedMarket}
              market={market}
              marketSymbol={selectedMarket}
              loading={marketLoading}
              onUpdate={handleUpdate}
            />
          </div>
        ) : null}

        <div
          className="terminal-workspace"
          style={
            {
              "--ticket-width": `${ticketWidth}px`,
              "--dock-height": `${dockHeight}px`,
            } as React.CSSProperties
          }
        >
          <section
            className="chart-stack"
            style={{ gridTemplateRows: `minmax(340px, 1fr) ${dockHeight}px` } as React.CSSProperties}
          >
            <div
              className={`terminal-chart-panel tv-mode${chartExpanded ? " chart-expanded" : ""}`}
              ref={chartPanelRef}
            >
              <div className="chart-panel-title">
                <div>
                  <strong>{marketDash}</strong>
                  <span>{formatPrice(displayPrice)}</span>
                </div>
                <div className="chart-title-right">
                  <em>MagicBlock ER</em>
                  <button
                    aria-label={chartExpanded ? "Exit fullscreen chart" : "Fullscreen chart"}
                    className="chart-fullscreen-btn"
                    onClick={toggleChartExpanded}
                    title={chartExpanded ? "Exit fullscreen (Esc)" : "Fullscreen chart"}
                    type="button"
                  >
                    {chartExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                    <span>{chartExpanded ? "Exit" : "Expand"}</span>
                  </button>
                </div>
              </div>
              <TradingViewChart market={selectedMarket} />
            </div>

            <div className="dock-wrapper" style={{ position: "relative", height: "100%", minHeight: 0 }}>
              <button
                className="dock-resize-handle"
                onPointerDown={startVerticalResize}
                onDoubleClick={() => setDockHeight(dockHeight === 600 ? 170 : 600)}
                aria-label="Resize dock"
              />
              {market ? (
                <PositionsDock
                  market={market}
                  marketSymbol={selectedMarket}
                  onUpdate={handleUpdate}
                />
              ) : (
                <section className="positions-dock setup-dock-placeholder">
                  <div className="dock-empty">
                    Initialize the market above, then positions and orders will
                    appear here.
                  </div>
                </section>
              )}
            </div>
          </section>

          <button
            className="ticket-resize-handle"
            aria-label="Resize trading panel"
            onPointerDown={startResize}
          />

          <aside className="execution-rail">
            <TradeTicket
              market={market}
              marketSymbol={selectedMarket}
              price={displayPrice}
              marketLoading={marketLoading}
              onUpdate={handleUpdate}
            />
            <OnChainActivity market={market} marketSymbol={selectedMarket} />
          </aside>
        </div>
          </>
        ) : activeView === "positions" ? (
          <PositionsPage
            market={market}
            marketSymbol={selectedMarket}
            positions={positions}
            history={history}
            publicKey={publicKey}
            price={displayPrice}
            openInterest={openInterest}
            poolBalance={poolBalance}
            availableBalance={availableBalance}
            poolUtilization={poolUtilization}
            onTrade={() => setActiveView("trade")}
          />
        ) : activeView === "pool" ? (
          <PoolPage
            market={market}
            marketSymbol={selectedMarket}
            positions={positions}
            history={history}
            publicKey={publicKey}
            price={displayPrice}
            openInterest={openInterest}
            poolBalance={poolBalance}
            availableBalance={availableBalance}
            poolUtilization={poolUtilization}
            onTrade={() => setActiveView("trade")}
            onUpdate={handleUpdate}
          />
        ) : (
          <ProfilePage
            market={market}
            marketSymbol={selectedMarket}
            positions={positions}
            history={history}
            publicKey={publicKey}
            price={displayPrice}
            openInterest={openInterest}
            poolBalance={poolBalance}
            availableBalance={availableBalance}
            poolUtilization={poolUtilization}
            onTrade={() => setActiveView("trade")}
          />
        )}
      </main>
    </div>
  );
}
