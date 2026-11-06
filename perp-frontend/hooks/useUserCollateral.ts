"use client";

import { useState, useEffect, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Program, AnchorProvider, BN, type Idl } from "@coral-xyz/anchor";
import { getUserCollateralPda } from "@/lib/pda";
import idl from "@/lib/idl/solperp_anchor.json";
import { POLL_CACHE_MS, cachedRpc, isPageVisible } from "@/lib/rpcCache";
import type { MarketSymbol } from "@/lib/constants";
import { PublicKey, type Transaction, type VersionedTransaction } from "@solana/web3.js";

export interface UserCollateralData {
  owner: PublicKey;
  market: PublicKey;
  collateralMint: PublicKey;
  depositedAmount: BN;
  lockedAmount: BN;
  bump: number;
}

type UserCollateralAccountClient = {
  userCollateral: {
    fetch: (address: PublicKey) => Promise<UserCollateralData>;
  };
};

export function useUserCollateral(_marketSymbol: MarketSymbol = "SOLUSD") {
  void _marketSymbol;
  // User collateral is the wallet's deposit ledger inside the protocol. It is
  // different from the SPL token account that actually holds wallet USDC.
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [data, setData] = useState<UserCollateralData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (maxAgeMs: number = POLL_CACHE_MS) => {
    if (!publicKey) {
      setData(null);
      setLoading(false);
      return;
    }
    try {
      // One shared USDC margin PDA backs positions across every market.
      const pda = getUserCollateralPda(publicKey);
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
      const collateralAccount = program.account as unknown as UserCollateralAccountClient;
      // Shared across the page, ticket and dock instances of this hook.
      const account = await cachedRpc(
        `collateral:${pda.toBase58()}`,
        () => collateralAccount.userCollateral.fetch(pda),
        maxAgeMs,
      );
      setData(account);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [connection, publicKey]);

  useEffect(() => {
    const initialFetch = window.setTimeout(() => void fetchData(), 0);
    if (!publicKey) {
      return () => window.clearTimeout(initialFetch);
    }

    const pda = getUserCollateralPda(publicKey);
    const subId = connection.onAccountChange(pda, () => fetchData(0), "confirmed");
    const interval = setInterval(() => {
      if (isPageVisible()) void fetchData();
    }, 30_000);

   return () => {
        window.clearTimeout(initialFetch);
        connection.removeAccountChangeListener(subId);
        clearInterval(interval);
      };
    }, [connection, publicKey, fetchData]);

  const refetch = useCallback(() => {
    void fetchData(0);
    setTimeout(() => void fetchData(0), 1000);
    setTimeout(() => void fetchData(0), 2500);
    setTimeout(() => void fetchData(0), 5000);
  }, [fetchData]);

  // Available collateral is the free balance the user can withdraw or use for a
  // new order. Locked collateral backs open positions or pending trigger orders.
  const availableAmount = data
    ? data.depositedAmount.sub(data.lockedAmount)
    : new BN(0);

  return { data, loading, availableAmount, refetch };
}
