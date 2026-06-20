function asText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function pickErrorMessage(error: unknown) {
  const e = error as any;
  const candidates = [
    e?.details?.json?.message,
    e?.details?.json?.error,
    e?.data?.message,
    e?.data?.error,
    e?.shortMessage,
    e?.details,
    e?.cause?.shortMessage,
    e?.cause?.details,
    e?.cause?.message,
    e?.message,
    error,
  ];

  for (const candidate of candidates) {
    const text = asText(candidate);
    if (text && text !== "[object Object]") return text;
  }
  return "";
}

function compact(text: string, limit = 280) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > limit ? `${cleaned.slice(0, limit - 3)}...` : cleaned;
}

export function friendlyMarketError(error: unknown, fallback = "Something went wrong. Please try again."): string {
  const raw = pickErrorMessage(error);
  if (!raw) return fallback;

  const msg = raw.toLowerCase();
  if (
    msg.includes("listing created") ||
    msg.includes("listing saved") ||
    msg.includes("listing is live") ||
    msg.includes("already live")
  ) {
    return raw;
  }
  if (msg.includes("invalid jwt") || msg.includes("session expired") || msg.includes("jwt")) {
    return "Your session expired. Please sign in again.";
  }
  if (msg.includes("non-2xx") || msg.includes("edge function")) {
    return "We couldn't complete this request right now. Please try again.";
  }
  if (msg.includes("timeout") || msg.includes("aborted")) {
    return "The request took too long. Please retry in a moment.";
  }
  if (msg.includes("network request failed") || msg.includes("failed to fetch")) {
    return "Marketplace server request failed. Please retry in a moment.";
  }
  if (msg.includes("circle") && msg.includes("credential")) {
    return compact(raw);
  }
  if (
    msg.includes("circle transaction was submitted") ||
    (msg.includes("circle") && msg.includes("submitted")) ||
    msg.includes("network has is not aviable") ||
    msg.includes("refershing in a momnt") ||
    msg.includes("unknown module")
  ) {
    return "Circle transaction was submitted, but the network transaction hash is not available yet. Try refreshing in a moment.";
  }
  if (msg === "invalid credentials." || msg === "invalid credentials") {
    return "Circle wallet credentials were rejected. Check the Circle API key/endpoint pair in Supabase secrets and redeploy the function.";
  }
  if (msg.includes("market_listings_price_amount_check") || msg.includes("price_amount must be > 0")) {
    return "Enter a listing price above zero.";
  }
  if (msg.includes("wallet/rpc failed") || msg.includes("provider error")) {
    return "Wallet or network provider could not complete the request. Reconnect wallet and try again.";
  }
  if (msg.includes("rpc") || msg.includes("rpc_url")) {
    return "Network provider is not ready for this market. Please try again after the chain settings are updated.";
  }
  if (msg.includes("chain config missing")) {
    return "Chain settings are not ready for this market yet.";
  }
  if (msg.includes("identity_liquidity_manager") || msg.includes("identity_ownership_controller")) {
    return "Stock market settings are not ready on this network yet.";
  }
  if (msg.includes("admin signing key") || msg.includes("stock_admin_private_key") || msg.includes("identity_admin_private_key")) {
    return "Stock market settings are not ready on this network yet.";
  }
  if (msg.includes("insufficient")) {
    return "Insufficient wallet balance for this action.";
  }
  if (msg.includes("max trade") || msg.includes("max size")) {
    return "Trade amount is above the current market limit. Reduce amount and try again.";
  }
  if (msg.includes("cooldown")) {
    return "Trade cooldown is active for this stock. Wait a few seconds and retry.";
  }
  if (msg.includes("twap deviation")) {
    return "Price moved too quickly. Wait briefly and retry with a smaller amount.";
  }
  if (msg.includes("too little received") || msg.includes("insufficient output amount")) {
    return "Price moved during review. Reduce amount and retry.";
  }
  if (msg.includes("row-level security") || msg.includes("permission") || msg.includes("policy")) {
    return "This action is currently blocked by permissions. Please contact support if it keeps happening.";
  }
  if (msg.includes("order not found")) {
    return "Order not found. Refresh and try again.";
  }
  if (msg.includes("not your order")) {
    return "You can only perform this action on your own order.";
  }
  if (msg.includes("cannot create stock yet")) {
    return compact(raw.replace(/on-chain/gi, "network").replace(/contract/gi, "market").replace(/factory/gi, "launch"));
  }
  if (msg.includes("create transaction reverted")) {
    return "The launch was not accepted by the market rules. Review the details and try again.";
  }
  if (msg.includes("identity factory contract not found")) {
    return "Stock launch settings are not ready on this network.";
  }
  if (msg.includes("stable token contract not found")) {
    return "Payment token settings are not ready on this network.";
  }

  return compact(raw.replace(/on-chain/gi, "network").replace(/RPC/gi, "network"));
}
