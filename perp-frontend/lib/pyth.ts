"use client";

import type { AnchorWallet } from "@solana/wallet-adapter-react";
import type {
  Connection,
  PublicKey,
  Signer,
  VersionedTransaction,
} from "@solana/web3.js";
import { createHermesClient, describeHermesError } from "@/lib/hermes";
import {
  PythSolanaReceiver,
  type InstructionWithEphemeralSigners,
} from "@pythnetwork/pyth-solana-receiver";

const PYTH_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS = 50_000;

type PythReceiverWallet = ConstructorParameters<
  typeof PythSolanaReceiver
>[0]["wallet"];

function feedIdBytesToHex(feedId: number[]): `0x${string}` {
  const hex = feedId
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}`;
}

interface SendWithFreshPythPriceParams {
  connection: Connection;
  wallet: AnchorWallet;
  
  
  feedIds: number[][];
  buildInstructions: (
    priceUpdateAccounts: PublicKey[],
  ) => Promise<InstructionWithEphemeralSigners[]>;
}

async function sendVersionedTransactions(
  connection: Connection,
  wallet: AnchorWallet,
  transactions: { tx: VersionedTransaction; signers?: Signer[] }[],
): Promise<string[]> {
  const signatures: string[] = [];
  const unsignedTxs = transactions.map(({ tx, signers = [] }) => {
    if (signers.length) {
      tx.sign(signers);
    }
    return tx;
  });
  const signedTxs = await wallet.signAllTransactions(unsignedTxs);

  for (const signedTx of signedTxs) {
    const signature = await connection.sendRawTransaction(
      signedTx.serialize(),
      {
        maxRetries: 3,
        preflightCommitment: "confirmed",
        skipPreflight: true,
      },
    );

    const status = await connection.confirmTransaction(signature, "confirmed");

    if (status.value.err) {
      const failedTx = await connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      const logs = failedTx?.meta?.logMessages?.join("\n") ?? "";
      throw new Error(
        `Transaction ${signature} failed: ${JSON.stringify(status.value.err)}${logs ? `\n${logs}` : ""}`,
      );
    }

    signatures.push(signature);
  }

  return signatures;
}

export async function sendWithFreshPythPrice({
  connection,
  wallet,
  feedIds,
  buildInstructions,
}: SendWithFreshPythPriceParams): Promise<string[]> {
  const feedIdHexes = feedIds.map(feedIdBytesToHex);

  // Goes through our /api/hermes proxy, which adds the server-side Pyth key.
  const pythServer = createHermesClient();

  let latestPrices: Awaited<ReturnType<typeof pythServer.getLatestPriceUpdates>>;
  try {
    latestPrices = await pythServer.getLatestPriceUpdates(feedIdHexes, {
      encoding: "base64",
    });
  } catch (error) {
    throw new Error(`Pyth price update failed: ${describeHermesError(error)}`);
  }
  const priceBytes = latestPrices.binary.data;

  if (!priceBytes.length) {
    throw new Error("Pyth did not return price updates for this market");
  }

  const pythReceiver = new PythSolanaReceiver({
    connection,
    wallet: wallet as unknown as PythReceiverWallet,
  });
  const txBuilder = pythReceiver.newTransactionBuilder({
    closeUpdateAccounts: true,
  });

  await txBuilder.addPostPriceUpdates(priceBytes);
  await txBuilder.addPriceConsumerInstructions(
    async (getPriceUpdateAccount) =>
      buildInstructions(feedIdHexes.map((hex) => getPriceUpdateAccount(hex))),
  );

  const builtTxs = await txBuilder.buildVersionedTransactions({
    computeUnitPriceMicroLamports: PYTH_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
    tightComputeBudget: true,
  });

  return sendVersionedTransactions(connection, wallet, builtTxs);
}
