type AdminClient = {
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data?: unknown; error?: any }>;
};

type ApplyChainDepositInput = {
  orderId: string;
  chain?: string | null;
  buyerWallet?: string | null;
  sellerWallet?: string | null;
  amountRaw?: string | bigint | number | null;
  amountUnits?: number | null;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockTime?: string | null;
  raw: unknown;
  tokenAddress?: string | null;
};

function clean(value: unknown) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

function cleanHash(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function insertDepositEvent(admin: AdminClient, row: Record<string, unknown>) {
  const txHash = String(row.tx_hash || "");
  const orderId = String(row.order_id || "");

  const existing = await admin
    .from("market_chain_events")
    .select("id")
    .eq("order_id", orderId)
    .eq("tx_hash", txHash)
    .eq("event_type", "EscrowDeposited")
    .maybeSingle();

  if (existing.error && existing.error.code !== "PGRST116") return existing;
  if (existing.data?.id) return { data: existing.data, error: null };

  return await admin.from("market_chain_events").insert({
    ...row,
    event_type: "EscrowDeposited",
  });
}

export async function applyChainDeposit(admin: AdminClient, input: ApplyChainDepositInput) {
  const txHash = cleanHash(input.txHash);
  if (!txHash.startsWith("0x")) {
    return { data: null, error: new Error("Deposit tx_hash missing") };
  }

  const { data: order, error: orderErr } = await admin
    .from("market_orders")
    .select("id,status,version")
    .eq("id", input.orderId)
    .maybeSingle();
  if (orderErr) return { data: null, error: orderErr };
  if (!order?.id) return { data: null, error: new Error("Order not found") };

  const { data: esc, error: escErr } = await admin
    .from("market_crypto_escrows")
    .select("order_id,chain,token_address,escrow_address")
    .eq("order_id", input.orderId)
    .maybeSingle();
  if (escErr) return { data: null, error: escErr };
  if (!esc?.order_id) return { data: null, error: new Error("Crypto escrow mapping missing") };

  const chain = clean(input.chain) || clean(esc.chain) || "base";
  const blockTime = clean(input.blockTime) || new Date().toISOString();
  const amountRaw = input.amountRaw === null || input.amountRaw === undefined ? null : String(input.amountRaw);
  const amountUnits = asNumber(input.amountUnits, amountRaw ? Number(amountRaw) / 1_000_000 : 0);
  const tokenAddress = clean(input.tokenAddress) || clean(esc.token_address);

  const intentUpd = await admin
    .from("market_crypto_intents")
    .update({
      chain,
      status: "CONFIRMED",
      tx_hash: txHash,
      failure_reason: null,
    })
    .eq("order_id", input.orderId)
    .eq("intent_type", "DEPOSIT");
  if (intentUpd.error) return { data: null, error: intentUpd.error };

  const escrowUpdate: Record<string, unknown> = {
    chain,
    deposited_tx_hash: txHash,
    deposited_at: blockTime,
    amount_raw: amountRaw,
    amount_units: amountUnits,
  };
  if (tokenAddress) escrowUpdate.token_address = tokenAddress;

  const escUpd = await admin
    .from("market_crypto_escrows")
    .update(escrowUpdate)
    .eq("order_id", input.orderId);
  if (escUpd.error) return { data: null, error: escUpd.error };

  const eventRes = await insertDepositEvent(admin, {
    chain,
    order_id: input.orderId,
    tx_hash: txHash,
    log_index: asNumber(input.logIndex),
    block_number: asNumber(input.blockNumber),
    block_time: blockTime,
    buyer_wallet: clean(input.buyerWallet),
    seller_wallet: clean(input.sellerWallet),
    amount_raw: amountRaw,
    amount_units: amountUnits,
    raw: input.raw ?? {},
  });
  if (eventRes.error) return { data: null, error: eventRes.error };

  if (String(order.status || "").toUpperCase() === "CREATED") {
    const tr = await admin.rpc("market_transition_order_status", {
      p_order_id: input.orderId,
      p_expected_version: asNumber(order.version),
      p_new_status: "IN_ESCROW",
      p_note: `${String(chain).toUpperCase()} escrow deposit confirmed`,
    });

    if (tr.error) {
      const fallback = await admin
        .from("market_orders")
        .update({
          status: "IN_ESCROW",
          in_escrow_at: blockTime,
          version: asNumber(order.version) + 1,
        })
        .eq("id", input.orderId)
        .eq("status", "CREATED");
      if (fallback.error) return { data: null, error: fallback.error };
      return { data: { order_status: "IN_ESCROW", transition: "direct_fallback" }, error: null };
    }
  }

  return { data: { order_status: "IN_ESCROW", transition: "rpc" }, error: null };
}
