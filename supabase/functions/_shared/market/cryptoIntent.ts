type AdminClient = {
  from: (table: string) => any;
};

type CryptoIntentInput = {
  orderId: string;
  intentType: "DEPOSIT" | "RELEASE" | "REFUND" | string;
  status: "CREATED" | "PROCESSING" | "SUBMITTED" | "CONFIRMED" | "FAILED" | string;
  chain?: string | null;
  fromWallet?: string | null;
  toWallet?: string | null;
  tokenAddress?: string | null;
  escrowAddress?: string | null;
  amountUnits?: number | string | null;
  amountRaw?: string | number | bigint | null;
  txHash?: string | null;
  failureReason?: string | null;
  clientReference?: string | null;
  orderKey?: string | null;
};

function cleanNullable(value: unknown) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

function cleanTxHash(value: unknown) {
  const text = cleanNullable(value);
  return text ? text.toLowerCase() : null;
}

function cleanAmountUnits(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanAmountRaw(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

export async function insertCryptoIntent(admin: AdminClient, input: CryptoIntentInput) {
  let chain = cleanNullable(input.chain);
  let tokenAddress = cleanNullable(input.tokenAddress);
  let escrowAddress = cleanNullable(input.escrowAddress);
  let orderKey = cleanNullable(input.orderKey);

  if (!chain || !tokenAddress || !escrowAddress || !orderKey) {
    const { data: esc, error: escErr } = await admin
      .from("market_crypto_escrows")
      .select("chain,token_address,escrow_address,order_key")
      .eq("order_id", input.orderId)
      .maybeSingle();

    if (escErr) return { data: null, error: escErr };

    chain = chain || cleanNullable(esc?.chain) || "base";
    tokenAddress = tokenAddress || cleanNullable(esc?.token_address);
    escrowAddress = escrowAddress || cleanNullable(esc?.escrow_address);
    orderKey = orderKey || cleanNullable(esc?.order_key);
  }

  return await admin
    .from("market_crypto_intents")
    .insert({
      order_id: input.orderId,
      intent_type: input.intentType,
      status: input.status,
      chain: chain || "base",
      from_wallet: cleanNullable(input.fromWallet),
      to_wallet: cleanNullable(input.toWallet),
      token_address: tokenAddress,
      escrow_address: escrowAddress,
      amount_units: cleanAmountUnits(input.amountUnits),
      amount_raw: cleanAmountRaw(input.amountRaw),
      client_reference: cleanNullable(input.clientReference),
      tx_hash: cleanTxHash(input.txHash),
      failure_reason: cleanNullable(input.failureReason),
      order_key: orderKey,
    })
    .select("*")
    .single();
}
