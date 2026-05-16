import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { openBrowserAsync, WebBrowserPresentationStyle } from "expo-web-browser";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppHeader from "@/components/common/AppHeader";
import {
  startSellerVerification,
  syncSellerVerification,
  type MarketVerificationRequest,
} from "@/services/market/verification";
import { supabase } from "@/services/supabase";

const BG0 = "#060807";
const BG1 = "#10130E";
const BG2 = "#171A13";
const PURPLE = "#8B5CF6";
const AMBER = "#F4B75D";
const TEAL = "#2DD4BF";
const BLUE = "#38BDF8";
const ROSE = "#FB7185";
const CARD = "rgba(255,253,247,0.065)";
const CARD_RAISED = "rgba(255,253,247,0.09)";
const BORDER = "rgba(255,253,247,0.12)";
const BORDER_TOP = "rgba(255,253,247,0.24)";
const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.68)";
const FAINT = "rgba(255,253,247,0.44)";

type SellerProfile = {
  user_id: string;
  business_name: string | null;
  market_username: string | null;
  is_verified: boolean;
};

function Card({
  title,
  icon,
  accent = PURPLE,
  children,
}: {
  title: string;
  icon?: keyof typeof Ionicons.glyphMap;
  accent?: string;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        borderRadius: 8,
        padding: 16,
        backgroundColor: CARD,
        borderWidth: 1,
        borderColor: BORDER,
        borderTopColor: BORDER_TOP,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {icon ? (
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: `${accent}18`,
              borderWidth: 1,
              borderColor: `${accent}36`,
            }}
          >
            <Ionicons name={icon} size={17} color={accent} />
          </View>
        ) : null}
        <Text style={{ color: TEXT, fontWeight: "900", fontSize: 14 }}>{title}</Text>
      </View>
      <View style={{ marginTop: 12 }}>{children}</View>
    </View>
  );
}

