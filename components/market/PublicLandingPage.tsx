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
  Platform,
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
/* Design tokens — "verified manifest": graphite ink, a single acid    */
/* lime signal for anything live/verified, cobalt for action, and a   */
/* serif+mono type pairing so the page reads as an institutional      */
/* ledger rather than another gold-gradient fintech template.         */
/* ------------------------------------------------------------------ */
const INK = "#0A0B0F";
const INK_RAISED = "#101219";
const SURFACE = "#14161F";
const SURFACE_2 = "#181B25";
const PANEL = "rgba(245,246,250,0.05)";
const PANEL_STRONG = "rgba(245,246,250,0.08)";
const LINE = "rgba(245,246,250,0.14)";
const HAIRLINE = "rgba(245,246,250,0.09)";
const TEXT = "#F5F6FA";
const MUTED = "rgba(245,246,250,0.66)";
const FAINT = "rgba(245,246,250,0.42)";
const COBALT = "#4C6FFF";
const COBALT_DEEP = "#2E45C4";
const LIME = "#B6FF3C";
const AMBER = "#FFB020";
const CORAL = "#FF5C72";
const VIOLET = "#9B7BFF";
const SKY = "#3FC7FF";

const FONT_DISPLAY = Platform.select({ ios: "Georgia", android: "serif", default: "Georgia, 'Iowan Old Style', serif" });
const FONT_MONO = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "'JetBrains Mono', 'SFMono-Regular', Menlo, Consolas, monospace",
});

const SECTION_PAD_Y = 68;
const SECTION_PAD_X_DESKTOP = 32;
const SECTION_PAD_X_MOBILE = 18;
const MAX_W = 1180;

// Adjust this bucket name only if you actually renamed the storage bucket in Supabase.
const LANDING_BUCKET = "market-landing";
const SUPABASE_URL = cleanText(
  (process.env as any)?.EXPO_PUBLIC_SUPABASE_URL ?? (process.env as any)?.SUPABASE_URL
);

// Team grid tuning — change these two numbers to control how many cards
// sit on one row. minCardWidth is a floor so cards never get too skinny;
// maxCardWidth is a ceiling so a single card (or a short last row) never
// stretches edge-to-edge and blows up the photo.
const TEAM_CARD_MIN_WIDTH = 150;
const TEAM_CARD_MAX_WIDTH = 220;
const TEAM_CARD_BASIS_MOBILE = "47%"; // ~2 per row on phones
const TEAM_CARD_BASIS_DESKTOP = "22%"; // ~4 per row on desktop

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

/**
 * Admin-uploaded media can arrive two ways: a full `*_url` the dashboard
 * already resolved, or just a `*_storage_path` inside the public
 * `market-landing` bucket (nothing computed the public URL for it). This
 * makes both cases render instead of silently falling back to the logo.
 * If images still don't show after this, confirm EXPO_PUBLIC_SUPABASE_URL
 * is set in your app config and that the bucket really is named
 * "market-landing".
 */
function storagePublicUrl(bucket: string, path?: string | null) {
  const clean = cleanText(path).replace(/^\/+/, "");
  if (!clean || !SUPABASE_URL) return "";
  return `${SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/${clean}`;
}

