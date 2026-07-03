import { Ionicons } from "@expo/vector-icons";
import { ResizeMode, Video } from "expo-av";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
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

/* ------------------------------------------------------------------ */
/* Design tokens — "trading floor at midnight": obsidian surfaces,     */
/* a single warm vault-gold signature, and a ledger-teal for live data */
/* ------------------------------------------------------------------ */
const BG = "#050705";
const BG_SOFT = "#07100C";
const SURFACE = "#0C1210";
const SURFACE_2 = "#0F1713";
const PANEL = "rgba(251,249,243,0.055)";
const PANEL_STRONG = "rgba(251,249,243,0.09)";
const BORDER = "rgba(251,249,243,0.12)";
const HAIRLINE = "rgba(251,249,243,0.09)";
const TEXT = "#FBF9F3";
const MUTED = "rgba(251,249,243,0.68)";
const FAINT = "rgba(251,249,243,0.46)";
const TEAL = "#2FE0C6";
const GOLD = "#F4B75D";
const GOLD_DEEP = "#C6873B";
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

/* ------------------------------------------------------------------ */
/* Motion primitives — restrained, and reduced-motion aware            */
/* ------------------------------------------------------------------ */
function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => {
        if (mounted) setReduced(!!v);
      })
      .catch(() => {});
    const sub = (AccessibilityInfo as any).addEventListener?.("reduceMotionChanged", (v: boolean) =>
      setReduced(!!v)
    );
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);
  return reduced;
}

function FadeIn({
  children,
  delay = 0,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  style?: any;
}) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    const anim = Animated.timing(progress, { toValue: 1, duration: 640, delay, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [reduced]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

function PulseDot({ color = TEAL, label = "Live" }: { color?: string; label?: string }) {
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.25, duration: 900, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [reduced]);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Animated.View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color, opacity }} />
      <Text style={{ color, fontWeight: "900", fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase" }}>
        {label}
      </Text>
    </View>
  );
}

/** Soft ambient light source used behind hero and dashboard sections for extra depth. */
function GlowOrb({
  color,
  size = 420,
  top,
  left,
  right,
  bottom,
  opacity = 0.35,
}: {
  color: string;
  size?: number;
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
  opacity?: number;
}) {
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 5200, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 5200, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [reduced]);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [opacity, opacity * 1.4] });
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        top,
        left,
        right,
        bottom,
        width: size,
        height: size,
        borderRadius: size / 2,
        opacity: glowOpacity,
        transform: [{ scale }],
      }}
    >
      <LinearGradient
        colors={[`${color}AA`, `${color}00`]}
        start={{ x: 0.5, y: 0.5 }}
        end={{ x: 1, y: 1 }}
        style={{ width: "100%", height: "100%", borderRadius: size / 2 }}
      />
    </Animated.View>
  );
}

