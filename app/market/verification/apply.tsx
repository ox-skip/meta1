import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { openBrowserAsync, WebBrowserPresentationStyle } from "expo-web-browser";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";

import AppHeader from "@/components/common/AppHeader";
import {
  startSellerVerification,
  syncSellerVerification,
  type MarketVerificationRequest,
} from "@/services/market/verification";
import { supabase } from "@/services/supabase";

const BG0 = "#05040B";
const BG1 = "#0A0620";
const PURPLE = "#7C3AED";
const BLUE = "#3B82F6";

type SellerProfile = {
  user_id: string;
  business_name: string | null;
  market_username: string | null;
  is_verified: boolean;
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View
      style={{
        marginTop: 12,
        borderRadius: 22,
        padding: 16,
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
      }}
    >
      <Text style={{ color: "#fff", fontWeight: "900", fontSize: 14 }}>{title}</Text>
      <View style={{ marginTop: 10 }}>{children}</View>
    </View>
  );
}

function pendingLabel(request: Pick<MarketVerificationRequest, "provider_review_status">) {
  const raw = String(request.provider_review_status ?? "").trim();
  if (raw === "In Progress") return "In progress";
  return "Waiting to start";
}

function StatusPill({ request }: { request: MarketVerificationRequest }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    PENDING: { bg: "rgba(59,130,246,0.16)", fg: "#93C5FD", label: pendingLabel(request) },
    IN_REVIEW: { bg: "rgba(14,165,233,0.16)", fg: "#7DD3FC", label: "Under review" },
    VERIFIED: { bg: "rgba(16,185,129,0.16)", fg: "#6EE7B7", label: "Verified" },
    REJECTED: { bg: "rgba(239,68,68,0.16)", fg: "#FCA5A5", label: "Rejected" },
    RESUBMISSION_REQUIRED: { bg: "rgba(245,158,11,0.16)", fg: "#FCD34D", label: "Retry required" },
    EXPIRED: { bg: "rgba(148,163,184,0.16)", fg: "#CBD5E1", label: "Expired" },
  };
  const s = map[request.status] ?? { bg: "rgba(255,255,255,0.08)", fg: "#E5E7EB", label: request.status };
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

function ctaLabel(reqRow: MarketVerificationRequest | null) {
  if (!reqRow) return "Start verification";
  if (reqRow.status === "RESUBMISSION_REQUIRED" || reqRow.status === "REJECTED" || reqRow.status === "EXPIRED") {
    return "Retry verification";
  }
  if (reqRow.status === "VERIFIED") return "Verified";
  return "Continue verification";
}

function isVerificationLinkUsable(reqRow: MarketVerificationRequest | null) {
  if (!reqRow) return false;
  if (reqRow.status === "VERIFIED") return false;
  const url = String(reqRow.verification_url || "").trim();
  if (!url) return false;
  const expiresAtMs = reqRow.verification_url_expires_at
    ? new Date(reqRow.verification_url_expires_at).getTime()
    : Number.NaN;
  if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) return false;
  return true;
}

