import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppHeader from "@/components/common/AppHeader";
import { syncSellerVerification, type MarketVerificationRequest } from "@/services/market/verification";
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
  is_verified: boolean;
  payout_tier: "standard" | "fast";
};

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

function fmtDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString();
}

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

function DetailRow({
  label,
  value,
  accent = BLUE,
}: {
  label: string;
  value?: string | null;
  accent?: string;
}) {
  if (!value) return null;
  return (
    <View
      style={{
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: "rgba(255,255,255,0.07)",
        flexDirection: "row",
        gap: 12,
        alignItems: "flex-start",
      }}
    >
      <View style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: accent, marginTop: 6 }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>{label}</Text>
        <Text style={{ marginTop: 4, color: MUTED, lineHeight: 20 }}>{value}</Text>
      </View>
    </View>
  );
}

function stageMeta(profile: SellerProfile | null, verified: boolean, reqRow: MarketVerificationRequest | null) {
  if (!profile) return { icon: "person-add-outline" as const, color: AMBER, label: "Storefront needed" };
  if (verified) return { icon: "checkmark-circle" as const, color: TEAL, label: "Verified" };
  if (!reqRow) return { icon: "ellipse-outline" as const, color: FAINT, label: "Not started" };
  if (reqRow.status === "REJECTED") return { icon: "close-circle" as const, color: ROSE, label: "Rejected" };
  if (reqRow.status === "RESUBMISSION_REQUIRED") return { icon: "refresh-circle" as const, color: AMBER, label: "Retry required" };
  if (reqRow.status === "EXPIRED") return { icon: "time-outline" as const, color: MUTED, label: "Expired" };
  return { icon: "hourglass-outline" as const, color: BLUE, label: "In progress" };
}

