import { supabase } from "@/services/supabase";

export type MarketPolicySurface = "checkout" | "order";
export type MarketPolicyAudience = "buyer" | "seller" | "both";
export type MarketPolicySeverity = "info" | "success" | "warn" | "danger";
export type MarketPolicySection = "flow" | "status_guidance" | "safety" | "progress";

export type MarketPolicyBlock = {
  id: string;
  key: string;
  surface: MarketPolicySurface;
  section: MarketPolicySection;
  audience: MarketPolicyAudience;
  order_status: string | null;
  severity: MarketPolicySeverity;
  title: string;
  body: string | null;
  bullets: string[];
  cta_label: string | null;
  cta_action: string | null;
  sort_order: number;
  active: boolean;
  updated_at: string;
};

type FetchInput = {
  surface: MarketPolicySurface;
  audience: MarketPolicyAudience;
  orderStatus?: string | null;
};

function parseBullets(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function normalizeRow(row: any): MarketPolicyBlock | null {
  const id = String(row?.id || "").trim();
  const key = String(row?.key || "").trim();
  const surface = String(row?.surface || "").trim() as MarketPolicySurface;
  const section = String(row?.section || "").trim() as MarketPolicySection;
  const audience = String(row?.audience || "").trim() as MarketPolicyAudience;
  const severity = String(row?.severity || "").trim() as MarketPolicySeverity;
  const title = String(row?.title || "").trim();
  if (!id || !key || !title) return null;

  return {
    id,
    key,
    surface,
    section,
    audience,
    order_status: row?.order_status ? String(row.order_status).toUpperCase() : null,
    severity,
    title,
    body: row?.body ? String(row.body) : null,
    bullets: parseBullets(row?.bullets),
    cta_label: row?.cta_label ? String(row.cta_label) : null,
    cta_action: row?.cta_action ? String(row.cta_action) : null,
    sort_order: Number.isFinite(Number(row?.sort_order)) ? Number(row.sort_order) : 100,
    active: row?.active !== false,
    updated_at: String(row?.updated_at || ""),
  };
}

function appliesToAudience(rowAudience: MarketPolicyAudience, audience: MarketPolicyAudience) {
  if (rowAudience === "both") return true;
  return rowAudience === audience;
}

function appliesToStatus(rowStatus: string | null, orderStatus: string | null) {
  if (!rowStatus) return true;
  const wanted = String(orderStatus || "").trim().toUpperCase();
  return rowStatus === wanted;
}

export async function fetchMarketPolicyBlocks(input: FetchInput): Promise<MarketPolicyBlock[]> {
  const orderStatus = String(input.orderStatus || "").trim().toUpperCase() || null;
  const { data, error } = await supabase
    .from("market_policy_entries")
    .select(
      "id,key,surface,section,audience,order_status,severity,title,body,bullets,cta_label,cta_action,sort_order,active,updated_at",
    )
    .eq("surface", input.surface)
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);

  const rows = (data ?? [])
    .map(normalizeRow)
    .filter((row): row is MarketPolicyBlock => !!row)
    .filter((row) => appliesToAudience(row.audience, input.audience))
    .filter((row) => appliesToStatus(row.order_status, orderStatus))
    .sort((a, b) => a.sort_order - b.sort_order);

  return rows;
}

export function subscribeMarketPolicyBlocks(surface: MarketPolicySurface, onChanged: () => void) {
  const channel = supabase
    .channel(`market-policy-${surface}-${Date.now()}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "market_policy_entries", filter: `surface=eq.${surface}` },
      () => onChanged(),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
