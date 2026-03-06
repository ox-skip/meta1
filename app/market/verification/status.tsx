import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import AppHeader from "@/components/common/AppHeader";
import type { MarketVerificationRequest } from "@/services/market/verification";
import { supabase } from "@/services/supabase";

const BG0 = "#05040B";
const BG1 = "#0A0620";
const PURPLE = "#7C3AED";
const BLUE = "#3B82F6";

type SellerProfile = {
  user_id: string;
  business_name: string | null;
  is_verified: boolean;
  payout_tier: "standard" | "fast";
};

function StatusPill({ status }: { status: MarketVerificationRequest["status"] }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    PENDING: { bg: "rgba(59,130,246,0.16)", fg: "#93C5FD", label: "Waiting to start" },
    IN_REVIEW: { bg: "rgba(14,165,233,0.16)", fg: "#7DD3FC", label: "Under review" },
    VERIFIED: { bg: "rgba(16,185,129,0.16)", fg: "#6EE7B7", label: "Verified" },
    REJECTED: { bg: "rgba(239,68,68,0.16)", fg: "#FCA5A5", label: "Rejected" },
    RESUBMISSION_REQUIRED: { bg: "rgba(245,158,11,0.16)", fg: "#FCD34D", label: "Retry required" },
    EXPIRED: { bg: "rgba(148,163,184,0.16)", fg: "#CBD5E1", label: "Expired" },
  };
  const s = map[status] ?? { bg: "rgba(255,255,255,0.08)", fg: "#E5E7EB", label: status };
  return (
    <View
      style={{
        alignSelf: "flex-start",
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: s.bg,
        borderWidth: 1,
        borderColor: `${s.fg}55`,
      }}
    >
      <Text style={{ color: s.fg, fontWeight: "900", fontSize: 12 }}>{s.label}</Text>
    </View>
  );
}

function fmtDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString();
}

