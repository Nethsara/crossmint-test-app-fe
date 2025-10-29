import React, { useState } from "react";
import { useAuth, useWallet, SolanaWallet } from "@crossmint/client-sdk-react-ui";
import { AmountInput } from "../common/AmountInput";
import { OrderPreview } from "./OrderPreview";
import { RecipientInput } from "./RecipientInput";
import { useBalance } from "@/hooks/useBalance";
import { Modal } from "../common/Modal";
import { useActivityFeed } from "@/hooks/useActivityFeed";
import { PrimaryButton } from "../common/PrimaryButton";
import { isEmail, isValidAddress } from "@/lib/utils";
import * as multisig from "@sqds/multisig";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SendTransactionError,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
const { Permission, Permissions } = multisig.types;
import bs58 from "bs58";

interface SendFundsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SendFundsModal({ open, onClose }: SendFundsModalProps) {
  const { wallet } = useWallet();

  const solanaWallet = SolanaWallet.from(wallet!);

  const { user } = useAuth();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { displayableBalance, refetch: refetchBalance } = useBalance();
  const { refetch: refetchActivityFeed } = useActivityFeed();

  const connection = new Connection("https://api.devnet.solana.com");

  const isRecipientValid = isValidAddress(recipient) || isEmail(recipient);
  const isAmountValid = true;
  const canContinue = isRecipientValid && isAmountValid;

  async function handleContinue() {
    setError(null);
    if (isEmail(recipient)) {
      if (!recipient) {
        setError("Please enter a recipient");
        return;
      }
      try {
        setIsLoading(true);
        setShowPreview(true);
      } catch (e: unknown) {
        setError((e as Error).message || String(e));
      } finally {
        setIsLoading(false);
      }
    } else {
      setShowPreview(true);
    }
  }