/** Pressable wrapper that lifts + glows on web hover; inert (but harmless) on native touch. */
function HoverCard({
  children,
  style,
  glowColor = TEAL,
}: {
  children: React.ReactNode;
  style?: any;
  glowColor?: string;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[
        style,
        hovered && {
          borderColor: `${glowColor}55`,
          transform: [{ translateY: -3 }, { scale: 1.015 }],
          shadowColor: glowColor,
          shadowOpacity: 0.36,
          shadowRadius: 26,
          shadowOffset: { width: 0, height: 14 },
          elevation: 9,
        },
      ]}
    >
      {children}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* Shared building blocks                                              */
/* ------------------------------------------------------------------ */
function Kicker({ label, tone = GOLD }: { label: string; tone?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <LinearGradient
        colors={[tone, `${tone}00`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ width: 22, height: 2, borderRadius: 2 }}
      />
      <Text style={{ color: tone, fontWeight: "900", fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase" }}>
        {label}
      </Text>
    </View>
  );
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
    <View style={{ maxWidth, gap: 14 }}>
      {eyebrow ? <Kicker label={eyebrow} /> : null}
      <Text style={{ color: TEXT, fontWeight: "900", fontSize: 34, lineHeight: 40, letterSpacing: -0.4 }}>
        {title}
      </Text>
      {body ? <Text style={{ color: MUTED, fontSize: 15, lineHeight: 25 }}>{body}</Text> : null}
    </View>
  );
}

function SectionDivider() {
  return (
    <LinearGradient
      colors={["rgba(251,249,243,0)", HAIRLINE, "rgba(251,249,243,0)"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={{ height: 1, width: "100%" }}
    />
  );
}

function MetricCard({
  label,
  value,
  icon,
  tone,
  note,
  index = 0,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: string;
  note?: string;
  index?: number;
}) {
  return (
    <FadeIn delay={Math.min(index, 10) * 45} style={{ flex: 1, minWidth: 190 }}>
      <HoverCard
        glowColor={tone}
        style={{
          borderRadius: 10,
          overflow: "hidden",
          backgroundColor: PANEL,
          borderWidth: 1,
          borderColor: BORDER,
          minHeight: 134,
        }}
      >
        <View style={{ height: 3, backgroundColor: tone, opacity: 0.85 }} />
        <View style={{ padding: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 9,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: `${tone}20`,
                borderWidth: 1,
                borderColor: `${tone}45`,
              }}
            >
              <Ionicons name={icon} size={19} color={tone} />
            </View>
            <View style={{ width: 42, height: 5, borderRadius: 8, backgroundColor: `${tone}45` }} />
          </View>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            style={{ marginTop: 15, color: TEXT, fontWeight: "900", fontSize: 26, letterSpacing: -0.3 }}
          >
            {value}
          </Text>
          <Text style={{ marginTop: 6, color: MUTED, fontWeight: "800", fontSize: 12 }}>{label}</Text>
          {note ? <Text style={{ marginTop: 8, color: FAINT, fontSize: 11, lineHeight: 16 }}>{note}</Text> : null}
        </View>
      </HoverCard>
    </FadeIn>
  );
}

function StatusPill({ label, tone }: { label: string; tone: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        alignSelf: "flex-start",
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
        backgroundColor: `${tone}18`,
        borderWidth: 1,
        borderColor: `${tone}3D`,
      }}
    >
      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: tone }} />
      <Text style={{ color: tone, fontWeight: "900", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </Text>
    </View>
  );
}

/** Signature element: an auto-scrolling ledger strip built from the same live stats as the dashboard below it. */
function LedgerTicker({ items }: { items: { label: string; value: string; tone: string }[] }) {
  const reduced = useReducedMotion();
  const translateX = useRef(new Animated.Value(0)).current;
  const [setWidth, setSetWidth] = useState(0);
  const measuredRef = useRef(false);

  useEffect(() => {
    if (reduced || !setWidth) return;
    translateX.setValue(0);
    const anim = Animated.loop(
      Animated.timing(translateX, {
        toValue: -setWidth,
        duration: Math.max(16000, setWidth * 26),
        useNativeDriver: true,
      })
    );
    anim.start();
    return () => anim.stop();
  }, [setWidth, reduced]);

  if (!items.length) return null;

  return (
    <View
      style={{
        overflow: "hidden",
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: HAIRLINE,
        backgroundColor: "rgba(251,249,243,0.025)",
      }}
    >
      <Animated.View style={{ flexDirection: "row", transform: [{ translateX }] }}>
        <View
          style={{ flexDirection: "row" }}
          onLayout={(e) => {
            if (!measuredRef.current) {
              measuredRef.current = true;
              setSetWidth(e.nativeEvent.layout.width);
            }
          }}
        >
          {items.map((it, i) => (
            <TickerItem key={`a-${i}`} {...it} />
          ))}
        </View>
        <View style={{ flexDirection: "row" }}>
          {items.map((it, i) => (
            <TickerItem key={`b-${i}`} {...it} />
          ))}
        </View>
      </Animated.View>
      {/* edge fade so the strip reads as an infinite ribbon rather than a hard-clipped list */}
      <LinearGradient
        pointerEvents="none"
        colors={[BG, "rgba(5,7,5,0)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 46 }}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(5,7,5,0)", BG]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: 46 }}
      />
    </View>
  );
}

function TickerItem({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 13, paddingHorizontal: 22 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tone }} />
      <Text style={{ color: FAINT, fontWeight: "800", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 }}>
        {label}
      </Text>
      <Text style={{ color: TEXT, fontWeight: "900", fontSize: 13 }}>{value}</Text>
    </View>
  );
}

