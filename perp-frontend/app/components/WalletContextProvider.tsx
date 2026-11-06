"use client";

import React, { ReactNode, useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { RPC_ENDPOINT } from "@/lib/constants";

import "@solana/wallet-adapter-react-ui/styles.css";

export default function WalletContextProvider({ children }: { children: ReactNode }) {
  // useMemo caches (memoizes) the wallet adapter instances array.
  // This prevents recreating adapter objects and triggering unnecessary wallet reconnection cycles on every re-render.
  const wallets = useMemo(
    // These two adapters are listed explicitly to guarantee support.
    // Other Standard Wallet API compatible wallets (like Backpack) are auto-detected by the wallet provider.
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    // On HTTP 429, web3.js retries the same call up to 4 more times, which turns
    // one rate-limit hit into a burst. Our hooks poll and refetch anyway, so fail
    // fast instead and let the next scheduled read try again.
    <ConnectionProvider
      endpoint={RPC_ENDPOINT}
      config={{ commitment: "confirmed", disableRetryOnRateLimit: true }}
    >
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}