export default function VerificationStatus() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [reqRow, setReqRow] = useState<MarketVerificationRequest | null>(null);

  const verified = Boolean(profile?.is_verified);

  const headline = useMemo(() => {
    if (!profile) return "No seller profile";
    if (verified) return "Verified";
    if (!reqRow) return "Not started";
    if (reqRow.status === "PENDING") return "Ready to start";
    if (reqRow.status === "IN_REVIEW") return "Provider review in progress";
    if (reqRow.status === "REJECTED") return "Verification rejected";
    if (reqRow.status === "RESUBMISSION_REQUIRED") return "Retry required";
    if (reqRow.status === "EXPIRED") return "Session expired";
    return "Verification";
  }, [profile, verified, reqRow]);

  async function load() {
    setLoading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const me = auth?.user?.id;
      if (!me) {
        router.replace("/(auth)/login" as any);
        return;
      }

      const { data: sp } = await supabase
        .from("market_seller_profiles")
        .select("user_id,business_name,is_verified,payout_tier")
        .eq("user_id", me)
        .maybeSingle();

      setProfile((sp as SellerProfile | null) ?? null);

      const { data: vr } = await supabase
        .from("market_verification_requests")
        .select(
          "id,user_id,status,provider,verification_type,provider_level_name,provider_applicant_id,provider_external_user_id,provider_review_status,provider_review_answer,provider_review_reject_type,provider_reject_labels,country_code,document_type,verification_url,verification_url_expires_at,provider_last_event_type,provider_last_event_at,submitted_at,reviewed_at,verified_at,last_error,updated_at",
        )
        .eq("user_id", me)
        .maybeSingle();

      setReqRow((vr as MarketVerificationRequest | null) ?? null);
    } catch {
      setProfile(null);
      setReqRow(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <LinearGradient
      colors={[BG1, BG0]}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={{ flex: 1, paddingHorizontal: 16, paddingTop: 14 }}
    >
      <AppHeader title="Verification" subtitle="Government ID status" />
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <Pressable
            onPress={() => router.back()}
            style={{
              width: 44,
              height: 44,
              borderRadius: 16,
              backgroundColor: "rgba(255,255,255,0.06)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.08)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>

          <View style={{ flex: 1 }}>
            <Text style={{ color: "#fff", fontSize: 22, fontWeight: "900" }}>Verification</Text>
            <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
              Government-issued ID trust badge
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={{ marginTop: 40, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.7)" }}>Loading...</Text>
          </View>
        ) : (
          <View
            style={{
              borderRadius: 22,
              padding: 16,
              backgroundColor: "rgba(255,255,255,0.05)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.08)",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>
              {profile?.business_name ? profile.business_name : "Your seller account"}
            </Text>

            <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Ionicons
                name={verified ? "checkmark-circle" : "alert-circle"}
                size={20}
                color={verified ? BLUE : "rgba(251,191,36,1)"}
              />
              <Text style={{ color: "#fff", fontWeight: "900" }}>{headline}</Text>
            </View>

            {reqRow ? (
              <View style={{ marginTop: 12 }}>
                <StatusPill status={reqRow.status} />

                {!!reqRow.provider ? (
                  <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.75)", lineHeight: 20 }}>
                    Provider: {reqRow.provider}
                  </Text>
                ) : null}

                {!!reqRow.document_type ? (
                  <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.75)", lineHeight: 20 }}>
                    Document: {reqRow.document_type}
                  </Text>
                ) : null}

                {!!reqRow.country_code ? (
                  <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.75)", lineHeight: 20 }}>
                    Country: {reqRow.country_code}
                  </Text>
                ) : null}

                {fmtDate(reqRow.submitted_at) ? (
                  <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
                    Started: {fmtDate(reqRow.submitted_at)}
                  </Text>
                ) : null}

                {fmtDate(reqRow.provider_last_event_at) ? (
                  <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
                    Last provider update: {fmtDate(reqRow.provider_last_event_at)}
                  </Text>
                ) : null}

                {fmtDate(reqRow.verified_at) ? (
                  <Text style={{ marginTop: 4, color: "#A7F3D0", fontSize: 12, fontWeight: "800" }}>
                    Verified at: {fmtDate(reqRow.verified_at)}
                  </Text>
                ) : null}

                {!!reqRow.last_error ? (
                  <Text style={{ marginTop: 10, color: "#FCA5A5", lineHeight: 20 }}>
                    Provider note: {reqRow.last_error}
                  </Text>
                ) : null}
              </View>
            ) : (
              <Text style={{ marginTop: 12, color: "rgba(255,255,255,0.65)", lineHeight: 20 }}>
                You have not started verification yet. Launch the provider session to begin.
              </Text>
            )}

            <Text style={{ marginTop: 12, color: "rgba(255,255,255,0.65)", lineHeight: 20 }}>
              Once the provider confirms your government ID, your seller profile is updated from `false` to `true`
              automatically.
            </Text>

            {!profile ? (
              <Pressable
                onPress={() => router.push("/market/profile/create" as any)}
                style={{
                  marginTop: 14,
                  borderRadius: 18,
                  paddingVertical: 14,
                  alignItems: "center",
                  backgroundColor: PURPLE,
                  borderWidth: 1,
                  borderColor: PURPLE,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "900" }}>Create seller profile</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => router.push("/market/verification/apply" as any)}
                style={{
                  marginTop: 14,
                  borderRadius: 18,
                  paddingVertical: 14,
                  alignItems: "center",
                  backgroundColor: PURPLE,
                  borderWidth: 1,
                  borderColor: PURPLE,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "900" }}>
                  {reqRow ? "Open verification flow" : "Start verification"}
                </Text>
              </Pressable>
            )}

            <Pressable
              onPress={load}
              style={{
                marginTop: 10,
                borderRadius: 18,
                paddingVertical: 14,
                alignItems: "center",
                backgroundColor: "rgba(255,255,255,0.06)",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.10)",
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "900" }}>Refresh</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </LinearGradient>
  );
}
