import { useEffect, useState } from "react";
import { createListing, type CreateListingInput } from "@/services/market/marketService";

function friendly(err: any) {
  const status = err?.context?.status;
  const body = err?.context?.body;
  try {
    const parsed = typeof body === "string" ? JSON.parse(body) : body;
    if (parsed?.message) return parsed.message;
  } catch {
    // ignore parse errors
  }
  if (status === 401) return "Please sign in to continue.";
  return "We couldn't complete your request right now. Please try again.";
}

export type Listing = any;
export type Order = any;

export function useMarket() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);

  const refreshListings = async () => {
    setListings((prev) => prev);
  };

  const refreshOrders = async () => {
    setOrders((prev) => prev);
  };

  const placeOrder = async (_listing_id: string, _payment_method: "wallet" | "crypto") => {
    const msg = "Open checkout to place this order.";
    setError(msg);
    throw new Error(msg);
  };

  const addListing = async (payload: CreateListingInput) => {
    setLoading(true);
    setError(null);
    try {
      const out = await createListing(payload);
      await refreshListings();
      return out;
    } catch (e: any) {
      const msg = friendly(e);
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  };

  const approve = async (_order_id: string) => {
    const msg = "Open the order details to approve this order.";
    setError(msg);
    throw new Error(msg);
  };

  useEffect(() => {
    refreshListings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { loading, error, listings, orders, refreshListings, refreshOrders, placeOrder, addListing, approve };
}
