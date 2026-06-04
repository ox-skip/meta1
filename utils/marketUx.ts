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
    return "The request took too long. Please check your connection and try again.";
  }
  if (msg.includes("network request failed") || msg.includes("failed to fetch")) {
    return "Network connection issue. Please try again.";
  }
  if (msg.includes("rpc_url missing")) {
    return raw;
  }
  if (msg.includes("chain config missing")) {
    return raw;
  }
  if (msg.includes("insufficient")) {
    return "Insufficient wallet balance for this action.";
  }
  if (msg.includes("max trade") || msg.includes("max size")) {
    return "Trade amount is above the current on-chain max size. Reduce amount and try again.";
  }
  if (msg.includes("cooldown")) {
    return "Trade cooldown is active for this stock. Wait a few seconds and retry.";
  }
  if (msg.includes("twap deviation")) {
    return "Price moved too far from TWAP. Wait briefly and retry with a smaller amount.";
  }
  if (msg.includes("too little received") || msg.includes("insufficient output amount")) {
    return "Price moved during quote. Reduce amount and retry.";
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
    return raw;
  }
  if (msg.includes("create transaction reverted")) {
    return raw;
  }
  if (msg.includes("identity factory contract not found")) {
    return raw;
  }
  if (msg.includes("stable token contract not found")) {
    return raw;
  }

  return compact(raw);
}