function InfoTile({
  icon,
  title,
  value,
  accent,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  value: string;
  accent: string;
}) {
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: 150,
        borderRadius: 8,
        padding: 12,
        backgroundColor: "rgba(255,255,255,0.045)",
        borderWidth: 1,
        borderColor: BORDER,
        minHeight: 92,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name={icon} size={17} color={accent} />
        <Text style={{ color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>{title}</Text>
      </View>
      <Text style={{ marginTop: 10, color: TEXT, fontWeight: "900", fontSize: 13, lineHeight: 18 }}>{value}</Text>
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
    PENDING: { bg: "rgba(56,189,248,0.14)", fg: BLUE, label: pendingLabel(request) },
    IN_REVIEW: { bg: "rgba(244,183,93,0.16)", fg: AMBER, label: "Under review" },
    VERIFIED: { bg: "rgba(45,212,191,0.15)", fg: TEAL, label: "Verified" },
    REJECTED: { bg: "rgba(251,113,133,0.16)", fg: "#FDA4AF", label: "Rejected" },
    RESUBMISSION_REQUIRED: { bg: "rgba(244,183,93,0.16)", fg: AMBER, label: "Retry required" },
    EXPIRED: { bg: "rgba(255,253,247,0.08)", fg: MUTED, label: "Expired" },
  };
  const s = map[request.status] ?? { bg: "rgba(255,255,255,0.08)", fg: TEXT, label: request.status };
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

function formatProvider(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return "Pending";
  return raw.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function VerificationApply() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 920;
  const contentMaxWidth = isDesktop ? 1120 : 720;
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

  const storeName = profile?.business_name || (profile?.market_username ? `@${profile.market_username}` : "Your store");
  const currentState = profile?.is_verified
    ? "Verified"
    : reqRow
      ? ctaLabel(reqRow).replace(" verification", "")
      : "Not started";

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
      colors={[BG2, BG1, BG0]}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={{ flex: 1 }}
    >
      <View style={{ flex: 1, paddingTop: Math.max(insets.top, 14), paddingHorizontal: isDesktop ? 24 : 14 }}>
        <View style={{ alignSelf: "center", width: "100%", maxWidth: contentMaxWidth }}>
          <AppHeader title="Seller verification" subtitle="Government ID trust badge" />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            alignSelf: "center",
            width: "100%",
            maxWidth: contentMaxWidth,
            paddingBottom: Math.max(insets.bottom, 18) + 24,
          }}
        >
          <View
            style={{
              marginTop: 8,
              flexDirection: isDesktop ? "row" : "column",
              alignItems: isDesktop ? "stretch" : "flex-start",
              gap: 14,
            }}
          >
            <View
              style={{
                flex: 1.35,
                minHeight: isDesktop ? 320 : undefined,
                borderRadius: 8,
                padding: isDesktop ? 22 : 18,
                backgroundColor: CARD_RAISED,
                borderWidth: 1,
                borderColor: BORDER,
                borderTopColor: BORDER_TOP,
                justifyContent: "space-between",
              }}
            >
              <View>
                <Pressable
                  onPress={() => router.back()}
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 8,
                    backgroundColor: "rgba(255,255,255,0.06)",
                    borderWidth: 1,
                    borderColor: BORDER,
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 18,
                  }}
                >
                  <Ionicons name="arrow-back" size={20} color={TEXT} />
                </Pressable>

                <Text style={{ color: TEXT, fontWeight: "900", fontSize: isDesktop ? 36 : 28, lineHeight: isDesktop ? 42 : 34 }}>
                  Verify your seller identity
                </Text>
                <Text style={{ marginTop: 12, color: MUTED, fontSize: 15, lineHeight: 22, maxWidth: 620 }}>
                  {storeName} can unlock the verified badge after the provider confirms a supported government ID.
                </Text>
              </View>

              <View style={{ marginTop: 22, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <InfoTile icon="storefront-outline" title="Store" value={storeName} accent={PURPLE} />
                <InfoTile icon="shield-checkmark-outline" title="State" value={currentState} accent={profile?.is_verified ? TEAL : AMBER} />
                <InfoTile icon="lock-closed-outline" title="Provider" value={formatProvider(reqRow?.provider || "Didit")} accent={BLUE} />
              </View>
            </View>

            <View style={{ width: isDesktop ? 330 : "100%", gap: 14 }}>
              <Card title="Session" icon="scan-outline" accent={BLUE}>
                {loading ? (
                  <View style={{ paddingVertical: 18, alignItems: "center" }}>
                    <ActivityIndicator />
                    <Text style={{ marginTop: 10, color: MUTED, fontWeight: "800" }}>Loading...</Text>
                  </View>
                ) : reqRow ? (
                  <View style={{ gap: 10 }}>
                    <StatusPill request={reqRow} />
                    <Text style={{ color: MUTED, lineHeight: 20 }}>
                      Provider status: {reqRow.provider_review_status || "Waiting"}
                    </Text>
                    {reqRow.document_type ? (
                      <Text style={{ color: MUTED, lineHeight: 20 }}>Document: {reqRow.document_type}</Text>
                    ) : null}
                  </View>
                ) : (
                  <Text style={{ color: MUTED, lineHeight: 20 }}>No verification session yet.</Text>
                )}
              </Card>

              <Card title="Privacy" icon="finger-print-outline" accent={TEAL}>
                <Text style={{ color: MUTED, lineHeight: 20 }}>
                  BestCity stores the result and provider reference only.
                </Text>
              </Card>
            </View>
          </View>

          {loading ? null : !profile ? (
            <View style={{ marginTop: 14 }}>
              <Card title="Create seller profile" icon="person-add-outline" accent={AMBER}>
                <Text style={{ color: MUTED, lineHeight: 20 }}>
                  Create your market seller profile first, then start verification.
                </Text>
                <Pressable
                  onPress={() => router.push("/market/profile/create" as any)}
                  style={{
                    marginTop: 14,
                    borderRadius: 8,
                    paddingVertical: 14,
                    alignItems: "center",
                    backgroundColor: PURPLE,
                    borderWidth: 1,
                    borderColor: PURPLE,
                  }}
                >
                  <Text style={{ color: TEXT, fontWeight: "900" }}>Create seller profile</Text>
                </Pressable>
              </Card>
            </View>
          ) : (
            <View
              style={{
                marginTop: 14,
                flexDirection: isDesktop ? "row" : "column",
                gap: 14,
                alignItems: "flex-start",
              }}
            >
              <View style={{ flex: 1, width: "100%", gap: 14 }}>
                <Card title="Accepted documents" icon="id-card-outline" accent={AMBER}>
                  <View style={{ gap: 10 }}>
                    {[
                      "Passport, national ID, driver's license, or residence permit.",
                      "Country-specific methods may appear when supported by the provider.",
                      "Your badge updates after provider review or webhook sync.",
                    ].map((item) => (
                      <View key={item} style={{ flexDirection: "row", gap: 9, alignItems: "flex-start" }}>
                        <Ionicons name="checkmark-circle-outline" size={18} color={TEAL} />
                        <Text style={{ flex: 1, color: MUTED, lineHeight: 20 }}>{item}</Text>
                      </View>
                    ))}
                  </View>
                </Card>

                {submitError ? (
                  <View
                    style={{
                      borderRadius: 8,
                      padding: 14,
                      backgroundColor: "rgba(251,113,133,0.12)",
                      borderWidth: 1,
                      borderColor: "rgba(251,113,133,0.35)",
                    }}
                  >
                    <Text style={{ color: "#FDA4AF", lineHeight: 20, fontWeight: "800" }}>{submitError}</Text>
                  </View>
                ) : null}
              </View>

              <View style={{ width: isDesktop ? 390 : "100%" }}>
                <Card title="Continue" icon="open-outline" accent={PURPLE}>
                  <Text style={{ color: MUTED, lineHeight: 20 }}>
                    The secure provider session opens in your browser.
                  </Text>

                  <Pressable
                    disabled={!canSubmit || busy}
                    onPress={submit}
                    style={{
                      marginTop: 14,
                      borderRadius: 8,
                      paddingVertical: 15,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: !canSubmit || busy ? "rgba(139,92,246,0.35)" : PURPLE,
                      borderWidth: 1,
                      borderColor: !canSubmit || busy ? "rgba(139,92,246,0.35)" : PURPLE,
                      flexDirection: "row",
                      gap: 9,
                    }}
                  >
                    {busy ? <ActivityIndicator color={TEXT} /> : <Ionicons name="shield-checkmark-outline" size={18} color={TEXT} />}
                    <Text style={{ color: TEXT, fontWeight: "900" }}>{busy ? "Opening..." : ctaLabel(reqRow)}</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => router.replace("/market/verification/status" as any)}
                    style={{
                      marginTop: 10,
                      borderRadius: 8,
                      paddingVertical: 14,
                      alignItems: "center",
                      backgroundColor: "rgba(255,255,255,0.06)",
                      borderWidth: 1,
                      borderColor: BORDER,
                    }}
                  >
                    <Text style={{ color: TEXT, fontWeight: "900" }}>View status</Text>
                  </Pressable>
                </Card>
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </LinearGradient>
  );
}
