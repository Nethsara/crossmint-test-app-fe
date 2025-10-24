import { NextRequest, NextResponse } from "next/server";

const CROSSMINT_SERVER_SIDE_API_KEY = process.env.CROSSMINT_SERVER_SIDE_API_KEY as string;
const CROSSMINT_ENV = process.env.CROSSMINT_ENV || "staging";
const USDC_LOCATOR = `${process.env.NEXT_PUBLIC_CHAIN_ID}:${process.env.NEXT_PUBLIC_USDC_MINT}:${process.env.NEXT_PUBLIC_USDC_MINT}`;

export async function POST(req: NextRequest) {
  try {
    if (!CROSSMINT_SERVER_SIDE_API_KEY) {
      return NextResponse.json(
        { error: "Server misconfiguration: CROSSMINT_SERVER_SIDE_API_KEY missing" },
        { status: 500 }
      );
    }

    const body = await req.json();
    const {
      amount,
      receiptEmail,
      walletAddress,
    } = body;

    const response = await fetch(
      `https://${CROSSMINT_ENV}.crossmint.com/api/2022-06-09/orders`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": CROSSMINT_SERVER_SIDE_API_KEY,
        },
        body: JSON.stringify({
          lineItems: [
            {
              tokenLocator: USDC_LOCATOR,
              executionParameters: {
                mode: "exact-in",
                amount,
              },
            },
          ],
          payment: {
            method: "checkoutcom-flow",
            receiptEmail,
          },
          recipient: {
            walletAddress,
          },
        }),
      }
    );

    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json(
        { error: data?.error || "Failed to create order", details: data },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json(
      { error: "Unexpected error creating order", details: error?.message },
      { status: 500 }
    );
  }
}