/**
 * Demo video card. Plays inline the moment a viewer taps it — no redirect,
 * no new tab. When `autoPlay` is set (used for the first video on the
 * dedicated demo page) it starts muted immediately, which is the only way
 * browsers allow autoplay, and the on-screen controls let people unmute.
 */
function DemoVideoCard({
  demo,
  index = 0,
  autoPlay = false,
}: {
  demo: LandingDemoVideo;
  index?: number;
  autoPlay?: boolean;
}) {
  const videoUrl = cleanText(demo.video_url);
  const [playing, setPlaying] = useState(Boolean(autoPlay && videoUrl));
  const [failed, setFailed] = useState(false);

  const showPlayer = playing && !!videoUrl && !failed;

  return (
    <FadeIn delay={index * 60} style={{ flex: 1, minWidth: 260 }}>
      <HoverCard
        glowColor={TEAL}
        style={{ borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: BORDER, backgroundColor: PANEL }}
      >
        <View style={{ aspectRatio: 16 / 9, backgroundColor: "rgba(251,249,243,0.06)" }}>
          {showPlayer ? (
            <Video
              source={{ uri: videoUrl }}
              style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" }}
              resizeMode={ResizeMode.COVER}
              useNativeControls
              shouldPlay
              isMuted={autoPlay}
              onError={() => setFailed(true)}
            />
          ) : (
            <Pressable
              disabled={!videoUrl}
              onPress={() => videoUrl && setPlaying(true)}
              style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
            >
              {demo.thumbnail_url ? (
                <Image source={{ uri: demo.thumbnail_url }} resizeMode="cover" style={{ position: "absolute", width: "100%", height: "100%" }} />
              ) : (
                <Image source={LOGO} resizeMode="contain" style={{ width: 96, height: 96, opacity: 0.92 }} />
              )}
              <LinearGradient
                colors={["rgba(5,7,5,0)", "rgba(5,7,5,0.55)"]}
                style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 64 }}
              />
              <View
                style={{
                  width: 58,
                  height: 58,
                  borderRadius: 29,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(5,7,5,0.56)",
                  borderWidth: 1,
                  borderColor: "rgba(251,249,243,0.28)",
                  opacity: videoUrl ? 1 : 0.5,
                }}
              >
                <Ionicons name="play" size={24} color={TEXT} style={{ marginLeft: 3 }} />
              </View>
            </Pressable>
          )}
        </View>
        <View style={{ padding: 16, gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <Text style={{ color: TEXT, fontWeight: "900", fontSize: 17, flex: 1 }}>{demo.title}</Text>
            {showPlayer ? <StatusPill label="Playing" tone={TEAL} /> : null}
          </View>
          {demo.description ? <Text style={{ color: MUTED, fontSize: 13, lineHeight: 20 }}>{demo.description}</Text> : null}
          {!showPlayer ? (
            <Pressable
              disabled={!videoUrl}
              onPress={() => {
                setFailed(false);
                setPlaying(true);
              }}
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
                backgroundColor: "rgba(47,224,198,0.14)",
                borderWidth: 1,
                borderColor: "rgba(47,224,198,0.36)",
              })}
            >
              <Ionicons name="play-circle-outline" size={17} color={TEAL} />
              <Text style={{ color: TEAL, fontWeight: "900" }}>
                {videoUrl ? "Play demo" : "Coming soon"}
              </Text>
            </Pressable>
          ) : null}
          {failed ? (
            <Text style={{ color: ROSE, fontSize: 12 }}>This video couldn't be played. Please try again.</Text>
          ) : null}
        </View>
      </HoverCard>
    </FadeIn>
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
        if (mounted && initial) {
          setError(
            String(e?.message || e || "We couldn't load live marketplace data. Please try again shortly.")
          );
        }
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

  const tickerItems = useMemo(
    () => metricCards.map((m) => ({ label: m.label, value: m.value, tone: m.tone })),
    [payload]
  );

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
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 8,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            backgroundColor: "rgba(5,7,5,0.78)",
            borderWidth: 1,
            borderColor: "rgba(251,249,243,0.13)",
            shadowColor: "#000",
            shadowOpacity: 0.35,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 12 },
          }}
        >
          <Pressable onPress={() => router.push("/" as any)} style={{ flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 }}>
            <View
              style={{
                borderRadius: 9,
                padding: 1.5,
                backgroundColor: `${GOLD}55`,
              }}
            >
              <Image source={LOGO} style={{ width: 34, height: 34, borderRadius: 8 }} />
            </View>
            <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 16, letterSpacing: -0.2 }}>
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
                borderColor: "rgba(244,183,93,0.4)",
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
    const heroMinHeight = Math.max(640, Math.min(840, height * 0.92));
    return (
      <ImageBackground source={heroSource} resizeMode="cover" style={{ minHeight: heroMinHeight, backgroundColor: BG }}>
        <LinearGradient
          colors={["rgba(5,7,5,0.34)", "rgba(5,7,5,0.88)", BG]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={{ minHeight: heroMinHeight, paddingTop: insets.top + 104, paddingHorizontal: isDesktop ? 30 : 18, justifyContent: "flex-end" }}
        >
          {/* ambient depth */}
          <LinearGradient
            colors={["rgba(5,7,5,0.5)", "rgba(5,7,5,0)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.6, y: 0.6 }}
            style={{ position: "absolute", top: 0, left: 0, right: 0, height: "45%" }}
            pointerEvents="none"
          />
          <GlowOrb color={GOLD} size={520} top={-120} right={-140} opacity={0.28} />
          <GlowOrb color={TEAL} size={420} bottom={40} left={-120} opacity={0.22} />
          <View style={{ maxWidth: 1180, width: "100%", alignSelf: "center", paddingBottom: 54 }}>
            <FadeIn style={{ maxWidth: isWide ? 820 : 720 }}>
              <Kicker label={config.hero_eyebrow} />
              <Text
                style={{
                  marginTop: 16,
                  color: TEXT,
                  fontWeight: "900",
                  fontSize: isDesktop ? 72 : 44,
                  lineHeight: isDesktop ? 78 : 50,
                  letterSpacing: -1.2,
                  textShadowColor: "rgba(0,0,0,0.4)",
                  textShadowOffset: { width: 0, height: 6 },
                  textShadowRadius: 24,
                }}
              >
                {config.hero_title}
              </Text>
              <Text
                style={{
                  marginTop: 16,
                  color: "rgba(251,249,243,0.82)",
                  fontSize: isDesktop ? 19 : 16,
                  lineHeight: isDesktop ? 30 : 25,
                  maxWidth: 720,
                }}
              >
                {config.hero_subtitle}
              </Text>
              <View style={{ marginTop: 28, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                <Pressable
                  onPress={() => openHref(config.primary_cta_route)}
                  style={({ pressed }) => ({
                    opacity: pressed ? 0.88 : 1,
                    borderRadius: 9,
                    overflow: "hidden",
                    minHeight: 52,
                    shadowColor: GOLD,
                    shadowOpacity: 0.42,
                    shadowRadius: 24,
                    shadowOffset: { width: 0, height: 12 },
                    elevation: 8,
                  })}
                >
                  <LinearGradient
                    colors={[GOLD, GOLD_DEEP]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{
                      minHeight: 52,
                      paddingHorizontal: 20,
                      alignItems: "center",
                      justifyContent: "center",
                      flexDirection: "row",
                      gap: 8,
                    }}
                  >
                    <Text style={{ color: "#12130E", fontWeight: "900" }}>{config.primary_cta_label}</Text>
                    <Ionicons name="arrow-forward" size={17} color="#12130E" />
                  </LinearGradient>
                </Pressable>
                <Pressable
                  onPress={() => openHref(config.secondary_cta_route)}
                  style={({ pressed }) => ({
                    opacity: pressed ? 0.84 : 1,
                    borderRadius: 9,
                    minHeight: 52,
                    paddingHorizontal: 20,
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "row",
                    gap: 8,
                    backgroundColor: "rgba(251,249,243,0.08)",
                    borderWidth: 1,
                    borderColor: "rgba(251,249,243,0.2)",
                  })}
                >
                  <Text style={{ color: TEXT, fontWeight: "900" }}>{config.secondary_cta_label}</Text>
                </Pressable>
              </View>
            </FadeIn>
          </View>
        </LinearGradient>
      </ImageBackground>
    );
  }

  function renderOverview() {
    return (
      <View style={{ backgroundColor: BG, paddingHorizontal: isDesktop ? 30 : 18, paddingVertical: 76 }}>
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
            ].map((item, i) => (
              <FadeIn key={item.title} delay={i * 60} style={{ flex: 1, minWidth: 240 }}>
                <HoverCard
                  glowColor={item.tone}
                  style={{ borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: PANEL, padding: 16 }}
                >
                  <View style={{ width: 30, height: 3, borderRadius: 8, backgroundColor: item.tone }} />
                  <Text style={{ marginTop: 14, color: TEXT, fontWeight: "900", fontSize: 18 }}>{item.title}</Text>
                  <Text style={{ marginTop: 8, color: MUTED, fontSize: 13, lineHeight: 21 }}>{item.body}</Text>
                </HoverCard>
              </FadeIn>
            ))}
          </View>
        </View>
      </View>
    );
  }

  function renderSections() {
    if (!sections.length) return null;
    return (
      <View style={{ backgroundColor: SURFACE, paddingHorizontal: isDesktop ? 30 : 18, paddingVertical: 76 }}>
        <View style={{ maxWidth: 1180, width: "100%", alignSelf: "center", gap: 20 }}>
          {sections.map((section, index) => (
            <FadeIn key={section.id} delay={Math.min(index, 4) * 60}>
              <View
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
                      style={{
                        marginTop: 18,
                        alignSelf: "flex-start",
                        borderRadius: 8,
                        paddingHorizontal: 14,
                        paddingVertical: 11,
                        backgroundColor: "rgba(47,224,198,0.14)",
                        borderWidth: 1,
                        borderColor: "rgba(47,224,198,0.36)",
                      }}
                    >
                      <Text style={{ color: TEAL, fontWeight: "900" }}>{section.cta_label}</Text>
                    </Pressable>
                  ) : null}
                </View>
                <View style={{ flex: 0.82, minHeight: 260, borderRadius: 10, borderWidth: 1, borderColor: BORDER, overflow: "hidden", backgroundColor: PANEL }}>
                  {section.media_url ? (
                    <Image source={{ uri: section.media_url }} resizeMode="cover" style={{ width: "100%", height: "100%" }} />
                  ) : (
                    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 28 }}>
                      <Image source={LOGO} resizeMode="contain" style={{ width: 116, height: 116, opacity: 0.9 }} />
                    </View>
                  )}
                </View>
              </View>
            </FadeIn>
          ))}
        </View>
      </View>
    );
  }

  function renderStats() {
    return (
      <View nativeID="stats" style={{ backgroundColor: BG, paddingHorizontal: isDesktop ? 30 : 18, paddingVertical: 80, position: "relative", overflow: "hidden" }}>
        <GlowOrb color={INDIGO} size={480} top={-60} left={-160} opacity={0.18} />
        <View style={{ maxWidth: 1180, width: "100%", alignSelf: "center", gap: 24 }}>
          <View style={{ flexDirection: isDesktop ? "row" : "column", gap: 20, alignItems: isDesktop ? "flex-end" : "flex-start", justifyContent: "space-between" }}>
            <SectionHeader eyebrow="Real-time dashboard" title={config.stats_title} body={config.stats_subtitle} />
            <View style={{ alignItems: isDesktop ? "flex-end" : "flex-start", gap: 6 }}>
              <PulseDot color={TEAL} />
              <Text style={{ color: FAINT, fontWeight: "800", fontSize: 12 }}>
                Updated {cleanText(String(payload?.generated_at || ""), "just now")}
              </Text>
            </View>
          </View>
          {loading ? (
            <View style={{ borderRadius: 10, borderWidth: 1, borderColor: BORDER, padding: 24, backgroundColor: PANEL, alignItems: "center" }}>
              <ActivityIndicator color={TEAL} />
              <Text style={{ marginTop: 10, color: MUTED, fontWeight: "800" }}>Loading platform statistics</Text>
            </View>
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              {metricCards.map((metric, i) => (
                <MetricCard key={metric.label} {...metric} index={i} />
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
      <View style={{ backgroundColor: SURFACE_2, paddingHorizontal: isDesktop ? 30 : 18, paddingVertical: 76 }}>
        <View style={{ maxWidth: 1180, width: "100%", alignSelf: "center", gap: 24 }}>
          <SectionHeader eyebrow="Features" title={config.features_title} body={config.features_body} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {features.map((feature, i) => (
              <FadeIn key={feature.id} delay={Math.min(i, 8) * 50} style={{ flex: 1, minWidth: isDesktop ? 310 : 250 }}>
                <HoverCard
                  glowColor={feature.accent || TEAL}
                  style={{ borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: PANEL, padding: 18, minHeight: 176 }}
                >
                  <View
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 10,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: `${feature.accent || TEAL}1F`,
                      borderWidth: 1,
                      borderColor: `${feature.accent || TEAL}42`,
                    }}
                  >
                    <Ionicons name={(feature.icon_key || "sparkles-outline") as any} size={20} color={feature.accent || TEAL} />
                  </View>
                  <Text style={{ marginTop: 14, color: TEXT, fontWeight: "900", fontSize: 18 }}>{feature.title}</Text>
                  <Text style={{ marginTop: 8, color: MUTED, fontSize: 13, lineHeight: 21 }}>{feature.body}</Text>
                </HoverCard>
              </FadeIn>
            ))}
          </View>
        </View>
      </View>
    );
  }

  function renderBlockchainProduct() {
    return (
      <View style={{ backgroundColor: BG, paddingHorizontal: isDesktop ? 30 : 18, paddingVertical: 76 }}>
        <View style={{ maxWidth: 1180, width: "100%", alignSelf: "center", flexDirection: isDesktop ? "row" : "column", gap: 18 }}>
          <FadeIn style={{ flex: 1 }}>
            <View style={{ borderRadius: 10, borderWidth: 1, borderColor: BORDER, padding: 22, backgroundColor: PANEL_STRONG }}>
              <StatusPill label="Blockchain" tone={TEAL} />
              <Text style={{ marginTop: 16, color: TEXT, fontWeight: "900", fontSize: 27, letterSpacing: -0.3 }}>{config.blockchain_title}</Text>
              <Text style={{ marginTop: 10, color: MUTED, fontSize: 15, lineHeight: 24 }}>{config.blockchain_body}</Text>
            </View>
          </FadeIn>
          <FadeIn delay={80} style={{ flex: 1 }}>
            <View style={{ borderRadius: 10, borderWidth: 1, borderColor: BORDER, padding: 22, backgroundColor: PANEL_STRONG }}>
              <StatusPill label="Product" tone={GOLD} />
              <Text style={{ marginTop: 16, color: TEXT, fontWeight: "900", fontSize: 27, letterSpacing: -0.3 }}>{config.product_title}</Text>
              <Text style={{ marginTop: 10, color: MUTED, fontSize: 15, lineHeight: 24 }}>{config.product_body}</Text>
            </View>
          </FadeIn>
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
      <View style={{ backgroundColor: SURFACE, paddingHorizontal: isDesktop ? 30 : 18, paddingVertical: 76 }}>
        <View style={{ maxWidth: 1180, width: "100%", alignSelf: "center", gap: 24 }}>
          <SectionHeader eyebrow="Roadmap" title={config.roadmap_title} body={config.roadmap_body} />
          <View style={{ position: "relative", paddingLeft: 54 }}>
            <View
              pointerEvents="none"
              style={{ position: "absolute", left: 21, top: 22, bottom: 22, width: 2, backgroundColor: HAIRLINE }}
            />
            <View style={{ gap: 14 }}>
              {roadmap.map((item, i) => {
                const tone = toneByStatus[item.status] ?? GOLD;
                return (
                  <FadeIn key={item.id} delay={Math.min(i, 8) * 55} style={{ position: "relative" }}>
                    <View
                      style={{
                        position: "absolute",
                        left: -54,
                        top: 0,
                        width: 44,
                        height: 44,
                        borderRadius: 22,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: BG,
                        borderWidth: 2,
                        borderColor: tone,
                      }}
                    >
                      <Text style={{ color: tone, fontWeight: "900", fontSize: 14 }}>{String(i + 1).padStart(2, "0")}</Text>
                    </View>
                    <HoverCard
                      glowColor={tone}
                      style={{ borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: PANEL, padding: 18 }}
                    >
                      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <StatusPill label={item.status.replace(/_/g, " ")} tone={tone} />
                        {item.target_label ? (
                          <Text style={{ color: FAINT, fontWeight: "900", fontSize: 11, letterSpacing: 0.4 }}>{item.target_label}</Text>
                        ) : null}
                      </View>
                      <Text style={{ marginTop: 12, color: TEXT, fontWeight: "900", fontSize: 18 }}>{item.title}</Text>
                      <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 21 }}>{item.body}</Text>
                    </HoverCard>
                  </FadeIn>
                );
              })}
            </View>
          </View>
        </View>
      </View>
    );
  }

  function renderTeam() {
    return (
      <View style={{ backgroundColor: BG, paddingHorizontal: isDesktop ? 30 : 18, paddingVertical: 76 }}>
        <View style={{ maxWidth: 1180, width: "100%", alignSelf: "center", gap: 24 }}>
          <SectionHeader eyebrow="Team" title={config.team_title} body={config.team_body} />
          {team.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              {team.map((member, i) => (
                <FadeIn key={member.id} delay={Math.min(i, 8) * 55} style={{ flex: 1, minWidth: 230 }}>
                  <HoverCard
                    glowColor={GOLD}
                    style={{ borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: PANEL, overflow: "hidden" }}
                  >
                    <View style={{ height: 190, backgroundColor: "rgba(251,249,243,0.05)", alignItems: "center", justifyContent: "center" }}>
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
                  </HoverCard>
                </FadeIn>
              ))}
            </View>
          ) : (
            <View style={{ borderRadius: 10, borderWidth: 1, borderColor: BORDER, padding: 18, backgroundColor: PANEL }}>
              <Text style={{ color: MUTED, fontSize: 14, lineHeight: 22 }}>
                Profiles for our team are being finalized — check back soon.
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  function renderDemoSection(fullPage = false) {
    return (
      <View
        nativeID="videos"
        style={{
          backgroundColor: fullPage ? BG : SURFACE_2,
          paddingHorizontal: isDesktop ? 30 : 18,
          paddingVertical: fullPage ? 110 : 76,
          minHeight: fullPage ? Math.max(680, height) : undefined,
        }}
      >
        <View style={{ maxWidth: 1180, width: "100%", alignSelf: "center", gap: 24 }}>
          <View style={{ flexDirection: isDesktop ? "row" : "column", alignItems: isDesktop ? "flex-end" : "flex-start", justifyContent: "space-between", gap: 18 }}>
            <SectionHeader eyebrow="Demo" title={config.demo_title} body={config.demo_body} />
            {!fullPage ? (
              <Pressable
                onPress={() => openHref(demoUrl)}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.86 : 1,
                  borderRadius: 9,
                  minHeight: 50,
                  paddingHorizontal: 18,
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  gap: 8,
                  backgroundColor: TEAL,
                  shadowColor: TEAL,
                  shadowOpacity: 0.3,
                  shadowRadius: 16,
                  shadowOffset: { width: 0, height: 8 },
                })}
              >
                <Text style={{ color: "#03130F", fontWeight: "900" }}>{config.demo_cta_label}</Text>
                <Ionicons name="play" size={17} color="#03130F" />
              </Pressable>
            ) : null}
          </View>
          {demos.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              {demos.map((demo, i) => (
                <DemoVideoCard key={demo.id} demo={demo} index={i} autoPlay={fullPage && i === 0} />
              ))}
            </View>
          ) : (
            <View style={{ borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: PANEL, padding: 22, flexDirection: isDesktop ? "row" : "column", alignItems: "center", gap: 16 }}>
              <Image source={LOGO} style={{ width: 72, height: 72, borderRadius: 10 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: TEXT, fontWeight: "900", fontSize: 19 }}>New walkthroughs are on the way</Text>
                <Text style={{ marginTop: 6, color: MUTED, lineHeight: 21 }}>
                  We're putting the finishing touches on product walkthroughs so you can see the platform in
                  action. Check back soon.
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
      <View style={{ backgroundColor: BG, paddingHorizontal: isDesktop ? 30 : 18, paddingVertical: 76 }}>
        <View style={{ maxWidth: 1180, width: "100%", alignSelf: "center", flexDirection: isDesktop ? "row" : "column", gap: 18 }}>
          <View style={{ flex: 1, gap: 14 }}>
            <SectionHeader eyebrow="FAQ" title={config.faq_title} body={config.faq_body} />
            {faqs.map((faq, i) => (
              <FadeIn key={faq.id} delay={Math.min(i, 8) * 40}>
                <View style={{ borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: PANEL, padding: 16 }}>
                  <Text style={{ color: TEXT, fontWeight: "900", fontSize: 15 }}>{faq.question}</Text>
                  <Text style={{ marginTop: 7, color: MUTED, fontSize: 13, lineHeight: 21 }}>{faq.answer}</Text>
                </View>
              </FadeIn>
            ))}
          </View>
          <View style={{ flex: 0.8, borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: PANEL_STRONG, padding: 22, alignSelf: isDesktop ? "flex-start" : "stretch" }}>
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
                borderRadius: 9,
                minHeight: 48,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(244,183,93,0.18)",
                borderWidth: 1,
                borderColor: "rgba(244,183,93,0.4)",
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
        <LedgerTicker items={tickerItems} />
        {error ? (
          <View style={{ backgroundColor: BG, paddingHorizontal: isDesktop ? 30 : 18, paddingVertical: 18 }}>
            <View style={{ maxWidth: 1180, width: "100%", alignSelf: "center", borderRadius: 10, borderWidth: 1, borderColor: "rgba(251,113,133,0.36)", backgroundColor: "rgba(251,113,133,0.12)", padding: 14 }}>
              <Text style={{ color: "#FECACA", fontWeight: "800" }}>{error}</Text>
            </View>
          </View>
        ) : null}
        {renderOverview()}
        <SectionDivider />
        {renderStats()}
        {renderSections()}
        <SectionDivider />
        {renderFeatures()}
        {renderBlockchainProduct()}
        {renderRoadmap()}
        {renderTeam()}
        {renderDemoSection(false)}
        <SectionDivider />
        {renderFaqContact()}
      </ScrollView>
    </View>
  );
}