  async function validateAndBroadcast(
    wrappedTxBase58: string,
    approvals: Array<{ signer: string; signature: string }>,
    lastValidBlockHeight: number
  ): Promise<string> {
    const transaction = VersionedTransaction.deserialize(bs58.decode(wrappedTxBase58));

    console.log("📦 Analyzing wrapped transaction from Crossmint...");

    // Check which signers are ACTUALLY required on-chain
    const numRequiredSignatures = transaction.message.header.numRequiredSignatures;
    const accountKeys = transaction.message.getAccountKeys();
    const requiredSignerKeys = accountKeys.staticAccountKeys
      .slice(0, numRequiredSignatures)
      .map((pk) => pk.toBase58());

    console.log("Required on-chain signers:", requiredSignerKeys);
    console.log("Number of signatures needed:", numRequiredSignatures);

    // Build signature map from approvals
    const signaturesByPubkey: Record<string, string> = {};
    for (const approval of approvals) {
      const pubkey = approval.signer;
      signaturesByPubkey[pubkey] = approval.signature;
      console.log(`Have signature for: ${pubkey}`);
    }

    // Use the existing transaction signatures (already includes Crossmint's signature)
    // Just replace with our signatures where we have them

    console.log("\n📝 Updating signatures...");
    for (const approval of approvals) {
      const pubkey = approval.signer.split(":")[1];
      const signatureBytes = bs58.decode(approval.signature);

      if (signatureBytes.length !== 64) {
        throw new Error(`Invalid signature length for ${pubkey}: ${signatureBytes.length} bytes`);
      }

      // Find the index of this pubkey in requiredSignerKeys
      const index = requiredSignerKeys.indexOf(pubkey);
      if (index !== -1) {
        transaction.signatures[index] = signatureBytes;
        console.log(
          `  Updated signature ${index + 1} for ${pubkey.slice(0, 8)}...${pubkey.slice(-8)}`
        );
      }
    }

    console.log("✅ All signatures attached");

    // Broadcast
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");

    // Note: We skip simulation because the Crossmint wrapped transaction
    // expects the wallet to be funded, which Crossmint handles separately

    // Broadcast
    console.log("\n📡 Broadcasting transaction...");
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      maxRetries: 5,
      preflightCommitment: "processed",
    });

    console.log("✅ Transaction sent!");
    console.log("   Signature:", signature);
    console.log("   Explorer: https://explorer.solana.com/tx/" + signature + "?cluster=devnet");

    // Wait for confirmation
    console.log("\n⏳ Waiting for confirmation...");
    await connection.confirmTransaction(
      {
        signature,
        blockhash: transaction.message.recentBlockhash,
        lastValidBlockHeight,
      },
      "confirmed"
    );

    console.log("✅ Transaction confirmed!");

    return signature;
  }

  async function handleSend() {
    setError(null);
    setIsLoading(true);
    try {
      if (!isRecipientValid || !amount || !isAmountValid) {
        setError("Invalid recipient or amount");
        setIsLoading(false);
        return;
      }

      if (!wallet) {
        setError("No wallet connected");
        setIsLoading(false);
        return;
      }

      console.log("solanaWallet.address:", wallet.address);

      const nativeTransferInstruction = SystemProgram.transfer({
        fromPubkey: new PublicKey(solanaWallet.address),
        toPubkey: new PublicKey(recipient),
        lamports: Number(0.0001) * LAMPORTS_PER_SOL,
      });

      const recentBlockhash = await connection.getLatestBlockhash();

      console.log("recentBlockhash:", recentBlockhash);

      const msg = new TransactionMessage({
        payerKey: new PublicKey(solanaWallet.address),
        recentBlockhash: recentBlockhash.blockhash,
        instructions: [nativeTransferInstruction],
      }).compileToV0Message();

      const transaction = new VersionedTransaction(msg);

      console.log("transaction:", transaction);

      const serializedTx = bs58.encode(transaction.serialize());
      console.log("serializedTx:", serializedTx);

      const { transactionId } = await solanaWallet.sendTransaction({
        transaction: transaction,
        options: { experimental_prepareOnly: true },
      });

      const txDetails = await solanaWallet.experimental_transaction(transactionId);
      console.log("Transaction ID:", transactionId);

      console.log("On-chain transaction:", txDetails.onChain.transaction);

      const vtx = VersionedTransaction.deserialize(bs58.decode(txDetails.onChain.transaction));
      console.log("vtx:", vtx);

      const lvbh = txDetails.onChain.lastValidBlockHeight;
      console.log("Pending approvals:", txDetails.approvals.pending);

      const { signature } = await solanaWallet.signer.signTransaction(
        txDetails.onChain.transaction
      );

      const sig = [
        {
          signer: solanaWallet.address,
          signature: signature as string,
        },
      ];

      console.log("Email signature:", signature);

      await validateAndBroadcast(txDetails.onChain.transaction, sig, lvbh);
      // console.log("sig:", sig);
      refetchActivityFeed();
      // handleDone();
    } catch (err: any) {
      if (err instanceof SendTransactionError) {
        console.log("==== err:", err);
        const logs = await err.getLogs(new Connection("https://api.devnet.solana.com"));
        console.log("logs:", logs);
      }

      console.log("err:", err);

      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  const resetFlow = () => {
    setShowPreview(false);
    setAmount("");
    setRecipient("");
    setError(null);
  };

  const handleDone = () => {
    resetFlow();
    onClose();
  };

  const handleBack = () => {
    if (!showPreview) {
      handleDone();
    } else {
      resetFlow();
    }
  };

  const displayableAmount = Number(amount).toFixed(2);

  return (
    <Modal
      open={open}
      onClose={onClose}
      showBackButton={!isLoading}
      onBack={handleBack}
      title={showPreview ? "Order Confirmation" : "Send"}
    >
      {!showPreview ? (
        <>
          <div className="mb-6 flex w-full flex-col items-center justify-between">
            <AmountInput amount={amount} onChange={setAmount} />
            <div
              className={
                Number(amount) > Number(displayableBalance) ? "text-red-600" : "text-gray-400"
              }
            >
              $ {displayableBalance} balance
            </div>
          </div>
          <RecipientInput recipient={recipient} onChange={setRecipient} error={error} />
          <PrimaryButton disabled={!canContinue} onClick={handleContinue}>
            Continue
          </PrimaryButton>
        </>
      ) : (
        <OrderPreview
          userEmail={user?.email || ""}
          recipient={recipient}
          amount={displayableAmount}
          error={error}
          isLoading={isLoading}
          onConfirm={handleSend}
        />
      )}
    </Modal>
  );
}
