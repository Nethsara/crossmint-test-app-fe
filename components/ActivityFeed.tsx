import React from "react";
import { DepositButton } from "./common/DepositButton";
import Image from "next/image";
import { useActivityFeed } from "../hooks/useActivityFeed";
import { Container } from "./common/Container";
import { useWallet } from "@crossmint/client-sdk-react-ui";

interface ActivityFeedProps {
  onDepositClick: () => void;
}

export function ActivityFeed({ onDepositClick }: ActivityFeedProps) {
  const { data, isLoading, error } = useActivityFeed();
  const { wallet } = useWallet();
  return <></>;
}
