"use client";

import { useState, useEffect, useCallback } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { Program, AnchorProvider, BN, type Idl } from "@coral-xyz/anchor";
import { getMarketPda } from "@/lib/pda";
import { DEFAULT_MARKET, PROGRAM_ID } from "@/lib/constants";
import type { MarketSymbol } from "@/lib/constants";
import idl from "@/lib/idl/solperp_anchor.json";
import { POLL_CACHE_MS, cachedRpc, isPageVisible } from "@/lib/rpcCache";
import { PublicKey, type Transaction, type VersionedTransaction } from "@solana/web3.js";

export interface MarketData {
  admin: PublicKey;
  maxLeverage: BN;
  priceFeedId: number[];
  quoteFeedId: number[];
  collateralMint: PublicKey;
  liquidationThresholdBps: BN;
  tradingFeesBps: BN;
  totalTradingFeesCollected: BN;
  poolBalance: BN;
  openInterestLong: BN;
  openInterestShort: BN;
  nextOrderId: BN;
  isPaused: boolean;
  bump: number;
}

type MarketAccountClient = {
  market: {
    fetch: (address: PublicKey) => Promise<MarketData>;
  };
};

// Custom React hook to fetch and subscribe to on-chain Market PDA data for the selected symbol.
export function useMarket(marketSymbol: MarketSymbol = DEFAULT_MARKET) {
  
  const { connection } = useConnection();
  const [market, setMarket] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marketPda, setMarketPda] = useState<PublicKey | null>(null);

  const fetchMarket = useCallback(async (maxAgeMs: number = POLL_CACHE_MS) => {
    try {
      const pda = getMarketPda(marketSymbol);
      setMarketPda(pda);

      // Whether the program is deployed rarely changes: check it every 5 minutes, not every poll.
      const programAccount = await cachedRpc(
        "program-account",
        () => connection.getAccountInfo(PROGRAM_ID),
        5 * 60_000,
      );
      if (!programAccount) {
        setMarket(null);
        setError("Program not deployed on devnet");
        return;
      }

      const dummyWallet = {
        publicKey: PublicKey.default,
        signTransaction: async <T extends Transaction | VersionedTransaction>(
          tx: T,
        ) => tx,
        signAllTransactions: async <
          T extends Transaction | VersionedTransaction,
        >(
          txs: T[],
        ) => txs,
      };
      const provider = new AnchorProvider(connection, dummyWallet, { commitment: "confirmed" });
      const program = new Program(idl as Idl, provider);
      const marketAccount = program.account as unknown as MarketAccountClient;
      const data = await cachedRpc(
        `market:${pda.toBase58()}`,
        () => marketAccount.market.fetch(pda),
        maxAgeMs,
      );
      setMarket(data);
      setError(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Account does not exist")) {
        setMarket(null);
        setError("Market not initialized");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [connection, marketSymbol]);

  useEffect(() => {
    void Promise.resolve().then(() => fetchMarket());

    const pda = getMarketPda(marketSymbol);
    // The subscription pushes changes; polling is only a slow safety net.
    const subId = connection.onAccountChange(pda, () => fetchMarket(0), "confirmed");
    const interval = setInterval(() => {
      if (isPageVisible()) void fetchMarket();
    }, 30_000);
    return () => {
      connection.removeAccountChangeListener(subId);
      clearInterval(interval);
    }
  }, [connection, marketSymbol,fetchMarket]);

  const refetch = useCallback(() => {
    void fetchMarket(0);
    setTimeout(() => void fetchMarket(0), 1000);
    setTimeout(() => void fetchMarket(0), 2500);
    setTimeout(() => void fetchMarket(0), 5000);
  }, [fetchMarket]);

  return { market, marketPda, loading, error, refetch };
}
