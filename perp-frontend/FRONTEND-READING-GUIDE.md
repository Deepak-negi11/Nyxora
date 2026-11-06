# Frontend Reading Guide — read the files in THIS order

**For:** Deepak — you know the trading logic, but the frontend (React/Next.js) feels
confusing. This file is your **map**. Read the project files in the order below and
each one will make sense, because each builds on the one before it.

> Mental model in one sentence:
> **The app boots (layout) → turns on the wallet + popups (providers) → the screen
> (page) asks the hooks for live data → the hooks use the tiny tools in lib/ → the
> components draw the boxes you see.**

---

## How a Next.js app "starts" (the part nobody tells you)

There is no single `main()` like in Rust. Next.js has rules:

1. **`app/layout.tsx` runs first, for every page.** It is the outer frame.
2. Inside it, **`app/page.tsx`** is the actual screen for the `/` route.
3. Files with `"use client";` at the top run **in the browser** (they can use clicks,
   state, wallet). Files without it run on the **server** first.
4. A **hook** (file name starts with `use…`) is just a function that gives a component
   live data and re-runs when that data changes. Think of it as a "data subscription."
5. **`lib/`** = small plain helper functions (no UI). **`components/`** = the visible
   boxes. **`hooks/`** = the wires that bring data to those boxes.

---

## THE READING ORDER (file by file)

### STAGE 0 — Boot & setup (read these first)
| # | File | What it is, in one plain line |
|---|---|---|
| 1 | `app/layout.tsx` | The **front door**. Loads fonts + global CSS, and wraps every screen in the wallet + toast providers. |
| 2 | `app/components/WalletContextProvider.tsx` | Turns on the **Solana connection** (RPC) and the **wallet list** (Phantom, Solflare) + connect-modal. After this, any component can "see" the wallet. |
| 3 | `app/components/Toast.tsx` | The **popup message** system ("Trade sent!", "Error"). Wraps the app so anyone can show one. |

### STAGE 1 — Tiny tools everything uses (`lib/`)
| # | File | What it is, in one plain line |
|---|---|---|
| 4 | `lib/constants.ts` | The **settings sheet**: PROGRAM_ID, the markets (SOL/ETH/WBTC), Pyth feed ids, RPC URL, PDA seeds. Read this FIRST in lib — everything imports it. |
| 5 | `lib/format.ts` | **Number helpers**: turn raw integers into "$1,234.56", shorten wallet addresses, convert tokens ↔ lamports. |
| 6 | `lib/pda.ts` | **Address math**. On Solana, each account lives at a computed address (a "PDA"). This computes them from seeds. Must match the Rust seeds exactly. |
| 7 | `lib/pyth.ts` | When you place a trade, this **fetches a fresh Pyth price** and bundles it into your transaction so the contract has a current price. |
| 8 | `lib/events.ts` | **Decodes** the program's log messages into clean trade objects (feeds the Live Trades list). |
| — | `lib/idl/solperp_anchor.json` | Auto-generated **menu** of your program (its instructions + account shapes). You don't read it; Anchor uses it. |

### STAGE 2 — The data layer (`hooks/` = live data wires)
| # | File | What it is, in one plain line |
|---|---|---|
| 9 | `hooks/useProgram.ts` | Builds the **Anchor `Program`** object — the thing that actually calls your contract. One version needs a wallet (to send), one is read-only (to fetch). |
| 10 | `hooks/usePythPrice.ts` | **Streams the live price** from Pyth (the green "Oracle live" dot). |
| 11 | `hooks/useMarket.ts` | Fetches + **live-subscribes** to the on-chain Market account (pool balance, open interest, fees). |
| 12 | `hooks/useUserCollateral.ts` | Your **USDC balance** inside the protocol. |
| 13 | `hooks/usePosition.ts` | Your **currently-open position**. |
| 14 | `hooks/useTradeHistory.ts` | Your **past trades**. |
| 15 | `hooks/useLiveTrades.ts` | **Everyone's** live trades (the public feed). |

### STAGE 3 — The screen (the file that glues it all)
| # | File | What it is, in one plain line |
|---|---|---|
| 16 | `app/page.tsx` | **THE MAIN SCREEN.** Holds the selected market + timeframe, calls the hooks above, and arranges every component. Read it AFTER the hooks so you recognize the data it uses. |

### STAGE 4 — The visible pieces (`components/`)
| # | File | What it is, in one plain line |
|---|---|---|
| 17 | `app/components/MarketRail.tsx` | Left strip: pick SOL/ETH/WBTC, see each market's ticker. |
| 18 | `app/components/TradingViewChart.tsx` | The **price chart**: TradingView's free Advanced Chart widget on Pyth feeds (`PYTH:SOLUSD`, `PYTH:SOLUSD/PYTH:HYPEUSD`). |
| 19 | `app/components/TradeTicket.tsx` | The **order form**: long/short, size, leverage, submit. |
| 20 | `app/components/PositionsDock.tsx` | Bottom dock with tabs: Positions, Balances, Trade History, Live Trades. |
| 21 | `app/components/CollateralPanel.tsx` | **Deposit / withdraw** USDC. |
| 22 | `app/components/HealthBar.tsx` | The **liquidation-risk bar** for an open position. |
| 23 | `app/components/LiveTrades.tsx` | The **live trades table** (uses `useLiveTrades`). |
| 24 | `app/components/AdminPanel.tsx` | Admin-only: **initialize / configure** a market. |

---

## The data-flow story for ONE action (open a trade)

This is the whole app in 6 steps. If you understand this, you understand the frontend:

1. You click **Long** in `TradeTicket.tsx`.
2. It uses `useProgram` (to call the contract) + `lib/pyth.ts` (to attach a fresh price)
   to build a transaction.
3. Your **wallet pops up**, you sign.
4. The **contract** runs `open_position` and changes the `Market` + `Position` accounts
   on-chain.
5. `useMarket` / `usePosition` are **subscribed by WebSocket**, so they instantly notice
   the change → the screen updates (pool balance, your position).
6. `useLiveTrades` sees the program's **log event** → adds your trade to the feed.

That loop — *click → build tx → sign → contract changes accounts → hooks notice →
screen updates* — repeats for every action (deposit, close, liquidate).

---

## Charts — what we use and why

- **Now:** TradingView's free **Advanced Chart widget** (`TradingViewChart.tsx`):
  full TradingView UI (drawing tools, 100+ indicators), no approval needed, on
  Pyth's feeds published on TradingView. It runs in an iframe, so the app can't
  push data or draw positions/liquidation lines into it.
- **History:** we tried `lightweight-charts`, then **KLineChart** on our own data.
  The Pyth history endpoint behind it was retired on 26 Aug 2026.
- **If you need positions on the chart later:** the **TradingView Advanced
  Charting Library** (free, but needs a form/approval) runs on your own data and
  supports custom lines. It self-hosts in `/public`, so it works on Vercel.

---

## What the in-file comments look like

Open any file in the order above and you'll see a big comment block at the top that
starts with `READING ORDER #N`. It explains, in plain English:
- **WHAT IT IS** (one line)
- **WHAT IT DOES** (step by step)
- **HOW IT CONNECTS** to the other files
- **NEXT FILE TO READ**

Follow the `NEXT FILE TO READ` arrows and you'll walk the whole app in order.
