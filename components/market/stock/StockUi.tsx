import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";

type IconName = React.ComponentProps<typeof Ionicons>["name"];
type Tone = "mint" | "cyan" | "amber" | "red" | "plain";

export const STOCK = {
  bgTop: "#171A13",
  bgMid: "#10130E",
  bgBottom: "#060807",
  panel: "rgba(255,255,255,0.075)",
  panelStrong: "rgba(255,255,255,0.115)",
  panelSoft: "rgba(255,255,255,0.045)",
  border: "rgba(255,255,255,0.13)",
  borderStrong: "rgba(255,255,255,0.22)",
  ink: "#F8FAFC",
  muted: "rgba(248,250,252,0.68)",
  faint: "rgba(248,250,252,0.46)",
  mint: "#2DD4BF",
  cyan: "#38BDF8",
  amber: "#F4B75D",
  red: "#FB7185",
  modal: "#07110F",
};

const toneMap: Record<Tone, { ink: string; bg: string; border: string }> = {
  mint: { ink: "#CCFBF1", bg: "rgba(45,212,191,0.16)", border: "rgba(94,234,212,0.42)" },
  cyan: { ink: "#CFFAFE", bg: "rgba(34,211,238,0.14)", border: "rgba(34,211,238,0.38)" },
  amber: { ink: "#FEF3C7", bg: "rgba(244,183,93,0.16)", border: "rgba(244,183,93,0.42)" },
  red: { ink: "#FFE4E6", bg: "rgba(251,113,133,0.14)", border: "rgba(251,113,133,0.4)" },
  plain: { ink: STOCK.ink, bg: "rgba(255,255,255,0.06)", border: STOCK.border },
};

function finiteNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function formatStockMoney(value: unknown, digits = 2) {
  const n = finiteNumber(value);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(digits)}`;
}

export function formatStockPrice(value: unknown, digits = 6) {
  return `$${finiteNumber(value).toFixed(digits)}`;
}

export function formatStockQuantity(value: unknown, digits = 4) {
  const n = finiteNumber(value);
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(digits);
}

export function formatStockPct(value: unknown) {
  const n = finiteNumber(value);
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function stockChainLabel(chain?: unknown) {
  const raw = String(chain || "").trim();
  if (!raw) return "EVM";
  if (raw.toLowerCase() === "pi_testnet") return "External";
  return raw.toUpperCase().replace(/_/g, " ");
}

export function StockScreen({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <LinearGradient
      colors={[STOCK.bgTop, STOCK.bgMid, STOCK.bgBottom]}
      style={[{ flex: 1, paddingHorizontal: 16, paddingTop: 14 }, style]}
    >
      {children}
    </LinearGradient>
  );
}
export function StockPanel({
  children,
  style,
  tone = "plain",
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: Tone;
}) {
  const colors = toneMap[tone];
  return (
    <View
      style={[
        {
          borderRadius: 18,
          padding: 14,
          backgroundColor: tone === "plain" ? STOCK.panel : colors.bg,
          borderWidth: 1,
          borderColor: tone === "plain" ? STOCK.border : colors.border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function StockPill({
  label,
  tone = "plain",
  icon,
  compact = false,
}: {
  label: string;
  tone?: Tone;
  icon?: IconName;
  compact?: boolean;
}) {
  const colors = toneMap[tone];
  return (
    <View
      style={{
        borderRadius: 999,
        paddingHorizontal: compact ? 8 : 10,
        paddingVertical: compact ? 4 : 6,
        backgroundColor: colors.bg,
        borderWidth: 1,
        borderColor: colors.border,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        alignSelf: "flex-start",
      }}
    >
      {icon ? <Ionicons name={icon} size={compact ? 11 : 13} color={colors.ink} /> : null}
      <Text style={{ color: colors.ink, fontSize: compact ? 10 : 11, fontWeight: "900" }}>{label}</Text>
    </View>
  );
}

export function StockMetric({
  label,
  value,
  caption,
  tone = "plain",
  style,
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: Tone;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = toneMap[tone];
  return (
    <View
      style={[
        {
          flex: 1,
          minWidth: 96,
          borderRadius: 15,
          padding: 12,
          backgroundColor: tone === "plain" ? STOCK.panelSoft : colors.bg,
          borderWidth: 1,
          borderColor: tone === "plain" ? STOCK.border : colors.border,
        },
        style,
      ]}
    >
      <Text style={{ color: STOCK.muted, fontSize: 11, fontWeight: "800" }}>{label}</Text>
      <Text style={{ marginTop: 5, color: STOCK.ink, fontSize: 17, fontWeight: "900" }}>{value}</Text>
      {caption ? <Text style={{ marginTop: 3, color: STOCK.faint, fontSize: 10, fontWeight: "700" }}>{caption}</Text> : null}
    </View>
  );
}

export function StockActionTile({
  icon,
  label,
  caption,
  onPress,
  tone = "plain",
  disabled = false,
  style,
}: {
  icon: IconName;
  label: string;
  caption?: string;
  onPress?: () => void;
  tone?: Tone;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = toneMap[tone];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        {
          flex: 1,
          minHeight: 82,
          borderRadius: 18,
          padding: 12,
          backgroundColor: tone === "plain" ? STOCK.panelSoft : colors.bg,
          borderWidth: 1,
          borderColor: tone === "plain" ? STOCK.border : colors.border,
          opacity: disabled ? 0.55 : 1,
          justifyContent: "space-between",
        },
        style,
      ]}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 13,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(0,0,0,0.18)",
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Ionicons name={icon} size={18} color={colors.ink} />
      </View>
      <View>
        <Text style={{ color: STOCK.ink, fontWeight: "900", fontSize: 13 }} numberOfLines={1}>
          {label}
        </Text>
        {caption ? (
          <Text style={{ marginTop: 2, color: STOCK.muted, fontSize: 10, fontWeight: "700" }} numberOfLines={1}>
            {caption}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function StockSegment<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ key: T; label: string; tone?: Tone }>;
  onChange: (next: T) => void;
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {options.map((option) => {
        const active = value === option.key;
        const colors = toneMap[option.tone ?? "mint"];
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            style={{
              borderRadius: 999,
              paddingHorizontal: 12,
              paddingVertical: 8,
              backgroundColor: active ? colors.bg : STOCK.panelSoft,
              borderWidth: 1,
              borderColor: active ? colors.border : STOCK.border,
            }}
          >
            <Text style={{ color: active ? colors.ink : STOCK.muted, fontSize: 11, fontWeight: "900" }}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function StockSearchField(props: TextInputProps & { icon?: IconName }) {
  const { icon = "search-outline", style, ...rest } = props;
  return (
    <View
      style={{
        borderRadius: 17,
        paddingHorizontal: 12,
        minHeight: 48,
        backgroundColor: STOCK.panel,
        borderWidth: 1,
        borderColor: STOCK.border,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
      }}
    >
      <Ionicons name={icon} size={18} color={STOCK.muted} />
      <TextInput
        placeholderTextColor={STOCK.faint}
        {...rest}
        style={[{ flex: 1, color: STOCK.ink, fontWeight: "800", minHeight: 44 }, style]}
      />
    </View>
  );
}

export function StockField({
  label,
  caption,
  children,
}: {
  label: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <StockPanel style={{ gap: 8 }}>
      <Text style={{ color: STOCK.ink, fontWeight: "900", fontSize: 13 }}>{label}</Text>
      {caption ? <Text style={{ color: STOCK.muted, fontSize: 11, lineHeight: 16 }}>{caption}</Text> : null}
      {children}
    </StockPanel>
  );
}

export function StockInput(props: TextInputProps) {
  const { style, ...rest } = props;
  return (
    <TextInput
      placeholderTextColor={STOCK.faint}
      {...rest}
      style={[
        {
          borderRadius: 14,
          paddingHorizontal: 12,
          paddingVertical: 11,
          color: STOCK.ink,
          backgroundColor: STOCK.panelSoft,
          borderWidth: 1,
          borderColor: STOCK.border,
          fontWeight: "800",
        },
        style,
      ]}
    />
  );
}

export function StockEmptyState({
  icon = "cube-outline",
  title,
  message,
  actionLabel,
  onAction,
}: {
  icon?: IconName;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <StockPanel style={{ alignItems: "center", paddingVertical: 20 }}>
      <View
        style={{
          width: 46,
          height: 46,
          borderRadius: 18,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: toneMap.cyan.bg,
          borderWidth: 1,
          borderColor: toneMap.cyan.border,
        }}
      >
        <Ionicons name={icon} size={22} color={toneMap.cyan.ink} />
      </View>
      <Text style={{ marginTop: 12, color: STOCK.ink, fontSize: 16, fontWeight: "900", textAlign: "center" }}>
        {title}
      </Text>
      {message ? <Text style={{ marginTop: 6, color: STOCK.muted, textAlign: "center", lineHeight: 19 }}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          style={{
            marginTop: 14,
            borderRadius: 14,
            paddingHorizontal: 16,
            paddingVertical: 11,
            backgroundColor: toneMap.mint.bg,
            borderWidth: 1,
            borderColor: toneMap.mint.border,
          }}
        >
          <Text style={{ color: toneMap.mint.ink, fontWeight: "900" }}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </StockPanel>
  );
}

export function StockLoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <View style={{ marginTop: 28, alignItems: "center" }}>
      <ActivityIndicator color={STOCK.mint} />
      <Text style={{ marginTop: 10, color: STOCK.muted, fontWeight: "800" }}>{label}</Text>
    </View>
  );
}

export function StockAlert({ children, tone = "red" }: { children: React.ReactNode; tone?: Tone }) {
  const colors = toneMap[tone];
  return (
    <View
      style={{
        marginTop: 12,
        borderRadius: 15,
        padding: 12,
        backgroundColor: colors.bg,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text style={{ color: colors.ink, fontWeight: "800", lineHeight: 19 }}>{children}</Text>
    </View>
  );
}
