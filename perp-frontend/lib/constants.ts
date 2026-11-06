import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "7oYnX6upn2jhobcxUoarHs7MyyiF7ieZgzMGcjfQhrrD",
);

export const MARKET_SEED = "market";
export const USER_COLLATERAL_SEED = "user_collateral";
export const POSITION_SEED = "position";
export const VAULT_SEED = "vault";
export const ORDER_SEED = "order";


export type MarketSymbol = "SOLUSD" | "SOLHYPE";

export const DEFAULT_MARKET: MarketSymbol = "SOLUSD";
export const MARKET_SYMBOLS: MarketSymbol[] = ["SOLUSD", "SOLHYPE"];

export const MARKET_BASE_FEED_IDS: Record<MarketSymbol, string> = {
  SOLUSD: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  SOLHYPE: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
};

export const MARKET_QUOTE_FEED_IDS: Record<MarketSymbol, string> = {
  SOLUSD: "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  SOLHYPE: "4279e31cc369bbcc2faf022b382b080e32a8e689ff20fbc530d2a603eb6cd98b",
};

export const MARKET_LABELS: Record<MarketSymbol, string> = {
  SOLUSD: "SOL/USD",
  SOLHYPE: "SOL/HYPE",
};

/**
 * Spot pairs used to draw chart history. Candles are BASE/USDT ÷ QUOTE/USDT, so the
 * USDT leg cancels and the chart tracks the same ratio as the Pyth oracle
 * (SOL/USD ÷ USDC/USD, SOL/USD ÷ HYPE/USD).
 */
export const MARKET_CANDLE_PAIRS: Record<MarketSymbol, { base: string; quote: string }> = {
  SOLUSD: { base: "SOLUSDT", quote: "USDCUSDT" },
  SOLHYPE: { base: "SOLUSDT", quote: "HYPEUSDT" },
};

export const MARKET_DESCRIPTIONS: Record<MarketSymbol, string> = {
  SOLUSD: "Standard SOL perpetual",
  SOLHYPE: "SOL ÷ HYPE ratio perpetual",
};

export const DEVNET_COLLATERAL_MINT =
  "AMdThvkbfjD3ynTLgG6kaTun2obhKyQ1ceqJN1pkTZPq";

export const LEGACY_MARKET_PDA = new PublicKey(
  "BmbtFPVYrjiS5hYC4GaT3cak4zuKD8FV4MEuEjRqoJMR",
);

export const RPC_ENDPOINT =
  // `||` (not `??`) so an empty value in .env.local falls back to public devnet.
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() || "https://api.devnet.solana.com";

export const COLLATERAL_DECIMALS = 6;
