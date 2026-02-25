import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { MarketPolicyBlock } from "@/hooks/policy/fetchMarketPolicyBlocks";

type Props = {
  title: string;
  blocks: MarketPolicyBlock[];
  emptyText?: string;
  onAction?: (action: string, block: MarketPolicyBlock) => void;
};

function toneStyles(severity: string) {
  const s = String(severity || "info").toLowerCase();
  if (s === "success") {
    return {
      bg: "rgba(16,185,129,0.12)",
      border: "rgba(16,185,129,0.35)",
      icon: "checkmark-circle-outline" as const,
    };
  }
  if (s === "warn") {
    return {
      bg: "rgba(251,191,36,0.11)",
      border: "rgba(251,191,36,0.38)",
      icon: "warning-outline" as const,
    };
  }
  if (s === "danger") {
    return {
      bg: "rgba(239,68,68,0.10)",
      border: "rgba(239,68,68,0.35)",
      icon: "alert-circle-outline" as const,
    };
  }
  return {
    bg: "rgba(255,255,255,0.05)",
    border: "rgba(255,255,255,0.12)",
    icon: "information-circle-outline" as const,
  };
}

export default function MarketPolicyPanel({ title, blocks, emptyText, onAction }: Props) {
  const rows = Array.isArray(blocks) ? blocks : [];
  if (!rows.length && !emptyText) return null;

  return (
    <View
      style={{
        marginTop: 10,
        borderRadius: 16,
        padding: 12,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.12)",
        backgroundColor: "rgba(255,255,255,0.05)",
      }}
    >
      <Text style={{ color: "#fff", fontWeight: "900", fontSize: 13 }}>{title}</Text>

      {!rows.length ? (
        <Text style={{ marginTop: 8, color: "rgba(255,255,255,0.65)", lineHeight: 20 }}>
          {emptyText || ""}
        </Text>
      ) : null}

      {rows.map((row) => {
        const tone = toneStyles(row.severity);
        return (
          <View
            key={row.id}
            style={{
              marginTop: 10,
              borderRadius: 14,
              padding: 10,
              borderWidth: 1,
              borderColor: tone.border,
              backgroundColor: tone.bg,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name={tone.icon} size={16} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "900", flex: 1 }}>{row.title}</Text>
            </View>

            {row.body ? (
              <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.75)", lineHeight: 20 }}>
                {row.body}
              </Text>
            ) : null}

            {row.bullets.length ? (
              <View style={{ marginTop: 6 }}>
                {row.bullets.map((item, idx) => (
                  <Text key={`${row.id}-b-${idx}`} style={{ marginTop: 2, color: "rgba(255,255,255,0.75)", lineHeight: 20 }}>
                    - {item}
                  </Text>
                ))}
              </View>
            ) : null}

            {onAction && row.cta_action && row.cta_label ? (
              <Pressable
                onPress={() => onAction(row.cta_action as string, row)}
                style={{
                  marginTop: 8,
                  alignSelf: "flex-start",
                  borderRadius: 10,
                  paddingVertical: 8,
                  paddingHorizontal: 10,
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.2)",
                  backgroundColor: "rgba(255,255,255,0.08)",
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>{row.cta_label}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