export default function VerificationApply() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [reqRow, setReqRow] = useState<MarketVerificationRequest | null>(null);

  const canSubmit = useMemo(() => {
    if (!profile) return false;
    if (profile.is_verified) return false;
    return true;
  }, [profile]);

  async function load(options: { sync?: boolean } = {}) {
    setLoading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) {
        router.replace("/(auth)/login" as any);
        return;
      }

      const { data: sp, error: spErr } = await supabase
        .from("market_seller_profiles")
        .select("user_id,business_name,market_username,is_verified")
        .eq("user_id", uid)
        .maybeSingle();

      const nextProfile = spErr ? null : (sp as SellerProfile | null);
      setProfile(nextProfile);

      const { data: vr } = await supabase
        .from("market_verification_requests")
        .select(
          "id,user_id,status,provider,verification_type,provider_level_name,provider_applicant_id,provider_external_user_id,provider_review_status,provider_review_answer,provider_review_reject_type,provider_reject_labels,country_code,document_type,verification_url,verification_url_expires_at,provider_last_event_type,provider_last_event_at,submitted_at,reviewed_at,verified_at,last_error,updated_at",
        )
        .eq("user_id", uid)
        .maybeSingle();

      const nextReqRow = (vr as MarketVerificationRequest | null) ?? null;
      setReqRow(nextReqRow);

      if (
        options.sync &&
        nextProfile &&
        !nextProfile.is_verified &&
        nextReqRow?.provider === "didit" &&
        nextReqRow.provider_applicant_id
      ) {
        try {
          const synced = await syncSellerVerification();
          if (synced.request) setReqRow(synced.request);
          if (synced.verified) {
            setProfile((prev) => (prev ? { ...prev, is_verified: true } : prev));
          }
        } catch (e: any) {
          console.warn("[market-verification] sync failed", e?.message || e);
        }
      }
    } catch {
      setProfile(null);
      setReqRow(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load({ sync: true });
  }, []);

  async function submit() {
    setSubmitError(null);

    if (!profile) {
      Alert.alert("Create seller profile", "You need a market seller profile before starting verification.", [
        { text: "Cancel", style: "cancel" },
        { text: "Create profile", onPress: () => router.push("/market/profile/create" as any) },
      ]);
      return;
    }

    if (profile.is_verified) {
      Alert.alert("Already verified", "Your seller account is already verified.");
      return;
    }

    if (isVerificationLinkUsable(reqRow)) {
        try {
          await openBrowserAsync(String(reqRow?.verification_url || "").trim(), {
            presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
          });
          await load({ sync: true });
          router.replace("/market/verification/status" as any);
          return;
      } catch (e: any) {
        const message = String(e?.message || "Could not reopen verification session.");
        setSubmitError(message);
        Alert.alert("Failed", message);
        return;
      }
    }

    setBusy(true);
    try {
      const result = await startSellerVerification();
      if (result.verified) {
        await load();
        router.replace("/market/verification/status" as any);
        return;
      }

      const verificationUrl = String(result.verification_url || "").trim();
      if (!verificationUrl) throw new Error("Verification session was created without a launch URL");

      await load();
      await openBrowserAsync(verificationUrl, {
        presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
      });
      await load({ sync: true });
      router.replace("/market/verification/status" as any);
    } catch (e: any) {
      const backendMessage =
        e?.details?.json?.error ||
        e?.details?.json?.message ||
        (typeof e?.details?.text === "string" && e.details.text.length < 300 ? e.details.text : null);
      const message =
        typeof e?.message === "string" && !/non-2xx status code/i.test(e.message)
          ? e.message
          : String(backendMessage || e?.message || "Could not start verification.");
      console.error("[market-verification] start failed", {
        message,
        details: e?.details ?? null,
      });
      setSubmitError(message);
      Alert.alert("Failed", message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <LinearGradient
      colors={[BG1, BG0]}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={{ flex: 1, paddingHorizontal: 16, paddingTop: 14 }}
    >
      <AppHeader title="Government ID Verification" subtitle="Hosted by a third-party KYC provider" />
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
            <Text style={{ color: "#fff", fontSize: 22, fontWeight: "900" }}>Government ID Verification</Text>
            <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
              Global government-issued ID check
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={{ marginTop: 40, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.7)" }}>Loading...</Text>
          </View>
        ) : !profile ? (
          <Card title="You need a seller profile">
            <Text style={{ color: "rgba(255,255,255,0.7)", lineHeight: 20 }}>
              Create your market seller profile first, then start verification.
            </Text>

            <Pressable
              onPress={() => router.push("/market/profile/create" as any)}
              style={{
                marginTop: 12,
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
          </Card>
        ) : (
          <>
            <Card title="Seller account">
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>
                {profile.business_name || `@${profile.market_username || "yourstore"}`}
              </Text>
              <View style={{ marginTop: 6, flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ color: "rgba(255,255,255,0.65)" }}>Current badge:</Text>
                {profile.is_verified ? (
                  <Ionicons name="checkmark-circle" size={16} color={BLUE} />
                ) : (
                  <Text style={{ color: "rgba(255,255,255,0.65)" }}>Not verified</Text>
                )}
              </View>

              {reqRow ? (
                <View style={{ marginTop: 12 }}>
                  <StatusPill request={reqRow} />
                  {!!reqRow.provider_review_status ? (
                    <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.75)", lineHeight: 20 }}>
                      Provider status: {reqRow.provider_review_status}
                    </Text>
                  ) : null}
                  {!!reqRow.document_type ? (
                    <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.75)", lineHeight: 20 }}>
                      Document type: {reqRow.document_type}
                    </Text>
                  ) : null}
                  {!!reqRow.last_error ? (
                    <Text style={{ marginTop: 10, color: "#FCA5A5", lineHeight: 20 }}>
                      Provider note: {reqRow.last_error}
                    </Text>
                  ) : null}
                </View>
              ) : (
                <Text style={{ marginTop: 12, color: "rgba(255,255,255,0.65)" }}>
                  No verification session yet. Start below.
                </Text>
              )}
            </Card>

            <Card title="What counts">
              <Text style={{ color: "rgba(255,255,255,0.7)", lineHeight: 20 }}>
                Use a government-issued ID supported in your country. This usually includes passport, national ID
                card, driver's license, or residence permit.
              </Text>
              <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.7)", lineHeight: 20 }}>
                Some countries also support country-specific methods. For example, Nigerian sellers may be offered
                NIN where the provider supports it.
              </Text>
              <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.7)", lineHeight: 20 }}>
                BestCity does not store your raw ID document. We only store the verification result and provider
                reference needed to mark your store as verified.
              </Text>
            </Card>

            <Card title="Start with provider">
              <Text style={{ color: "rgba(255,255,255,0.7)", lineHeight: 20 }}>
                Verifcation opens in a secure browser session. Once the provider finishes review, their webhook
                updates your seller badge automatically in our database.
              </Text>

              {!!submitError ? (
                <View
                  style={{
                    marginTop: 12,
                    borderRadius: 16,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    backgroundColor: "rgba(127,29,29,0.26)",
                    borderWidth: 1,
                    borderColor: "rgba(239,68,68,0.35)",
                  }}
                >
                  <Text style={{ color: "#FCA5A5", lineHeight: 20 }}>{submitError}</Text>
                </View>
              ) : null}

              <Pressable
                disabled={!canSubmit || busy}
                onPress={submit}
                style={{
                  marginTop: 12,
                  borderRadius: 18,
                  paddingVertical: 14,
                  alignItems: "center",
                  backgroundColor: !canSubmit || busy ? "rgba(124,58,237,0.35)" : PURPLE,
                  borderWidth: 1,
                  borderColor: !canSubmit || busy ? "rgba(124,58,237,0.35)" : PURPLE,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "900" }}>
                  {busy ? "Opening..." : ctaLabel(reqRow)}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => router.replace("/market/verification/status" as any)}
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
                <Text style={{ color: "#fff", fontWeight: "900" }}>Back to status</Text>
              </Pressable>
            </Card>
          </>
        )}
      </ScrollView>
    </LinearGradient>
  );
}
