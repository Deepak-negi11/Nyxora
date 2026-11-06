"use client";

import { useState, useEffect, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Program, AnchorProvider, BN, type Idl } from "@coral-xyz/anchor";
import idl from "@/lib/idl/solperp_anchor.json";
import {
  PublicKey,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import { getMarketPda } from "@/lib/pda";
import { PROGRAM_ID, type MarketSymbol } from "@/lib/constants";
import { POLL_CACHE_MS, cachedRpc, isPageVisible } from "@/lib/rpcCache";

export interface PositionData {
  publicKey: PublicKey;
  owner: PublicKey;
  market: PublicKey;
  positionId: BN;
  side: { long: object } | { short: object };
  collateral: BN;
  leverage: BN;
  positionSize: BN;
  entryPrice: BN;
  openedAt: BN;
  isOpen: boolean;
  bump: number;
}

type PositionAccountClient = {
  position: {
    all: (filters: unknown[]) => Promise<
      Array<{
        publicKey: PublicKey;
        account: Omit<PositionData, "publicKey">;
      }>
    >;
  };
};

export function usePosition(marketSymbol: MarketSymbol = "SOLUSD") {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [position, setPosition] = useState<PositionData | null>(null); 
  const [positions, setPositions] = useState<PositionData[]>([]); 
  const [loading, setLoading] = useState(true);

  const fetchPosition = useCallback(async (maxAgeMs: number = POLL_CACHE_MS) => {
    if (!publicKey) {
      setPosition(null);
      setPositions([]);
      setLoading(false);
      return;
    }
    try {
      const readonlyWallet = {
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
      const provider = new AnchorProvider(connection, readonlyWallet, {
        commitment: "confirmed",
      });
      const program = new Program(idl as Idl, provider);
      const positionAccount = program.account as unknown as PositionAccountClient;
      const marketAddress = getMarketPda(marketSymbol);

      // getProgramAccounts is expensive; share it across hook instances.
      const positionAccounts = await cachedRpc(
        `positions:${publicKey.toBase58()}:${marketAddress.toBase58()}`,
        () =>
          positionAccount.position.all([
            { memcmp: { offset: 8, bytes: publicKey.toBase58() } },
            { memcmp: { offset: 40, bytes: marketAddress.toBase58() } },
          ]),
        maxAgeMs,
      );

      const openPositions = positionAccounts
        .map(
          (entry: { publicKey: PublicKey; account: Omit<PositionData, "publicKey"> }) =>
            ({ publicKey: entry.publicKey, ...entry.account }) as PositionData,
        )
        .filter(
          (item: PositionData) =>
            item.isOpen && item.market.toString() === marketAddress.toString(),
        )
        .sort((a: PositionData, b: PositionData) =>
          b.openedAt.sub(a.openedAt).toNumber(),
        );

      setPositions(openPositions);
      setPosition(openPositions[0] ?? null); // newest one, for older callers
    } catch {
      setPosition(null);
      setPositions([]);
    } finally {
      setLoading(false);
    }
  }, [connection, marketSymbol, publicKey]);

  useEffect(() => {
    const initialFetch = window.setTimeout(() => void fetchPosition(), 0);

    if (!publicKey) {
      return () => window.clearTimeout(initialFetch);
    }
    const marketAddress = getMarketPda(marketSymbol);
   
    const ownerAndMarketFilters = [
      { memcmp: { offset: 8, bytes: publicKey.toBase58() } },
      { memcmp: { offset: 40, bytes: marketAddress.toBase58() } },
    ];
    const subscriptionId = connection.onProgramAccountChange(
      PROGRAM_ID,
      () => fetchPosition(0),
      "confirmed",
      ownerAndMarketFilters,
    );
    // 3) Safety net every 30s.
    const safetyTimer = setInterval(() => {
      if (isPageVisible()) void fetchPosition();
    }, 30_000);

    return () => {
      window.clearTimeout(initialFetch);
      connection.removeProgramAccountChangeListener(subscriptionId);
      clearInterval(safetyTimer);
    };
  }, [connection, marketSymbol, publicKey, fetchPosition]);

  const refetch = useCallback(() => {
    void fetchPosition(0);
    setTimeout(() => void fetchPosition(0), 1000);
    setTimeout(() => void fetchPosition(0), 2500);
    setTimeout(() => void fetchPosition(0), 5000);
  }, [fetchPosition]);

  return { position, positions, loading, refetch };
}
