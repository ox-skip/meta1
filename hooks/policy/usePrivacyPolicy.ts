import { useEffect, useState } from "react";
import { recordAuthSessionNotification } from "@/services/market/notifications";
import { supabase } from "@/services/supabase";
import { useAuth } from "@/hooks/authentication/useAuth";

export function usePrivacyPolicy() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [required, setRequired] = useState(false);

  useEffect(() => {
    if (!user) {
      console.log("[policy-acceptance] no user");
      setLoading(false);
      return;
    }

    let cancelled = false;

    const checkAcceptance = async () => {
      console.log("[policy-acceptance] checking acceptance for:", user.id);

      const { data, error } = await supabase
        .from("policy_acceptance")
        .select("expires_at")
        .eq("user_id", user.id)
        .order("accepted_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.error("[policy-acceptance] error:", error.message);
        setRequired(true);
      } else if (!data || new Date(data.expires_at) < new Date()) {
        console.log("[policy-acceptance] policy required");
        setRequired(true);
      } else {
        console.log("[policy-acceptance] policy still valid");
        setRequired(false);
      }

      setLoading(false);
    };

    checkAcceptance();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const accept = async () => {
    if (!user) return;

    const now = new Date();
    const expires = new Date();
    expires.setDate(now.getDate() + 7);

    console.log("[policy-acceptance] accepting policy");

    await supabase.from("policy_acceptance").insert({
      user_id: user.id,
      accepted_at: now.toISOString(),
      expires_at: expires.toISOString(),
    });

    setRequired(false);
  };

  const reject = async () => {
    console.log("[policy-acceptance] rejected - signing out");
    await recordAuthSessionNotification("signed_out").catch(() => undefined);
    await supabase.auth.signOut();
  };

  return { loading, required, accept, reject };
}
