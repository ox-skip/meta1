import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchMarketPolicyBlocks,
  MarketPolicyAudience,
  MarketPolicyBlock,
  MarketPolicySection,
  MarketPolicySurface,
  subscribeMarketPolicyBlocks,
} from "@/hooks/policy/fetchMarketPolicyBlocks";

type UseInput = {
  surface: MarketPolicySurface;
  audience: MarketPolicyAudience;
  orderStatus?: string | null;
};

export function useMarketPolicyBlocks(input: UseInput) {
  const [rows, setRows] = useState<MarketPolicyBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const normalizedStatus = String(input.orderStatus || "").trim().toUpperCase() || null;

  const load = useCallback(
    async (showLoading = false) => {
      if (showLoading) setLoading(true);
      try {
        const next = await fetchMarketPolicyBlocks({
          surface: input.surface,
          audience: input.audience,
          orderStatus: normalizedStatus,
        });
        setRows(next);
        setError(null);
      } catch (e: any) {
        setError(String(e?.message || "Unable to load policy blocks"));
      } finally {
        setLoading(false);
      }
    },
    [input.surface, input.audience, normalizedStatus],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    const unsub = subscribeMarketPolicyBlocks(input.surface, () => {
      void load(false);
    });
    return unsub;
  }, [input.surface, load]);

  const bySection = useMemo(() => {
    const grouped: Record<MarketPolicySection, MarketPolicyBlock[]> = {
      flow: [],
      status_guidance: [],
      safety: [],
      progress: [],
    };
    for (const row of rows) {
      if (grouped[row.section]) grouped[row.section].push(row);
    }
    return grouped;
  }, [rows]);

  return { rows, bySection, loading, error, reload: load };
}