function resolveMedia(explicitUrl?: unknown, storagePath?: unknown, bucket: string = LANDING_BUCKET) {
  const direct = cleanText(explicitUrl);
  if (direct) return direct;
  return storagePublicUrl(bucket, cleanText(storagePath));
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
    const anim = Animated.timing(progress, { toValue: 1, duration: 560, delay, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [reduced]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

function LiveDot({ color = LIME, label = "Live" }: { color?: string; label?: string }) {
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.25, duration: 850, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 850, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [reduced]);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
      <Animated.View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, opacity }} />
      <Text style={{ color, fontFamily: FONT_MONO, fontWeight: "700", fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" }}>
        {label}
      </Text>
    </View>
  );
}

/** Soft ambient light used behind hero / stats for depth — quiet, single-hue, never competes with the signature strip. */
function GlowOrb({
  color,
  size = 420,
  top,
  left,
  right,
  bottom,
  opacity = 0.28,
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
        Animated.timing(pulse, { toValue: 1, duration: 5600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 5600, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [reduced]);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] });
  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [opacity, opacity * 1.35] });
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
        colors={[`${color}99`, `${color}00`]}
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
  glowColor = COBALT,
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
          borderColor: `${glowColor}66`,
          transform: [{ translateY: -3 }],
          shadowColor: glowColor,
          shadowOpacity: 0.32,
          shadowRadius: 22,
          shadowOffset: { width: 0, height: 12 },
          elevation: 8,
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
function Kicker({ label, tone = LIME }: { label: string; tone?: string }) {
  if (!cleanText(label)) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ width: 16, height: 1, backgroundColor: tone }} />
      <Text
        style={{
          color: tone,
          fontFamily: FONT_MONO,
          fontWeight: "700",
          fontSize: 11,
          letterSpacing: 2,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function SectionHeader({
  eyebrow,
  title,
  body,
  maxWidth = 760,
  tone = LIME,
}: {
  eyebrow?: string;
  title: string;
  body?: string;
  maxWidth?: number;
  tone?: string;
}) {
  return (
    <View style={{ maxWidth, gap: 14 }}>
      <Kicker label={eyebrow ?? ""} tone={tone} />
      <Text
        style={{
          color: TEXT,
          fontFamily: FONT_DISPLAY,
          fontWeight: "700",
          fontSize: 32,
          lineHeight: 38,
          letterSpacing: -0.3,
        }}
      >
        {title}
      </Text>
      {body ? <Text style={{ color: MUTED, fontSize: 15, lineHeight: 24 }}>{body}</Text> : null}
    </View>
  );
}

function SectionDivider() {
  return (
    <LinearGradient
      colors={["rgba(245,246,250,0)", HAIRLINE, "rgba(245,246,250,0)"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={{ height: 1, width: "100%" }}
    />
  );
}

/** A section wrapper that guarantees one consistent vertical rhythm everywhere on the page. */
function Section({
  children,
  bg = INK,
  nativeID,
  first = false,
  last = false,
}: {
  children: React.ReactNode;
  bg?: string;
  nativeID?: string;
  first?: boolean;
  last?: boolean;
}) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 980;
  return (
    <View
      nativeID={nativeID}
      style={{
        backgroundColor: bg,
        paddingHorizontal: isDesktop ? SECTION_PAD_X_DESKTOP : SECTION_PAD_X_MOBILE,
        paddingTop: first ? SECTION_PAD_Y * 0.6 : SECTION_PAD_Y,
        paddingBottom: last ? SECTION_PAD_Y * 1.3 : SECTION_PAD_Y,
      }}
    >
      <View style={{ maxWidth: MAX_W, width: "100%", alignSelf: "center" }}>{children}</View>
    </View>
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
        borderRadius: 4,
        paddingHorizontal: 9,
        paddingVertical: 5,
        backgroundColor: `${tone}18`,
        borderWidth: 1,
        borderColor: `${tone}40`,
      }}
    >
      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: tone }} />
      <Text
        style={{
          color: tone,
          fontFamily: FONT_MONO,
          fontWeight: "700",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.6,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

/** Ledger-style metric card: mono numerals, a thin tone rail on the left instead of a top bar. */
function MetricCard({
  label,
  value,
  icon,
  tone,
  index = 0,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: string;
  index?: number;
}) {
  return (
    <FadeIn delay={Math.min(index, 12) * 35} style={{ flex: 1, minWidth: 176 }}>
      <HoverCard
        glowColor={tone}
        style={{
          flexDirection: "row",
          borderRadius: 6,
          overflow: "hidden",
          backgroundColor: PANEL,
          borderWidth: 1,
          borderColor: LINE,
          minHeight: 92,
        }}
      >
        <View style={{ width: 3, backgroundColor: tone }} />
        <View style={{ flex: 1, padding: 14, justifyContent: "center", gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
            <Ionicons name={icon} size={13} color={tone} />
            <Text
              numberOfLines={1}
              style={{ color: FAINT, fontFamily: FONT_MONO, fontWeight: "700", fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase", flexShrink: 1 }}
            >
              {label}
            </Text>
          </View>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            style={{ color: TEXT, fontFamily: FONT_MONO, fontWeight: "700", fontSize: 22, letterSpacing: -0.3 }}
          >
            {value}
          </Text>
        </View>
      </HoverCard>
    </FadeIn>
  );
}

/** Signature element: a manifest tape — a perforated-looking, auto-scrolling ledger strip. */
function ManifestTape({ items }: { items: { label: string; value: string; tone: string }[] }) {
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
        duration: Math.max(18000, setWidth * 24),
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
        borderColor: LINE,
        backgroundColor: INK_RAISED,
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
            <TapeItem key={`a-${i}`} {...it} />
          ))}
        </View>
        <View style={{ flexDirection: "row" }}>
          {items.map((it, i) => (
            <TapeItem key={`b-${i}`} {...it} />
          ))}
        </View>
      </Animated.View>
      <LinearGradient
        pointerEvents="none"
        colors={[INK, "rgba(10,11,15,0)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 42 }}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(10,11,15,0)", INK]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: 42 }}
      />
    </View>
  );
}

function TapeItem({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 11, paddingHorizontal: 20 }}>
      <Text style={{ color: tone, fontFamily: FONT_MONO, fontSize: 12 }}>●</Text>
      <Text style={{ color: FAINT, fontFamily: FONT_MONO, fontWeight: "700", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6 }}>
        {label}
      </Text>
      <Text style={{ color: TEXT, fontFamily: FONT_MONO, fontWeight: "700", fontSize: 12 }}>{value}</Text>
    </View>
  );
}