export default function VerificationStatus() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 920;
  const contentMaxWidth = isDesktop ? 1120 : 720;
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [reqRow, setReqRow] = useState<MarketVerificationRequest | null>(null);

  const verified = Boolean(profile?.is_verified);

  const headline = useMemo(() => {
    if (!profile) return "Store profile needed";
    if (verified) return "Verified";
    if (!reqRow) return "Not started";
    if (reqRow.status === "PENDING") {
      return String(reqRow.provider_review_status ?? "").trim() === "In Progress"
        ? "Verification in progress"
        : "Ready to start";
    }
    if (reqRow.status === "IN_REVIEW") return "Review in progress";
    if (reqRow.status === "REJECTED") return "Verification rejected";
    if (reqRow.status === "RESUBMISSION_REQUIRED") return "Retry required";
    if (reqRow.status === "EXPIRED") return "Session expired";
    return "Verification";
  }, [profile, verified, reqRow]);

  const stage = stageMeta(profile, verified, reqRow);
  const storeName = profile?.business_name || "Your store";

  async function load(options: { sync?: boolean } = {}) {
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

      const nextProfile = (sp as SellerProfile | null) ?? null;
      setProfile(nextProfile);

      const { data: vr } = await supabase
        .from("market_verification_requests")
        .select(
          "id,user_id,status,provider,verification_type,provider_level_name,provider_applicant_id,provider_external_user_id,provider_review_status,provider_review_answer,provider_review_reject_type,provider_reject_labels,country_code,document_type,verification_url,verification_url_expires_at,provider_last_event_type,provider_last_event_at,submitted_at,reviewed_at,verified_at,last_error,updated_at",
        )
        .eq("user_id", me)
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

  return (
    <LinearGradient
      colors={[BG2, BG1, BG0]}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={{ flex: 1 }}
    >
      <View style={{ flex: 1, paddingTop: Math.max(insets.top, 14), paddingHorizontal: isDesktop ? 24 : 14 }}>
        <View style={{ alignSelf: "center", width: "100%", maxWidth: contentMaxWidth }}>
          <AppHeader title="Store verification" subtitle="Verified badge status" />
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
          <View style={{ marginTop: 8, flexDirection: isDesktop ? "row" : "column", gap: 14 }}>
            <View
              style={{
                flex: 1.2,
                minHeight: isDesktop ? 300 : undefined,
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

                <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <View
                    style={{
                      width: 54,
                      height: 54,
                      borderRadius: 8,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: `${stage.color}18`,
                      borderWidth: 1,
                      borderColor: `${stage.color}40`,
                    }}
                  >
                    <Ionicons name={stage.icon} size={26} color={stage.color} />
                  </View>
                  <View style={{ flex: 1, minWidth: 220 }}>
                    <Text style={{ color: TEXT, fontWeight: "900", fontSize: isDesktop ? 34 : 27, lineHeight: isDesktop ? 40 : 33 }}>
                      {headline}
                    </Text>
                    <Text style={{ marginTop: 6, color: MUTED, fontSize: 14, lineHeight: 20 }}>{storeName}</Text>
                  </View>
                </View>
              </View>

              <View style={{ marginTop: 24, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <View
                  style={{
                    flexGrow: 1,
                    flexBasis: 160,
                    borderRadius: 8,
                    padding: 12,
                    backgroundColor: "rgba(255,255,255,0.045)",
                    borderWidth: 1,
                    borderColor: BORDER,
                  }}
                >
                  <Text style={{ color: FAINT, fontWeight: "900", fontSize: 11, textTransform: "uppercase" }}>Badge</Text>
                  <Text style={{ marginTop: 8, color: stage.color, fontWeight: "900", fontSize: 15 }}>{stage.label}</Text>
                </View>
                <View
                  style={{
                    flexGrow: 1,
                    flexBasis: 160,
                    borderRadius: 8,
                    padding: 12,
                    backgroundColor: "rgba(255,255,255,0.045)",
                    borderWidth: 1,
                    borderColor: BORDER,
                  }}
                >
                  <Text style={{ color: FAINT, fontWeight: "900", fontSize: 11, textTransform: "uppercase" }}>Payout</Text>
                  <Text style={{ marginTop: 8, color: TEXT, fontWeight: "900", fontSize: 15 }}>{profile?.payout_tier || "standard"}</Text>
                </View>
              </View>
            </View>

            <View style={{ width: isDesktop ? 360 : "100%", gap: 14 }}>
              <Card title="Actions" icon="shield-checkmark-outline" accent={PURPLE}>
                {loading ? (
                  <View style={{ paddingVertical: 18, alignItems: "center" }}>
                    <ActivityIndicator />
                    <Text style={{ marginTop: 10, color: MUTED, fontWeight: "800" }}>Loading...</Text>
                  </View>
                ) : !profile ? (
                  <Pressable
                    onPress={() => router.push("/market/profile/create" as any)}
                    style={{
                      borderRadius: 8,
                      paddingVertical: 14,
                      alignItems: "center",
                      backgroundColor: PURPLE,
                      borderWidth: 1,
                      borderColor: PURPLE,
                    }}
                  >
                    <Text style={{ color: TEXT, fontWeight: "900" }}>Set up storefront</Text>
                  </Pressable>
                ) : (
                  <>
                    <Pressable
                      onPress={() => router.push("/market/verification/apply" as any)}
                      style={{
                        borderRadius: 8,
                        paddingVertical: 14,
                        alignItems: "center",
                        backgroundColor: PURPLE,
                        borderWidth: 1,
                        borderColor: PURPLE,
                      }}
                    >
                      <Text style={{ color: TEXT, fontWeight: "900" }}>{reqRow ? "Continue identity check" : "Start identity check"}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => load({ sync: true })}
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
                      <Text style={{ color: TEXT, fontWeight: "900" }}>Refresh status</Text>
                    </Pressable>
                  </>
                )}
              </Card>

              {reqRow ? (
                <Card title="Review status" icon="scan-outline" accent={BLUE}>
                  <StatusPill request={reqRow} />
                  <Text style={{ marginTop: 10, color: MUTED, lineHeight: 20 }}>
                    {reqRow.provider_review_status || "Waiting for review update"}
                  </Text>
                </Card>
              ) : null}
            </View>
          </View>

          {!loading ? (
            <View style={{ marginTop: 14, flexDirection: isDesktop ? "row" : "column", gap: 14, alignItems: "flex-start" }}>
              <View style={{ flex: 1, width: "100%" }}>
                <Card title="Verification details" icon="document-text-outline" accent={AMBER}>
                  {reqRow ? (
                    <>
                      <DetailRow label="Review partner" value={reqRow.provider} accent={BLUE} />
                      <DetailRow label="Review status" value={reqRow.provider_review_status} accent={AMBER} />
                      <DetailRow label="Document" value={reqRow.document_type} accent={PURPLE} />
                      <DetailRow label="Country" value={reqRow.country_code} accent={TEAL} />
                      <DetailRow label="Started" value={fmtDate(reqRow.submitted_at)} accent={BLUE} />
                      <DetailRow label="Last update" value={fmtDate(reqRow.provider_last_event_at)} accent={AMBER} />
                      <DetailRow label="Verified at" value={fmtDate(reqRow.verified_at)} accent={TEAL} />
                      <DetailRow label="Review note" value={reqRow.last_error} accent={ROSE} />
                    </>
                  ) : (
                    <Text style={{ color: MUTED, lineHeight: 20 }}>
                      Start the secure identity check to begin verification.
                    </Text>
                  )}
                </Card>
              </View>

              <View style={{ width: isDesktop ? 360 : "100%" }}>
                <Card title="What happens next" icon="git-branch-outline" accent={TEAL}>
                  <View style={{ gap: 10 }}>
                    {[
                      "Open the secure review and submit a supported ID.",
                      "Return here and refresh if the webhook is still pending.",
                      "Your verified badge updates automatically after approval.",
                    ].map((item) => (
                      <View key={item} style={{ flexDirection: "row", gap: 9, alignItems: "flex-start" }}>
                        <Ionicons name="checkmark-circle-outline" size={18} color={TEAL} />
                        <Text style={{ flex: 1, color: MUTED, lineHeight: 20 }}>{item}</Text>
                      </View>
                    ))}
                  </View>
                </Card>
              </View>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </LinearGradient>
  );
}
