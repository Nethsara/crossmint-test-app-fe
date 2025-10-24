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
  const isAmountValid =
    !!amount &&
    !Number.isNaN(Number(amount)) &&
    Number(amount) > 0 &&
    Number(amount) <= Number(displayableBalance);
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

      const nativeTransferInstruction = SystemProgram.transfer({
        fromPubkey: new PublicKey("4JK7UiAuNvabjVCjLu4SjkgLv7ExETsyAX9imvBA6tQM"),
        toPubkey: new PublicKey(recipient),
        lamports: Number(0.0001) * LAMPORTS_PER_SOL,
      });

      const recentBlockhash = await connection.getLatestBlockhash();

      const msg = new TransactionMessage({
        payerKey: new PublicKey("4JK7UiAuNvabjVCjLu4SjkgLv7ExETsyAX9imvBA6tQM"),
        recentBlockhash: recentBlockhash.blockhash,
        instructions: [nativeTransferInstruction],
      }).compileToV0Message();

      const transaction = new VersionedTransaction(msg);

      const serializedTx = bs58.encode(transaction.serialize());

      const { signature } = await solanaWallet.signer.signTransaction(serializedTx);

      const signatureBytes = bs58.decode(signature as string);

      transaction.addSignature(new PublicKey(solanaWallet.address), signatureBytes);

      console.log("transaction:", transaction);
      const sig = await connection.sendRawTransaction(transaction.serialize(), { maxRetries: 3 });

      console.log("sig:", sig);
      refetchBalance();
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