/**
 * Demo video card. Plays inline the moment a viewer taps it — no redirect,
 * no new tab. `autoPlay` (used for the first video on the dedicated demo
 * page) starts muted immediately, the only way browsers allow autoplay;
 * on-screen controls let people unmute.
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
  const videoUrl = resolveMedia(demo.video_url, (demo as any).video_storage_path);
  const thumbUrl = resolveMedia(demo.thumbnail_url, (demo as any).thumbnail_storage_path);
  const [playing, setPlaying] = useState(Boolean(autoPlay && videoUrl));
  const [failed, setFailed] = useState(false);

  const showPlayer = playing && !!videoUrl && !failed;

  return (
    <FadeIn delay={index * 55} style={{ flex: 1, minWidth: 260 }}>
      <HoverCard
        glowColor={COBALT}
        style={{ borderRadius: 6, overflow: "hidden", borderWidth: 1, borderColor: LINE, backgroundColor: PANEL }}
      >
        <View style={{ aspectRatio: 16 / 9, backgroundColor: SURFACE }}>
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
              {thumbUrl ? (
                <Image source={{ uri: thumbUrl }} resizeMode="cover" style={{ position: "absolute", width: "100%", height: "100%" }} />
              ) : (
                <Image source={LOGO} resizeMode="contain" style={{ width: 84, height: 84, opacity: 0.85 }} />
              )}
              <LinearGradient
                colors={["rgba(10,11,15,0)", "rgba(10,11,15,0.6)"]}
                style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 64 }}
              />
              <View
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: 27,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(10,11,15,0.6)",
                  borderWidth: 1,
                  borderColor: "rgba(245,246,250,0.3)",
                  opacity: videoUrl ? 1 : 0.5,
                }}
              >
                <Ionicons name="play" size={22} color={TEXT} style={{ marginLeft: 3 }} />
              </View>
            </Pressable>
          )}
        </View>
        <View style={{ padding: 15, gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <Text style={{ color: TEXT, fontFamily: FONT_DISPLAY, fontWeight: "700", fontSize: 16, flex: 1 }}>{demo.title}</Text>
            {showPlayer ? <StatusPill label="Playing" tone={LIME} /> : null}
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
                marginTop: 4,
                opacity: videoUrl ? (pressed ? 0.82 : 1) : 0.4,
                borderRadius: 5,
                minHeight: 40,
                paddingHorizontal: 12,
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "row",
                gap: 8,
                backgroundColor: "rgba(76,111,255,0.14)",
                borderWidth: 1,
                borderColor: "rgba(76,111,255,0.36)",
              })}
            >
              <Ionicons name="play-circle-outline" size={16} color={COBALT} />
              <Text style={{ color: "#AFC0FF", fontWeight: "800", fontFamily: FONT_MONO, fontSize: 12 }}>
                {videoUrl ? "PLAY DEMO" : "COMING SOON"}
              </Text>
            </Pressable>
          ) : null}
          {failed ? (
            <Text style={{ color: CORAL, fontSize: 12 }}>This video couldn't be played. Please try again.</Text>
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

  const heroUrl = resolveMedia(config.hero_media_url, (config as any).hero_media_storage_path);

  const metricCards: Array<{
    label: string;
    value: string;
    icon: keyof typeof Ionicons.glyphMap;
    tone: string;
  }> = [
    { label: "Total users", value: formatMetric(stats.total_users), icon: "people-outline", tone: COBALT },
    { label: "Verified users", value: formatMetric(stats.total_verified_users), icon: "shield-checkmark-outline", tone: LIME },
    { label: "Total orders", value: formatMetric(stats.total_orders), icon: "receipt-outline", tone: AMBER },
    { label: "Completed orders", value: formatMetric(stats.number_of_completed_orders), icon: "checkmark-done-outline", tone: LIME },
    { label: "Transactions", value: formatMetric(stats.total_transactions), icon: "swap-horizontal-outline", tone: VIOLET },
    { label: "Daily volume", value: moneyMetric(stats.daily_transaction_volume), icon: "pulse-outline", tone: CORAL },
    { label: "Trading volume", value: moneyMetric(stats.total_trading_volume), icon: "bar-chart-outline", tone: COBALT },
    { label: "Stock volume", value: moneyMetric(stats.total_stock_volume), icon: "trending-up-outline", tone: SKY },
    { label: "Reinvestment fees", value: moneyMetric(stats.total_stock_reinvestment_fees), icon: "repeat-outline", tone: AMBER },
    { label: "Locked in escrow", value: moneyMetric(stats.total_value_locked_in_escrow), icon: "lock-closed-outline", tone: LIME },
    { label: "Payouts made", value: moneyMetric(stats.total_payouts_made), icon: "cash-outline", tone: VIOLET },
    { label: "Disputes", value: formatMetric(stats.number_of_disputes), icon: "alert-circle-outline", tone: CORAL },
    { label: "Open disputes", value: formatMetric(stats.open_disputes), icon: "warning-outline", tone: AMBER },
    { label: "Active listings", value: formatMetric(stats.active_listings), icon: "storefront-outline", tone: COBALT },
    { label: "Active sellers", value: formatMetric(stats.active_sellers), icon: "briefcase-outline", tone: SKY },
    { label: "Stock identities", value: formatMetric(stats.stock_identities), icon: "analytics-outline", tone: VIOLET },
    { label: "Listing reviews", value: formatMetric(stats.listing_reviews), icon: "star-outline", tone: LIME },
  ];

  const tapeItems = useMemo(
    () => metricCards.map((m) => ({ label: m.label, value: m.value, tone: m.tone })),
    [payload]
  );

  function renderNav() {
    return (
      <View
        style={{
          position: "absolute",
          top: insets.top + 12,
          left: 0,
          right: 0,
          zIndex: 10,
          paddingHorizontal: isDesktop ? SECTION_PAD_X_DESKTOP : SECTION_PAD_X_MOBILE,
        }}
      >
        <View
          style={{
            maxWidth: MAX_W,
            width: "100%",
            alignSelf: "center",
            minHeight: 56,
            borderRadius: 6,
            paddingHorizontal: 12,
            paddingVertical: 8,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            backgroundColor: "rgba(10,11,15,0.82)",
            borderWidth: 1,
            borderColor: LINE,
          }}
        >
          <Pressable onPress={() => router.push("/" as any)} style={{ flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 }}>
            <View style={{ borderRadius: 6, padding: 1.5, backgroundColor: `${LIME}40` }}>
              <Image source={LOGO} style={{ width: 32, height: 32, borderRadius: 5 }} />
            </View>
            <Text numberOfLines={1} style={{ color: TEXT, fontFamily: FONT_DISPLAY, fontWeight: "700", fontSize: 16, letterSpacing: -0.2 }}>
              {config.brand_name}
            </Text>
          </Pressable>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {isDesktop && !demoOnly ? (
              <>
                <Pressable onPress={() => openHref("#stats")} style={{ paddingHorizontal: 10, paddingVertical: 9 }}>
                  <Text style={{ color: MUTED, fontFamily: FONT_MONO, fontWeight: "700", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Stats</Text>
                </Pressable>
                <Pressable onPress={() => openHref(demoUrl)} style={{ paddingHorizontal: 10, paddingVertical: 9 }}>
                  <Text style={{ color: MUTED, fontFamily: FONT_MONO, fontWeight: "700", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Demo</Text>
                </Pressable>
              </>
            ) : null}
            <Pressable
              onPress={() => openHref("/(auth)/login")}
              style={({ pressed }) => ({
                opacity: pressed ? 0.82 : 1,
                borderRadius: 5,
                paddingHorizontal: 14,
                paddingVertical: 10,
                backgroundColor: LIME,
              })}
            >
              <Text style={{ color: "#08110A", fontWeight: "800", fontSize: 12 }}>Sign in</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  function renderHero() {
    const heroMinHeight = Math.max(540, Math.min(720, height * 0.8));
    const content = (
      <LinearGradient
        colors={["rgba(10,11,15,0.4)", "rgba(10,11,15,0.92)", INK]}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={{ minHeight: heroMinHeight, paddingTop: insets.top + 92, paddingHorizontal: isDesktop ? SECTION_PAD_X_DESKTOP : SECTION_PAD_X_MOBILE, justifyContent: "flex-end" }}
      >
        <GlowOrb color={COBALT} size={480} top={-100} right={-120} opacity={0.24} />
        <GlowOrb color={LIME} size={360} bottom={20} left={-100} opacity={0.14} />
        <View style={{ maxWidth: MAX_W, width: "100%", alignSelf: "center", paddingBottom: 48 }}>
          <FadeIn style={{ maxWidth: isWide ? 800 : 700 }}>
            <Kicker label={config.hero_eyebrow} tone={LIME} />
            <Text
              style={{
                marginTop: 16,
                color: TEXT,
                fontFamily: FONT_DISPLAY,
                fontWeight: "700",
                fontSize: isDesktop ? 66 : 40,
                lineHeight: isDesktop ? 70 : 45,
                letterSpacing: -1,
              }}
            >
              {config.hero_title}
            </Text>
            <Text
              style={{
                marginTop: 16,
                color: "rgba(245,246,250,0.8)",
                fontSize: isDesktop ? 18 : 15,
                lineHeight: isDesktop ? 28 : 23,
                maxWidth: 680,
              }}
            >
              {config.hero_subtitle}
            </Text>
            <View style={{ marginTop: 26, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              <Pressable
                onPress={() => openHref(config.primary_cta_route)}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.88 : 1,
                  borderRadius: 6,
                  overflow: "hidden",
                  minHeight: 50,
                })}
              >
                <View
                  style={{
                    minHeight: 50,
                    paddingHorizontal: 20,
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "row",
                    gap: 8,
                    backgroundColor: LIME,
                  }}
                >
                  <Text style={{ color: "#08110A", fontWeight: "800" }}>{config.primary_cta_label}</Text>
                  <Ionicons name="arrow-forward" size={17} color="#08110A" />
                </View>
              </Pressable>
              <Pressable
                onPress={() => openHref(config.secondary_cta_route)}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.84 : 1,
                  borderRadius: 6,
                  minHeight: 50,
                  paddingHorizontal: 20,
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  gap: 8,
                  backgroundColor: "rgba(245,246,250,0.06)",
                  borderWidth: 1,
                  borderColor: LINE,
                })}
              >
                <Text style={{ color: TEXT, fontWeight: "800" }}>{config.secondary_cta_label}</Text>
              </Pressable>
            </View>
          </FadeIn>
        </View>
      </LinearGradient>
    );

    if (!heroUrl) {
      return <View style={{ backgroundColor: INK }}>{content}</View>;
    }
    return (
      <ImageBackground source={{ uri: heroUrl }} resizeMode="cover" style={{ minHeight: heroMinHeight, backgroundColor: INK }}>
        {content}
      </ImageBackground>
    );
  }

  function renderOverview() {
    const cards = [
      { title: config.mission_title, body: config.mission_body, tone: LIME },
      { title: config.vision_title, body: config.vision_body, tone: COBALT },
      { title: config.what_building_title, body: config.what_building_body, tone: SKY },
      { title: config.why_building_title, body: config.why_building_body, tone: AMBER },
    ];
    return (
      <Section bg={INK} first>
        <View style={{ flexDirection: isDesktop ? "row" : "column", gap: 22 }}>
          <View style={{ flex: 1.1 }}>
            <SectionHeader eyebrow="Company overview" title="Commerce infrastructure for trusted digital cities" body={config.company_overview} />
          </View>
          <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {cards.map((item, i) => (
              <FadeIn key={item.title} delay={i * 55} style={{ flex: 1, minWidth: 230 }}>
                <HoverCard
                  glowColor={item.tone}
                  style={{ borderRadius: 6, borderWidth: 1, borderColor: LINE, backgroundColor: PANEL, padding: 16 }}
                >
                  <View style={{ width: 24, height: 2, backgroundColor: item.tone }} />
                  <Text style={{ marginTop: 13, color: TEXT, fontFamily: FONT_DISPLAY, fontWeight: "700", fontSize: 17 }}>{item.title}</Text>
                  <Text style={{ marginTop: 8, color: MUTED, fontSize: 13, lineHeight: 20 }}>{item.body}</Text>
                </HoverCard>
              </FadeIn>
            ))}
          </View>
        </View>
      </Section>
    );
  }

  function renderSections() {
    if (!sections.length) return null;
    return (
      <Section bg={SURFACE}>
        <View style={{ gap: 20 }}>
          {sections.map((section, index) => {
            const mediaUrl = resolveMedia(section.media_url, (section as any).media_storage_path);
            return (
              <FadeIn key={section.id} delay={Math.min(index, 4) * 55}>
                <View
                  style={{
                    flexDirection: isDesktop && index % 2 === 1 ? "row-reverse" : isDesktop ? "row" : "column",
                    alignItems: "stretch",
                    gap: 18,
                  }}
                >
                  <View style={{ flex: 1, justifyContent: "center", paddingVertical: 14 }}>
                    <SectionHeader eyebrow={section.eyebrow || undefined} title={section.title} body={section.body} maxWidth={720} />
                    {section.cta_label && section.cta_url ? (
                      <Pressable
                        onPress={() => openHref(section.cta_url)}
                        style={{
                          marginTop: 18,
                          alignSelf: "flex-start",
                          borderRadius: 5,
                          paddingHorizontal: 14,
                          paddingVertical: 11,
                          backgroundColor: "rgba(182,255,60,0.12)",
                          borderWidth: 1,
                          borderColor: "rgba(182,255,60,0.4)",
                        }}
                      >
                        <Text style={{ color: LIME, fontWeight: "800" }}>{section.cta_label}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <View style={{ flex: 0.82, minHeight: 240, borderRadius: 6, borderWidth: 1, borderColor: LINE, overflow: "hidden", backgroundColor: PANEL }}>
                    {mediaUrl ? (
                      <Image source={{ uri: mediaUrl }} resizeMode="cover" style={{ width: "100%", height: "100%" }} />
                    ) : (
                      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 28 }}>
                        <Image source={LOGO} resizeMode="contain" style={{ width: 100, height: 100, opacity: 0.85 }} />
                      </View>
                    )}
                  </View>
                </View>
              </FadeIn>
            );
          })}
        </View>
      </Section>
    );
  }

  function renderStats() {
    return (
      <Section bg={INK} nativeID="stats">
        <View style={{ position: "relative" }}>
          <GlowOrb color={VIOLET} size={460} top={-60} left={-160} opacity={0.14} />
          <View style={{ gap: 22 }}>
            <View style={{ flexDirection: isDesktop ? "row" : "column", gap: 18, alignItems: isDesktop ? "flex-end" : "flex-start", justifyContent: "space-between" }}>
              <SectionHeader eyebrow="Real-time ledger" title={config.stats_title} body={config.stats_subtitle} />
              <View style={{ alignItems: isDesktop ? "flex-end" : "flex-start", gap: 6 }}>
                <LiveDot color={LIME} />
                <Text style={{ color: FAINT, fontFamily: FONT_MONO, fontSize: 11 }}>
                  Updated {cleanText(String(payload?.generated_at || ""), "just now")}
                </Text>
              </View>
            </View>
            {loading ? (
              <View style={{ borderRadius: 6, borderWidth: 1, borderColor: LINE, padding: 24, backgroundColor: PANEL, alignItems: "center" }}>
                <ActivityIndicator color={LIME} />
                <Text style={{ marginTop: 10, color: MUTED, fontWeight: "700" }}>Loading platform statistics</Text>
              </View>
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                {metricCards.map((metric, i) => (
                  <MetricCard key={metric.label} {...metric} index={i} />
                ))}
              </View>
            )}
          </View>
        </View>
      </Section>
    );
  }

  function renderFeatures() {
    if (!features.length) return null;
    return (
      <Section bg={SURFACE_2}>
        <View style={{ gap: 22 }}>
          <SectionHeader eyebrow="Features" title={config.features_title} body={config.features_body} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {features.map((feature, i) => (
              <FadeIn key={feature.id} delay={Math.min(i, 8) * 50} style={{ flex: 1, minWidth: isDesktop ? 300 : 250 }}>
                <HoverCard
                  glowColor={feature.accent || COBALT}
                  style={{ borderRadius: 6, borderWidth: 1, borderColor: LINE, backgroundColor: PANEL, padding: 18, minHeight: 168 }}
                >
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 6,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: `${feature.accent || COBALT}1F`,
                      borderWidth: 1,
                      borderColor: `${feature.accent || COBALT}45`,
                    }}
                  >
                    <Ionicons name={(feature.icon_key || "sparkles-outline") as any} size={18} color={feature.accent || COBALT} />
                  </View>
                  <Text style={{ marginTop: 14, color: TEXT, fontFamily: FONT_DISPLAY, fontWeight: "700", fontSize: 17 }}>{feature.title}</Text>
                  <Text style={{ marginTop: 8, color: MUTED, fontSize: 13, lineHeight: 20 }}>{feature.body}</Text>
                </HoverCard>
              </FadeIn>
            ))}
          </View>
        </View>
      </Section>
    );
  }

  function renderBlockchainProduct() {
    return (
      <Section bg={INK}>
        <View style={{ flexDirection: isDesktop ? "row" : "column", gap: 16 }}>
          <FadeIn style={{ flex: 1 }}>
            <View style={{ borderRadius: 6, borderWidth: 1, borderColor: LINE, padding: 22, backgroundColor: PANEL_STRONG }}>
              <StatusPill label="Blockchain" tone={LIME} />
              <Text style={{ marginTop: 16, color: TEXT, fontFamily: FONT_DISPLAY, fontWeight: "700", fontSize: 25 }}>{config.blockchain_title}</Text>
              <Text style={{ marginTop: 10, color: MUTED, fontSize: 14, lineHeight: 23 }}>{config.blockchain_body}</Text>
            </View>
          </FadeIn>
          <FadeIn delay={80} style={{ flex: 1 }}>
            <View style={{ borderRadius: 6, borderWidth: 1, borderColor: LINE, padding: 22, backgroundColor: PANEL_STRONG }}>
              <StatusPill label="Product" tone={COBALT} />
              <Text style={{ marginTop: 16, color: TEXT, fontFamily: FONT_DISPLAY, fontWeight: "700", fontSize: 25 }}>{config.product_title}</Text>
              <Text style={{ marginTop: 10, color: MUTED, fontSize: 14, lineHeight: 23 }}>{config.product_body}</Text>
            </View>
          </FadeIn>
        </View>
      </Section>
    );
  }

  function renderRoadmap() {
    if (!roadmap.length) return null;
    const toneByStatus: Record<string, string> = {
      shipped: LIME,
      in_progress: COBALT,
      planned: AMBER,
      exploring: VIOLET,
    };
    return (
      <Section bg={SURFACE}>
        <View style={{ gap: 22 }}>
          <SectionHeader eyebrow="Roadmap" title={config.roadmap_title} body={config.roadmap_body} />
          <View style={{ position: "relative", paddingLeft: 50 }}>
            <View pointerEvents="none" style={{ position: "absolute", left: 19, top: 20, bottom: 20, width: 1, backgroundColor: LINE }} />
            <View style={{ gap: 14 }}>
              {roadmap.map((item, i) => {
                const tone = toneByStatus[item.status] ?? AMBER;
                return (
                  <FadeIn key={item.id} delay={Math.min(i, 8) * 50} style={{ position: "relative" }}>
                    <View
                      style={{
                        position: "absolute",
                        left: -50,
                        top: 0,
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: INK,
                        borderWidth: 1.5,
                        borderColor: tone,
                      }}
                    >
                      <Text style={{ color: tone, fontFamily: FONT_MONO, fontWeight: "700", fontSize: 12 }}>{String(i + 1).padStart(2, "0")}</Text>
                    </View>
                    <HoverCard glowColor={tone} style={{ borderRadius: 6, borderWidth: 1, borderColor: LINE, backgroundColor: PANEL, padding: 17 }}>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <StatusPill label={item.status.replace(/_/g, " ")} tone={tone} />
                        {item.target_label ? (
                          <Text style={{ color: FAINT, fontFamily: FONT_MONO, fontWeight: "700", fontSize: 10 }}>{item.target_label}</Text>
                        ) : null}
                      </View>
                      <Text style={{ marginTop: 12, color: TEXT, fontFamily: FONT_DISPLAY, fontWeight: "700", fontSize: 17 }}>{item.title}</Text>
                      <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>{item.body}</Text>
                    </HoverCard>
                  </FadeIn>
                );
              })}
            </View>
          </View>
        </View>
      </Section>
    );
  }

  /**
   * Team grid — rebuilt so cards use a percentage `flexBasis` (with a
   * min/max width clamp) instead of `flex: 1` + `minWidth`. The old combo
   * meant a single card (or short last row) would greedily fill the whole
   * row, and since the photo used `aspectRatio: 1`, a full-width card
   * produced a giant square portrait. Now:
   *  - at least 2 cards per row on mobile (~47% basis each)
   *  - ~4 cards per row on desktop (~22% basis each)
   *  - maxWidth caps every card so it never stretches to fill a half-empty
   *    row, keeping the photo a sane, consistent size everywhere.
   */
  function renderTeam() {
    return (
      <Section bg={INK}>
        <View style={{ gap: 22 }}>
          <SectionHeader eyebrow="Team" title={config.team_title} body={config.team_body} />
          {team.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              {team.map((member, i) => {
                const imgUrl = resolveMedia(member.image_url, (member as any).image_storage_path);
                return (
                  <FadeIn
                    key={member.id}
                    delay={Math.min(i, 8) * 50}
                    style={{
                      flexGrow: 0,
                      flexShrink: 0,
                      flexBasis: isDesktop ? TEAM_CARD_BASIS_DESKTOP : TEAM_CARD_BASIS_MOBILE,
                      minWidth: TEAM_CARD_MIN_WIDTH,
                      maxWidth: TEAM_CARD_MAX_WIDTH,
                    }}
                  >
                    <HoverCard glowColor={COBALT} style={{ borderRadius: 6, borderWidth: 1, borderColor: LINE, backgroundColor: PANEL, overflow: "hidden" }}>
                      <View style={{ aspectRatio: 1, backgroundColor: SURFACE, alignItems: "center", justifyContent: "center" }}>
                        {imgUrl ? (
                          <Image source={{ uri: imgUrl }} resizeMode="cover" style={{ width: "100%", height: "100%" }} />
                        ) : (
                          <Image source={LOGO} resizeMode="contain" style={{ width: 56, height: 56, opacity: 0.75 }} />
                        )}
                      </View>
                      <View style={{ padding: 12 }}>
                        <Text numberOfLines={1} style={{ color: TEXT, fontFamily: FONT_DISPLAY, fontWeight: "700", fontSize: 15 }}>
                          {member.name}
                        </Text>
                        <Text numberOfLines={1} style={{ marginTop: 3, color: LIME, fontFamily: FONT_MONO, fontWeight: "700", fontSize: 10, textTransform: "uppercase" }}>
                          {member.role_title}
                        </Text>
                        {member.bio ? (
                          <Text numberOfLines={3} style={{ marginTop: 7, color: MUTED, fontSize: 12, lineHeight: 17 }}>
                            {member.bio}
                          </Text>
                        ) : null}
                      </View>
                    </HoverCard>
                  </FadeIn>
                );
              })}
            </View>
          ) : (
            <View style={{ borderRadius: 6, borderWidth: 1, borderColor: LINE, padding: 18, backgroundColor: PANEL }}>
              <Text style={{ color: MUTED, fontSize: 14, lineHeight: 21 }}>Profiles for our team are being finalized — check back soon.</Text>
            </View>
          )}
        </View>
      </Section>
    );
  }

  function renderDemoSection(fullPage = false) {
    return (
      <Section bg={fullPage ? INK : SURFACE_2} nativeID="videos" first={fullPage} last={fullPage}>
        <View style={{ gap: 22, minHeight: fullPage ? Math.max(600, height * 0.7) : undefined }}>
          <View style={{ flexDirection: isDesktop ? "row" : "column", alignItems: isDesktop ? "flex-end" : "flex-start", justifyContent: "space-between", gap: 16 }}>
            <SectionHeader eyebrow="Demo" title={config.demo_title} body={config.demo_body} />
            {!fullPage ? (
              <Pressable
                onPress={() => openHref(demoUrl)}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.86 : 1,
                  borderRadius: 6,
                  minHeight: 48,
                  paddingHorizontal: 18,
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  gap: 8,
                  backgroundColor: LIME,
                })}
              >
                <Text style={{ color: "#08110A", fontWeight: "800" }}>{config.demo_cta_label}</Text>
                <Ionicons name="play" size={16} color="#08110A" />
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
            <View style={{ borderRadius: 6, borderWidth: 1, borderColor: LINE, backgroundColor: PANEL, padding: 22, flexDirection: isDesktop ? "row" : "column", alignItems: "center", gap: 16 }}>
              <Image source={LOGO} style={{ width: 68, height: 68, borderRadius: 8 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: TEXT, fontFamily: FONT_DISPLAY, fontWeight: "700", fontSize: 18 }}>New walkthroughs are on the way</Text>
                <Text style={{ marginTop: 6, color: MUTED, lineHeight: 20 }}>
                  We're putting the finishing touches on product walkthroughs so you can see the platform in action. Check back soon.
                </Text>
              </View>
            </View>
          )}
        </View>
      </Section>
    );
  }

  /** FAQ + Contact — rebuilt as two clearly separated, independently-scoped columns.
   * No absolutely-positioned or oversized elements here, so nothing can render
   * on top of anything else regardless of viewport width. */
  function renderFaqContact() {
    return (
      <Section bg={INK} last>
        <View style={{ flexDirection: isDesktop ? "row" : "column", gap: 40, alignItems: "flex-start" }}>
          <View style={{ flex: 1, width: "100%", gap: 14 }}>
            <SectionHeader eyebrow="FAQ" title={config.faq_title} body={config.faq_body} />
            <View style={{ gap: 10, marginTop: 4 }}>
              {faqs.map((faq, i) => (
                <FadeIn key={faq.id} delay={Math.min(i, 8) * 40}>
                  <View style={{ borderRadius: 6, borderWidth: 1, borderColor: LINE, backgroundColor: PANEL, padding: 16 }}>
                    <Text style={{ color: TEXT, fontFamily: FONT_DISPLAY, fontWeight: "700", fontSize: 15 }}>{faq.question}</Text>
                    <Text style={{ marginTop: 7, color: MUTED, fontSize: 13, lineHeight: 20 }}>{faq.answer}</Text>
                  </View>
                </FadeIn>
              ))}
            </View>
          </View>

          <View
            style={{
              flex: isDesktop ? 0.72 : undefined,
              width: "100%",
              borderRadius: 6,
              borderWidth: 1,
              borderColor: LINE,
              backgroundColor: PANEL_STRONG,
              padding: 22,
            }}
          >
            <SectionHeader eyebrow="Contact" title={config.contact_title} body={config.contact_body} maxWidth={520} />
            <View style={{ marginTop: 18, gap: 12 }}>
              <Pressable onPress={() => void Linking.openURL(`mailto:${config.contact_email}`)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Ionicons name="mail-outline" size={17} color={LIME} />
                <Text style={{ color: TEXT, fontWeight: "700", fontSize: 13 }}>{config.contact_email}</Text>
              </Pressable>
              {config.contact_phone ? (
                <Pressable onPress={() => void Linking.openURL(`tel:${config.contact_phone}`)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Ionicons name="call-outline" size={17} color={COBALT} />
                  <Text style={{ color: TEXT, fontWeight: "700", fontSize: 13 }}>{config.contact_phone}</Text>
                </Pressable>
              ) : null}
              {config.contact_address ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Ionicons name="location-outline" size={17} color={SKY} />
                  <Text style={{ color: TEXT, fontWeight: "700", fontSize: 13, flex: 1 }}>{config.contact_address}</Text>
                </View>
              ) : null}
            </View>
            <Pressable
              onPress={() => openHref(config.contact_cta_route)}
              style={({ pressed }) => ({
                marginTop: 20,
                opacity: pressed ? 0.84 : 1,
                borderRadius: 5,
                minHeight: 46,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: LIME,
              })}
            >
              <Text style={{ color: "#08110A", fontWeight: "800" }}>{config.contact_cta_label}</Text>
            </Pressable>
          </View>
        </View>
      </Section>
    );
  }

  function renderFooter() {
    return (
      <View style={{ backgroundColor: INK_RAISED, borderTopWidth: 1, borderTopColor: LINE, paddingHorizontal: isDesktop ? SECTION_PAD_X_DESKTOP : SECTION_PAD_X_MOBILE, paddingVertical: 28 }}>
        <View
          style={{
            maxWidth: MAX_W,
            width: "100%",
            alignSelf: "center",
            flexDirection: isDesktop ? "row" : "column",
            alignItems: isDesktop ? "center" : "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <Text style={{ color: FAINT, fontFamily: FONT_MONO, fontSize: 11 }}>
            © {new Date().getFullYear()} {config.brand_name}. All rights reserved.
          </Text>
          <LiveDot color={LIME} label="System operational" />
        </View>
      </View>
    );
  }

  if (demoOnly) {
    return (
      <View style={{ flex: 1, backgroundColor: INK }}>
        {renderNav()}
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom }}>
          {renderDemoSection(true)}
          {renderFooter()}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: INK }}>
      {renderNav()}
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom }}>
        {renderHero()}
        <ManifestTape items={tapeItems} />
        {error ? (
          <View style={{ backgroundColor: INK, paddingHorizontal: isDesktop ? SECTION_PAD_X_DESKTOP : SECTION_PAD_X_MOBILE, paddingTop: 18 }}>
            <View style={{ maxWidth: MAX_W, width: "100%", alignSelf: "center", borderRadius: 6, borderWidth: 1, borderColor: "rgba(255,92,114,0.4)", backgroundColor: "rgba(255,92,114,0.1)", padding: 14 }}>
              <Text style={{ color: "#FFC2CB", fontWeight: "700" }}>{error}</Text>
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
        {renderFooter()}
      </ScrollView>
    </View>
  );
}