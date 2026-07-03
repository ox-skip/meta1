import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Linking,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  currentSiteDemoUrl,
  FALLBACK_LANDING_CONFIG,
  fetchPublicLandingPayload,
  type LandingConfig,
  type LandingDemoVideo,
  type PublicLandingPayload,
} from "@/services/market/landing";

const LOGO = require("@/assets/images/icon.png");

const BG = "#060807";
const SURFACE = "#0D120F";
const SURFACE_2 = "#101A16";
const PANEL = "rgba(255,253,247,0.06)";
const PANEL_STRONG = "rgba(255,253,247,0.10)";
const BORDER = "rgba(255,253,247,0.14)";
const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.70)";
const FAINT = "rgba(255,253,247,0.48)";
const TEAL = "#2DD4BF";
const GOLD = "#F4B75D";
const BLUE = "#38BDF8";
const GREEN = "#22C55E";
const ROSE = "#FB7185";
const INDIGO = "#A78BFA";

type Props = {
  demoOnly?: boolean;
};

function cleanText(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function formatMetric(value: unknown, compact = true) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return "0";
  if (compact && Math.abs(num) >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
  if (compact && Math.abs(num) >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (compact && Math.abs(num) >= 1_000) return `${(num / 1_000).toFixed(num >= 10_000 ? 0 : 1)}K`;
  return num.toLocaleString(undefined, { maximumFractionDigits: num >= 100 ? 0 : 2 });
}

function moneyMetric(value: unknown, currency = "USD") {
  const num = Number(value ?? 0);
  const safe = Number.isFinite(num) ? num : 0;
  if (safe >= 1_000_000) return `${currency} ${(safe / 1_000_000).toFixed(1)}M`;
  if (safe >= 1_000) return `${currency} ${(safe / 1_000).toFixed(safe >= 10_000 ? 0 : 1)}K`;
  return `${currency} ${safe.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function openHref(href?: string | null) {
  const clean = cleanText(href);
  if (!clean) return;
  if (clean.startsWith("#")) {
    if (typeof window !== "undefined" && window.location) {
      window.location.hash = clean.slice(1);
    }
    return;
  }
  if (/^https?:\/\//i.test(clean) || clean.startsWith("mailto:") || clean.startsWith("tel:")) {
    void Linking.openURL(clean);
    return;
  }
  router.push(clean as any);
}

function SectionHeader({
  eyebrow,
  title,
  body,
  maxWidth = 820,
}: {
  eyebrow?: string;
  title: string;
  body?: string;
  maxWidth?: number;
}) {
  return (
    <View style={{ maxWidth, gap: 10 }}>
      {eyebrow ? (
        <Text style={{ color: GOLD, fontWeight: "900", fontSize: 12, textTransform: "uppercase" }}>
          {eyebrow}
        </Text>
      ) : null}
      <Text style={{ color: TEXT, fontWeight: "900", fontSize: 34, lineHeight: 40 }}>{title}</Text>
      {body ? <Text style={{ color: MUTED, fontSize: 15, lineHeight: 24 }}>{body}</Text> : null}
    </View>
  );
}

function MetricCard({
  label,
  value,
  icon,
  tone,
  note,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: string;
  note?: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        minWidth: 190,
        borderRadius: 8,
        padding: 16,
        backgroundColor: PANEL,
        borderWidth: 1,
        borderColor: BORDER,
        minHeight: 130,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 8,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: `${tone}20`,
            borderWidth: 1,
            borderColor: `${tone}45`,
          }}
        >
          <Ionicons name={icon} size={19} color={tone} />
        </View>
        <View style={{ width: 48, height: 6, borderRadius: 8, backgroundColor: `${tone}55` }} />
      </View>
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ marginTop: 15, color: TEXT, fontWeight: "900", fontSize: 26 }}>
        {value}
      </Text>
      <Text style={{ marginTop: 6, color: MUTED, fontWeight: "800", fontSize: 12 }}>{label}</Text>
      {note ? <Text style={{ marginTop: 8, color: FAINT, fontSize: 11, lineHeight: 16 }}>{note}</Text> : null}
    </View>
  );
}

function StatusPill({ label, tone }: { label: string; tone: string }) {
  return (
    <View
      style={{
        alignSelf: "flex-start",
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
        backgroundColor: `${tone}18`,
        borderWidth: 1,
        borderColor: `${tone}3D`,
      }}
    >
      <Text style={{ color: tone, fontWeight: "900", fontSize: 11, textTransform: "uppercase" }}>{label}</Text>
    </View>
  );
}

function DemoVideoCard({ demo }: { demo: LandingDemoVideo }) {
  const videoUrl = cleanText(demo.video_url);
  return (
    <View style={{ flex: 1, minWidth: 260, borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: BORDER, backgroundColor: PANEL }}>
      <View style={{ aspectRatio: 16 / 9, backgroundColor: "rgba(255,253,247,0.06)", alignItems: "center", justifyContent: "center" }}>
        {demo.thumbnail_url ? (
          <Image source={{ uri: demo.thumbnail_url }} resizeMode="cover" style={{ position: "absolute", width: "100%", height: "100%" }} />
        ) : (
          <Image source={LOGO} resizeMode="contain" style={{ width: 96, height: 96, opacity: 0.92 }} />
        )}
        <View
          style={{
            width: 58,
            height: 58,
            borderRadius: 29,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0,0,0,0.54)",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.24)",
          }}
        >
          <Ionicons name="play" size={24} color={TEXT} style={{ marginLeft: 3 }} />
        </View>
      </View>
      <View style={{ padding: 16, gap: 8 }}>
        <Text style={{ color: TEXT, fontWeight: "900", fontSize: 17 }}>{demo.title}</Text>
        {demo.description ? <Text style={{ color: MUTED, fontSize: 13, lineHeight: 20 }}>{demo.description}</Text> : null}
        <Pressable
          disabled={!videoUrl}
          onPress={() => void Linking.openURL(videoUrl)}
          style={({ pressed }) => ({
            marginTop: 6,
            opacity: videoUrl ? (pressed ? 0.82 : 1) : 0.45,
            borderRadius: 8,
            minHeight: 42,
            paddingHorizontal: 13,
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "row",
            gap: 8,
            backgroundColor: "rgba(45,212,191,0.16)",
            borderWidth: 1,
            borderColor: "rgba(45,212,191,0.36)",
          })}
        >
          <Ionicons name="open-outline" size={16} color={TEAL} />
          <Text style={{ color: TEAL, fontWeight: "900" }}>{videoUrl ? "Watch demo" : "Video coming soon"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function PublicLandingPage({ demoOnly = false }: Props) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isDesktop = width >= 980;
  const isWide = width >= 1240;
  const [payload, setPayload] = useState<PublicLandingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const load = async (initial = false) => {
      if (initial) {
        setLoading(true);
        setError(null);
      }
      try {
        const next = await fetchPublicLandingPayload();
        if (mounted) {
          setPayload(next);
          setError(null);
        }
      } catch (e: any) {
        if (mounted && initial) setError(String(e?.message || e || "Could not load BestCity Market."));
      } finally {
        if (mounted && initial) setLoading(false);
      }
    };

    void load(true);
    const timer = setInterval(() => {
      void load(false);
    }, 30000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const config: LandingConfig = payload?.content.config ?? FALLBACK_LANDING_CONFIG;
  const stats = payload?.stats ?? {};
  const sections = payload?.content.sections ?? [];
  const features = payload?.content.features ?? [];
  const roadmap = payload?.content.roadmap ?? [];
  const team = payload?.content.team_members ?? [];
  const faqs = payload?.content.faqs ?? [];
  const demos = payload?.content.demo_videos ?? [];
  const demoUrl = useMemo(() => currentSiteDemoUrl(), []);

  const metricCards: Array<{
    label: string;
    value: string;
    icon: keyof typeof Ionicons.glyphMap;
    tone: string;
  }> = [
    { label: "Total users", value: formatMetric(stats.total_users), icon: "people-outline", tone: TEAL },
    { label: "Verified users", value: formatMetric(stats.total_verified_users), icon: "shield-checkmark-outline", tone: BLUE },
    { label: "Total orders", value: formatMetric(stats.total_orders), icon: "receipt-outline", tone: GOLD },
    { label: "Completed orders", value: formatMetric(stats.number_of_completed_orders), icon: "checkmark-done-outline", tone: GREEN },
    { label: "Transactions", value: formatMetric(stats.total_transactions), icon: "swap-horizontal-outline", tone: INDIGO },
    { label: "Daily volume", value: moneyMetric(stats.daily_transaction_volume), icon: "pulse-outline", tone: ROSE },
    { label: "Trading volume", value: moneyMetric(stats.total_trading_volume), icon: "bar-chart-outline", tone: TEAL },
    { label: "Stock volume", value: moneyMetric(stats.total_stock_volume), icon: "trending-up-outline", tone: BLUE },
    { label: "Stock reinvestment fees", value: moneyMetric(stats.total_stock_reinvestment_fees), icon: "repeat-outline", tone: GOLD },
    { label: "Value locked in escrow", value: moneyMetric(stats.total_value_locked_in_escrow), icon: "lock-closed-outline", tone: GREEN },
    { label: "Payouts made", value: moneyMetric(stats.total_payouts_made), icon: "cash-outline", tone: INDIGO },
    { label: "Disputes", value: formatMetric(stats.number_of_disputes), icon: "alert-circle-outline", tone: ROSE },
    { label: "Open disputes", value: formatMetric(stats.open_disputes), icon: "warning-outline", tone: GOLD },
    { label: "Active listings", value: formatMetric(stats.active_listings), icon: "storefront-outline", tone: TEAL },
    { label: "Active sellers", value: formatMetric(stats.active_sellers), icon: "briefcase-outline", tone: BLUE },
    { label: "Stock identities", value: formatMetric(stats.stock_identities), icon: "analytics-outline", tone: INDIGO },
    { label: "Listing reviews", value: formatMetric(stats.listing_reviews), icon: "star-outline", tone: GREEN },
  ];

  function renderNav() {
    return (
      <View
        style={{
          position: "absolute",
          top: insets.top + 14,
          left: 0,
          right: 0,
          zIndex: 10,
          paddingHorizontal: isDesktop ? 30 : 16,
        }}
      >
        <View
          style={{
            maxWidth: 1180,
            width: "100%",
            alignSelf: "center",
            minHeight: 58,
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 8,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            backgroundColor: "rgba(6,8,7,0.72)",
            borderWidth: 1,
            borderColor: "rgba(255,253,247,0.13)",
          }}
        >
          <Pressable onPress={() => router.push("/" as any)} style={{ flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 }}>
            <Image source={LOGO} style={{ width: 36, height: 36, borderRadius: 8 }} />
            <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 16 }}>
              {config.brand_name}
            </Text>
          </Pressable>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {isDesktop && !demoOnly ? (
              <>
                <Pressable onPress={() => openHref("#stats")} style={{ paddingHorizontal: 10, paddingVertical: 9 }}>
                  <Text style={{ color: MUTED, fontWeight: "800", fontSize: 12 }}>Stats</Text>
                </Pressable>
                <Pressable onPress={() => openHref(demoUrl)} style={{ paddingHorizontal: 10, paddingVertical: 9 }}>
                  <Text style={{ color: MUTED, fontWeight: "800", fontSize: 12 }}>Demo</Text>
                </Pressable>
              </>
            ) : null}
            <Pressable
              onPress={() => openHref("/(auth)/login")}
              style={({ pressed }) => ({
                opacity: pressed ? 0.82 : 1,
                borderRadius: 8,
                paddingHorizontal: 14,
                paddingVertical: 10,
                backgroundColor: "rgba(244,183,93,0.16)",
                borderWidth: 1,
                borderColor: "rgba(244,183,93,0.38)",
              })}
            >
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 12 }}>Sign in</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  function renderHero() {
    const heroSource = config.hero_media_url ? { uri: config.hero_media_url } : LOGO;
    const heroMinHeight = Math.max(620, Math.min(820, height * 0.9));
    return (
      <ImageBackground source={heroSource} resizeMode="cover" style={{ minHeight: heroMinHeight, backgroundColor: BG }}>
        <LinearGradient
          colors={["rgba(6,8,7,0.30)", "rgba(6,8,7,0.86)", BG]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={{ minHeight: heroMinHeight, paddingTop: insets.top + 104, paddingHorizontal: isDesktop ? 30 : 18, justifyContent: "flex-end" }}
        >
          <View style={{ maxWidth: 1180, width: "100%", alignSelf: "center", paddingBottom: 54 }}>
            <View style={{ maxWidth: isWide ? 820 : 720 }}>
              <Text style={{ color: GOLD, fontWeight: "900", fontSize: 12, textTransform: "uppercase" }}>
                {config.hero_eyebrow}
              </Text>
              <Text
                style={{
                  marginTop: 14,
                  color: TEXT,
                  fontWeight: "900",
                  fontSize: isDesktop ? 72 : 46,
                  lineHeight: isDesktop ? 78 : 52,
                }}
              >
                {config.hero_title}
              </Text>
              <Text style={{ marginTop: 16, color: "rgba(255,253,247,0.82)", fontSize: isDesktop ? 19 : 16, lineHeight: isDesktop ? 30 : 25, maxWidth: 720 }}>
                {config.hero_subtitle}
              </Text>
              <View style={{ marginTop: 26, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                <Pressable
                  onPress={() => openHref(config.primary_cta_route)}
                  style={({ pressed }) => ({
                    opacity: pressed ? 0.84 : 1,
                    borderRadius: 8,
                    minHeight: 50,
                    paddingHorizontal: 18,
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "row",
                    gap: 8,
                    backgroundColor: GOLD,
                  })}
                >
                  <Text style={{ color: "#11130F", fontWeight: "900" }}>{config.primary_cta_label}</Text>
                  <Ionicons name="arrow-forward" size={17} color="#11130F" />
                </Pressable>
                <Pressable
                  onPress={() => openHref(config.secondary_cta_route)}
                  style={({ pressed }) => ({
                    opacity: pressed ? 0.84 : 1,
                    borderRadius: 8,
                    minHeight: 50,
                    paddingHorizontal: 18,
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "row",
                    gap: 8,
                    backgroundColor: "rgba(255,253,247,0.09)",
                    borderWidth: 1,
                    borderColor: "rgba(255,253,247,0.18)",
                  })}
                >
                  <Text style={{ color: TEXT, fontWeight: "900" }}>{config.secondary_cta_label}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </LinearGradient>
      </ImageBackground>
    );
  }

  function renderOverview() {
    return (
      <View style={{ backgroundColor: BG, paddingHorizontal: isDesktop ? 30 : 18, paddingVertical: 74 }}>
        <View style={{ maxWidth: 1180, width: "100%", alignSelf: "center", flexDirection: isDesktop ? "row" : "column", gap: 22 }}>
          <View style={{ flex: 1.1 }}>
            <SectionHeader eyebrow="Company overview" title="Commerce infrastructure for trusted digital cities" body={config.company_overview} />
          </View>
          <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {[
              { title: config.mission_title, body: config.mission_body, tone: TEAL },
              { title: config.vision_title, body: config.vision_body, tone: GOLD },
              { title: config.what_building_title, body: config.what_building_body, tone: BLUE },
              { title: config.why_building_title, body: config.why_building_body, tone: GREEN },
            ].map((item) => (
              <View key={item.title} style={{ flex: 1, minWidth: 240, borderRadius: 8, borderWidth: 1, borderColor: BORDER, backgroundColor: PANEL, padding: 16 }}>
                <View style={{ width: 34, height: 4, borderRadius: 8, backgroundColor: item.tone }} />
                <Text style={{ marginTop: 14, color: TEXT, fontWeight: "900", fontSize: 18 }}>{item.title}</Text>
                <Text style={{ marginTop: 8, color: MUTED, fontSize: 13, lineHeight: 21 }}>{item.body}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  }

  function renderSections() {
    if (!sections.length) return null;
    return (
      <View style={{ backgroundColor: SURFACE, paddingHorizontal: isDesktop ? 30 : 18, paddingVertical: 74 }}>
        <View style={{ maxWidth: 1180, width: "100%", alignSelf: "center", gap: 18 }}>
          {sections.map((section, index) => (
            <View
              key={section.id}
              style={{
                flexDirection: isDesktop && index % 2 === 1 ? "row-reverse" : isDesktop ? "row" : "column",
                alignItems: "stretch",
                gap: 18,
              }}
            >
              <View style={{ flex: 1, justifyContent: "center", paddingVertical: 14 }}>
                <SectionHeader eyebrow={section.eyebrow || undefined} title={section.title} body={section.body} maxWidth={760} />
                {section.cta_label && section.cta_url ? (
                  <Pressable
                    onPress={() => openHref(section.cta_url)}
                    style={{ marginTop: 18, alignSelf: "flex-start", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: "rgba(45,212,191,0.16)", borderWidth: 1, borderColor: "rgba(45,212,191,0.36)" }}
                  >
                    <Text style={{ color: TEAL, fontWeight: "900" }}>{section.cta_label}</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={{ flex: 0.82, minHeight: 260, borderRadius: 8, borderWidth: 1, borderColor: BORDER, overflow: "hidden", backgroundColor: PANEL }}>
                {section.media_url ? (
                  <Image source={{ uri: section.media_url }} resizeMode="cover" style={{ width: "100%", height: "100%" }} />
                ) : (
                  <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 28 }}>
                    <Image source={LOGO} resizeMode="contain" style={{ width: 116, height: 116, opacity: 0.9 }} />
                  </View>
                )}
              </View>
            </View>
          ))}
        </View>
      </View>
    );
  }

  function renderStats() {
    return (
      <View nativeID="stats" style={{ backgroundColor: BG, paddingHorizontal: isDesktop ? 30 : 18, paddingVertical: 78 }}>
        <View style={{ maxWidth: 1180, width: "100%", alignSelf: "center", gap: 22 }}>
          <View style={{ flexDirection: isDesktop ? "row" : "column", gap: 20, alignItems: isDesktop ? "flex-end" : "flex-start", justifyContent: "space-between" }}>
            <SectionHeader eyebrow="Real-time dashboard" title={config.stats_title} body={config.stats_subtitle} />
            <Text style={{ color: FAINT, fontWeight: "800", fontSize: 12 }}>
              Updated {cleanText(String(payload?.generated_at || ""), "live")}
            </Text>
          </View>
          {loading ? (
            <View style={{ borderRadius: 8, borderWidth: 1, borderColor: BORDER, padding: 24, backgroundColor: PANEL, alignItems: "center" }}>
              <ActivityIndicator color={TEAL} />
              <Text style={{ marginTop: 10, color: MUTED, fontWeight: "800" }}>Loading platform statistics</Text>
            </View>
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              {metricCards.map((metric) => (
                <MetricCard key={metric.label} {...metric} />
              ))}
            </View>
          )}
        </View>
      </View>
    );
  }

  function renderFeatures() {
    if (!features.length) return null;
    return (
      <View style={{ backgroundColor: SURFACE_2, paddingHorizontal: isDesktop ? 30 : 18, paddingVertical: 74 }}>
        <View style={{ maxWidth: 1180, width: "100%", alignSelf: "center", gap: 22 }}>
          <SectionHeader eyebrow="Features" title={config.features_title} body={config.features_body} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {features.map((feature) => (
              <View key={feature.id} style={{ flex: 1, minWidth: isDesktop ? 310 : 250, borderRadius: 8, borderWidth: 1, borderColor: BORDER, backgroundColor: PANEL, padding: 18, minHeight: 176 }}>
                <View style={{ width: 42, height: 42, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: `${feature.accent || TEAL}1F`, borderWidth: 1, borderColor: `${feature.accent || TEAL}42` }}>
                  <Ionicons name={(feature.icon_key || "sparkles-outline") as any} size={20} color={feature.accent || TEAL} />
                </View>
                <Text style={{ marginTop: 14, color: TEXT, fontWeight: "900", fontSize: 18 }}>{feature.title}</Text>
                <Text style={{ marginTop: 8, color: MUTED, fontSize: 13, lineHeight: 21 }}>{feature.body}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  }

  function renderBlockchainProduct() {
    return (
      <View style={{ backgroundColor: BG, paddingHorizontal: isDesktop ? 30 : 18, paddingVertical: 74 }}>
        <View style={{ maxWidth: 1180, width: "100%", alignSelf: "center", flexDirection: isDesktop ? "row" : "column", gap: 18 }}>
          <View style={{ flex: 1, borderRadius: 8, borderWidth: 1, borderColor: BORDER, padding: 20, backgroundColor: PANEL_STRONG }}>
            <StatusPill label="Blockchain" tone={TEAL} />
            <Text style={{ marginTop: 16, color: TEXT, fontWeight: "900", fontSize: 27 }}>{config.blockchain_title}</Text>
            <Text style={{ marginTop: 10, color: MUTED, fontSize: 15, lineHeight: 24 }}>{config.blockchain_body}</Text>
          </View>
          <View style={{ flex: 1, borderRadius: 8, borderWidth: 1, borderColor: BORDER, padding: 20, backgroundColor: PANEL_STRONG }}>
            <StatusPill label="Product" tone={GOLD} />
            <Text style={{ marginTop: 16, color: TEXT, fontWeight: "900", fontSize: 27 }}>{config.product_title}</Text>
            <Text style={{ marginTop: 10, color: MUTED, fontSize: 15, lineHeight: 24 }}>{config.product_body}</Text>
          </View>
        </View>
      </View>
    );
  }

  function renderRoadmap() {
    if (!roadmap.length) return null;
    const toneByStatus: Record<string, string> = {
      shipped: GREEN,
      in_progress: TEAL,
      planned: GOLD,
      exploring: INDIGO,
    };
    return (
      <View style={{ backgroundColor: SURFACE, paddingHorizontal: isDesktop ? 30 : 18, paddingVertical: 74 }}>
        <View style={{ maxWidth: 1180, width: "100%", alignSelf: "center", gap: 22 }}>
          <SectionHeader eyebrow="Roadmap" title={config.roadmap_title} body={config.roadmap_body} />
          <View style={{ gap: 12 }}>
            {roadmap.map((item) => {
              const tone = toneByStatus[item.status] ?? GOLD;
              return (
                <View key={item.id} style={{ borderRadius: 8, borderWidth: 1, borderColor: BORDER, backgroundColor: PANEL, padding: 16, flexDirection: isDesktop ? "row" : "column", gap: 14, alignItems: isDesktop ? "center" : "flex-start" }}>
                  <View style={{ width: isDesktop ? 170 : undefined }}>
                    <StatusPill label={item.status.replace(/_/g, " ")} tone={tone} />
                    {item.target_label ? <Text style={{ marginTop: 8, color: FAINT, fontWeight: "900", fontSize: 11 }}>{item.target_label}</Text> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>{item.title}</Text>
                    <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 21 }}>{item.body}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      </View>
    );
  }

  function renderTeam() {
    return (
      <View style={{ backgroundColor: BG, paddingHorizontal: isDesktop ? 30 : 18, paddingVertical: 74 }}>
        <View style={{ maxWidth: 1180, width: "100%", alignSelf: "center", gap: 22 }}>
          <SectionHeader eyebrow="Team" title={config.team_title} body={config.team_body} />
          {team.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              {team.map((member) => (
                <View key={member.id} style={{ flex: 1, minWidth: 230, borderRadius: 8, borderWidth: 1, borderColor: BORDER, backgroundColor: PANEL, overflow: "hidden" }}>
                  <View style={{ height: 190, backgroundColor: "rgba(255,253,247,0.05)", alignItems: "center", justifyContent: "center" }}>
                    {member.image_url ? (
                      <Image source={{ uri: member.image_url }} resizeMode="cover" style={{ width: "100%", height: "100%" }} />
                    ) : (
                      <Image source={LOGO} resizeMode="contain" style={{ width: 86, height: 86, opacity: 0.8 }} />
                    )}
                  </View>
                  <View style={{ padding: 16 }}>
                    <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>{member.name}</Text>
                    <Text style={{ marginTop: 5, color: GOLD, fontWeight: "900", fontSize: 12 }}>{member.role_title}</Text>
                    {member.bio ? <Text style={{ marginTop: 9, color: MUTED, fontSize: 13, lineHeight: 20 }}>{member.bio}</Text> : null}
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={{ borderRadius: 8, borderWidth: 1, borderColor: BORDER, padding: 18, backgroundColor: PANEL }}>
              <Text style={{ color: MUTED, fontSize: 14, lineHeight: 22 }}>
                Team profiles will appear here after admins publish them.
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  function renderDemoSection(fullPage = false) {
    return (
      <View nativeID="videos" style={{ backgroundColor: fullPage ? BG : SURFACE_2, paddingHorizontal: isDesktop ? 30 : 18, paddingVertical: fullPage ? 110 : 74, minHeight: fullPage ? Math.max(680, height) : undefined }}>
        <View style={{ maxWidth: 1180, width: "100%", alignSelf: "center", gap: 22 }}>
          <View style={{ flexDirection: isDesktop ? "row" : "column", alignItems: isDesktop ? "flex-end" : "flex-start", justifyContent: "space-between", gap: 18 }}>
            <SectionHeader eyebrow="Demo" title={config.demo_title} body={config.demo_body} />
            {!fullPage ? (
              <Pressable
                onPress={() => openHref(demoUrl)}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.84 : 1,
                  borderRadius: 8,
                  minHeight: 50,
                  paddingHorizontal: 18,
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  gap: 8,
                  backgroundColor: TEAL,
                })}
              >
                <Text style={{ color: "#04110E", fontWeight: "900" }}>{config.demo_cta_label}</Text>
                <Ionicons name="play" size={17} color="#04110E" />
              </Pressable>
            ) : null}
          </View>
          {demos.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              {demos.map((demo) => <DemoVideoCard key={demo.id} demo={demo} />)}
            </View>
          ) : (
            <View style={{ borderRadius: 8, borderWidth: 1, borderColor: BORDER, backgroundColor: PANEL, padding: 22, flexDirection: isDesktop ? "row" : "column", alignItems: "center", gap: 16 }}>
              <Image source={LOGO} style={{ width: 72, height: 72, borderRadius: 8 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: TEXT, fontWeight: "900", fontSize: 19 }}>Official demos are being prepared</Text>
                <Text style={{ marginTop: 6, color: MUTED, lineHeight: 21 }}>
                  Admins can upload multiple demo videos, give each one a title, and publish them here without hardcoded domains or external video links.
                </Text>
              </View>
            </View>
          )}
        </View>
      </View>
    );
  }

  function renderFaqContact() {
    return (
      <View style={{ backgroundColor: BG, paddingHorizontal: isDesktop ? 30 : 18, paddingVertical: 74 }}>
        <View style={{ maxWidth: 1180, width: "100%", alignSelf: "center", flexDirection: isDesktop ? "row" : "column", gap: 18 }}>
          <View style={{ flex: 1, gap: 14 }}>
            <SectionHeader eyebrow="FAQ" title={config.faq_title} body={config.faq_body} />
            {faqs.map((faq) => (
              <View key={faq.id} style={{ borderRadius: 8, borderWidth: 1, borderColor: BORDER, backgroundColor: PANEL, padding: 15 }}>
                <Text style={{ color: TEXT, fontWeight: "900", fontSize: 15 }}>{faq.question}</Text>
                <Text style={{ marginTop: 7, color: MUTED, fontSize: 13, lineHeight: 21 }}>{faq.answer}</Text>
              </View>
            ))}
          </View>
          <View style={{ flex: 0.8, borderRadius: 8, borderWidth: 1, borderColor: BORDER, backgroundColor: PANEL_STRONG, padding: 20, alignSelf: isDesktop ? "flex-start" : "stretch" }}>
            <SectionHeader eyebrow="Contact" title={config.contact_title} body={config.contact_body} />
            <View style={{ marginTop: 18, gap: 12 }}>
              <Pressable onPress={() => void Linking.openURL(`mailto:${config.contact_email}`)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Ionicons name="mail-outline" size={18} color={GOLD} />
                <Text style={{ color: TEXT, fontWeight: "800" }}>{config.contact_email}</Text>
              </Pressable>
              {config.contact_phone ? (
                <Pressable onPress={() => void Linking.openURL(`tel:${config.contact_phone}`)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Ionicons name="call-outline" size={18} color={TEAL} />
                  <Text style={{ color: TEXT, fontWeight: "800" }}>{config.contact_phone}</Text>
                </Pressable>
              ) : null}
              {config.contact_address ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Ionicons name="location-outline" size={18} color={BLUE} />
                  <Text style={{ color: TEXT, fontWeight: "800", flex: 1 }}>{config.contact_address}</Text>
                </View>
              ) : null}
            </View>
            <Pressable
              onPress={() => openHref(config.contact_cta_route)}
              style={({ pressed }) => ({
                marginTop: 20,
                opacity: pressed ? 0.84 : 1,
                borderRadius: 8,
                minHeight: 48,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(244,183,93,0.18)",
                borderWidth: 1,
                borderColor: "rgba(244,183,93,0.38)",
              })}
            >
              <Text style={{ color: GOLD, fontWeight: "900" }}>{config.contact_cta_label}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  if (demoOnly) {
    return (
      <View style={{ flex: 1, backgroundColor: BG }}>
        {renderNav()}
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 36 }}>
          {renderDemoSection(true)}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      {renderNav()}
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 36 }}>
        {renderHero()}
        {error ? (
          <View style={{ backgroundColor: BG, paddingHorizontal: isDesktop ? 30 : 18, paddingVertical: 18 }}>
            <View style={{ maxWidth: 1180, width: "100%", alignSelf: "center", borderRadius: 8, borderWidth: 1, borderColor: "rgba(251,113,133,0.36)", backgroundColor: "rgba(251,113,133,0.12)", padding: 14 }}>
              <Text style={{ color: "#FECACA", fontWeight: "800" }}>{error}</Text>
            </View>
          </View>
        ) : null}
        {renderOverview()}
        {renderStats()}
        {renderSections()}
        {renderFeatures()}
        {renderBlockchainProduct()}
        {renderRoadmap()}
        {renderTeam()}
        {renderDemoSection(false)}
        {renderFaqContact()}
      </ScrollView>
    </View>
  );
}
