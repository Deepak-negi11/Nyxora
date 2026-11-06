"use client";

import { useCallback, useEffect, useState } from "react";
import { BN, BorshCoder, EventParser, type Idl } from "@coral-xyz/anchor";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import idl from "@/lib/idl/solperp_anchor.json";
import {
  LEGACY_MARKET_PDA,
  MARKET_SYMBOLS,
  PROGRAM_ID,
  type MarketSymbol,
} from "@/lib/constants";
import {
  getLegacyUserCollateralPda,
  getMarketPda,
  getUserCollateralPda,
} from "@/lib/pda";
import { cachedRpc } from "@/lib/rpcCache";

/** History is costly (up to ~100 getTransaction calls); reuse it for a minute. */
const HISTORY_CACHE_MS = 60_000;

export interface TradeHistoryItem {
  id: string;
  signature: string;
  blockTime: number;
  marketSymbol: MarketSymbol;
  action: "Opened" | "Closed" | "Liquidated";
  isLong: boolean;
  price: number;
  collateral: number | null;
  size: number | null;
  leverage: number | null;
  pnl: number | null;
}

const SIGNATURE_LIMIT_PER_ADDRESS = 100;
const MAX_SIGNATURES_TO_PARSE = 100;
const TRANSACTION_BATCH_SIZE = 5;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function toPlainNumber(value: unknown): number {
  if (BN.isBN(value)) return (value as BN).toNumber();
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function publicKeyMatches(value: unknown, expected: PublicKey): boolean {
  if (value instanceof PublicKey) return value.equals(expected);
  return String(value) === expected.toString();
}

function isLongSide(value: unknown): boolean {
  const side = asObject(value);
  return "long" in side || "Long" in side;
}

export function useTradeHistory() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [history, setHistory] = useState<TradeHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async (maxAgeMs: number = HISTORY_CACHE_MS) => {
    if (!publicKey) {
      setHistory([]);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      const owner = publicKey;
      // One load shared by every component that shows history (page, dock, activity).
      const historyItems = await cachedRpc(
        `history:${owner.toBase58()}`,
        () => loadHistory(owner),
        maxAgeMs,
      );
      setHistory(historyItems);
      setError(null);
    } catch (caught) {
      setHistory([]);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }

    async function loadHistory(publicKey: PublicKey): Promise<TradeHistoryItem[]> {
      const sharedCollateral = getUserCollateralPda(publicKey);
      const legacyCollateral = getLegacyUserCollateralPda(
        publicKey,
        LEGACY_MARKET_PDA,
      );
      const addresses = [sharedCollateral, legacyCollateral];

      const signatureGroups = await Promise.all(
        addresses.map((address) =>
          connection.getSignaturesForAddress(
            address,
            { limit: SIGNATURE_LIMIT_PER_ADDRESS },
            "confirmed",
          ),
        ),
      );
      const signatures = Array.from(
        new Set(signatureGroups.flat().map((item) => item.signature)),
      ).slice(0, MAX_SIGNATURES_TO_PARSE);

      if (!signatures.length) return [];

      const transactions: Array<{
        signature: string;
        transaction: Awaited<ReturnType<typeof connection.getTransaction>>;
      }> = [];
      for (
        let offset = 0;
        offset < signatures.length;
        offset += TRANSACTION_BATCH_SIZE
      ) {
        const batch = signatures.slice(offset, offset + TRANSACTION_BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map((signature) =>
            connection.getTransaction(signature, {
              commitment: "confirmed",
              maxSupportedTransactionVersion: 0,
            }),
          ),
        );

        results.forEach((result, index) => {
          if (result.status === "fulfilled") {
            transactions.push({
              signature: batch[index],
              transaction: result.value,
            });
          }
        });
      }

      const eventParser = new EventParser(PROGRAM_ID, new BorshCoder(idl as Idl));
      const marketSymbols: MarketSymbol[] = [...MARKET_SYMBOLS];
      const symbolByMarketAddress = new Map(
        marketSymbols.map((symbol) => [getMarketPda(symbol).toString(), symbol]),
      );
      symbolByMarketAddress.set(LEGACY_MARKET_PDA.toString(), "SOLHYPE");
      const historyItems: TradeHistoryItem[] = [];

      transactions.forEach(({ signature, transaction }) => {
        const logs = transaction?.meta?.logMessages;
        if (!transaction || !logs) return;

        let eventIndex = 0;
        for (const event of eventParser.parseLogs(logs)) {
          const eventName = event.name.toLowerCase();
          if (
            eventName !== "positionopened" &&
            eventName !== "positionclosed" &&
            eventName !== "positionliquidated"
          ) {
            continue;
          }

          const data = asObject(event.data);
          if (!publicKeyMatches(data.user, publicKey)) continue;
          const marketSymbol = symbolByMarketAddress.get(String(data.market));
          if (!marketSymbol) continue;

          const isOpened = eventName === "positionopened";
          const isClosed = eventName === "positionclosed";
          historyItems.push({
            id: `${signature}-${eventIndex}`,
            signature,
            blockTime: transaction.blockTime ?? 0,
            marketSymbol,
            action: isOpened ? "Opened" : isClosed ? "Closed" : "Liquidated",
            isLong: isLongSide(data.side),
            price:
              toPlainNumber(
                data.entryPrice ?? data.exitPrice ?? data.currentPrice,
              ) / 1_000_000,
            collateral: isOpened
              ? toPlainNumber(data.collateral) / 1_000_000
              : null,
            size: isOpened ? toPlainNumber(data.positionSize) / 1_000_000 : null,
            leverage: isOpened ? toPlainNumber(data.leverage) : null,
            pnl: isClosed
              ? toPlainNumber(data.pnl) / 1_000_000
              : eventName === "positionliquidated"
                ? -(toPlainNumber(data.realizedLoss) / 1_000_000)
                : null,
          });
          eventIndex += 1;
        }
      });

      historyItems.sort((a, b) => b.blockTime - a.blockTime);
      return historyItems;
    }
  }, [connection, publicKey]);

  useEffect(() => {
    void Promise.resolve().then(() => fetchHistory());
  }, [fetchHistory]);

  // After a trade, force a fresh read instead of the cached one.
  const refetch = useCallback(() => fetchHistory(0), [fetchHistory]);

  return { history, loading, error, refetch };
}
