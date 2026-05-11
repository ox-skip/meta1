import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.68)";
const FAINT = "rgba(255,253,247,0.42)";
const PANEL = "rgba(255,253,247,0.065)";
const BORDER = "rgba(255,253,247,0.12)";
const BORDER_TOP = "rgba(255,253,247,0.22)";
const TEAL = "#2DD4BF";
const INK = "#090D0B";

function normalizeUrl(input: string) {
  const s = input.trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(s)) return `https://${s}`;
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}

export function WatermarkedBrowser({
  initialUrl,
  allowGoogleSearch = true,
  lockToInitialHost: _lockToInitialHost = true,
  title = "Website preview",
}: {
  initialUrl: string;
  allowGoogleSearch?: boolean;
  lockToInitialHost?: boolean;
  title?: string;
}) {
  const [q, setQ] = useState("");
  const initial = useMemo(() => normalizeUrl(initialUrl), [initialUrl]);

  function openUrl(value: string) {
    const next = normalizeUrl(value);
    if (!next) return;
    window.open(next, "_blank", "noopener,noreferrer");
  }

  return (
    <View
      style={{
        marginTop: 12,
        flex: 1,
        minHeight: 360,
        borderRadius: 22,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: BORDER_TOP,
        backgroundColor: "#050706",
      }}
    >
      <View
        style={{
          padding: 12,
          backgroundColor: "rgba(8,12,10,0.94)",
          borderBottomWidth: 1,
          borderBottomColor: BORDER,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 14 }}>
              {title}
            </Text>
            <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>Secure preview</Text>
          </View>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(45,212,191,0.12)",
              borderWidth: 1,
              borderColor: "rgba(45,212,191,0.32)",
            }}
          >
            <Ionicons name="shield-checkmark-outline" size={18} color={TEAL} />
          </View>
        </View>

        {allowGoogleSearch ? (
          <View
            style={{
              marginTop: 10,
              flexDirection: "row",
              gap: 8,
              alignItems: "center",
              borderRadius: 16,
              paddingLeft: 12,
              paddingRight: 6,
              paddingVertical: 6,
              backgroundColor: PANEL,
              borderWidth: 1,
              borderColor: BORDER,
            }}
          >
            <Ionicons name="search-outline" size={18} color={MUTED} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search or enter website"
              placeholderTextColor={FAINT}
              style={{ flex: 1, minHeight: 38, color: TEXT, fontWeight: "800" }}
              returnKeyType="search"
              onSubmitEditing={() => openUrl(q)}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable
              onPress={() => openUrl(q)}
              accessibilityRole="button"
              accessibilityLabel="Open website"
              style={({ pressed }) => ({
                width: 38,
                height: 38,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: TEAL,
                transform: [{ scale: pressed ? 0.96 : 1 }],
              })}
            >
              <Ionicons name="arrow-forward" size={18} color={INK} />
            </Pressable>
          </View>
        ) : null}

        <Pressable
          onPress={() => openUrl(initial)}
          accessibilityRole="button"
          accessibilityLabel="Open website"
          style={({ pressed }) => ({
            marginTop: 10,
            borderRadius: 16,
            paddingVertical: 12,
            alignItems: "center",
            backgroundColor: TEAL,
            transform: [{ scale: pressed ? 0.99 : 1 }],
          })}
        >
          <Text style={{ color: INK, fontWeight: "900" }}>Open website</Text>
        </Pressable>
      </View>

      <View
        style={{
          flex: 1,
          minHeight: 220,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#020302",
          paddingHorizontal: 18,
        }}
      >
        <Ionicons name="open-outline" size={24} color={TEAL} />
        <Text style={{ marginTop: 10, color: TEXT, fontWeight: "900", textAlign: "center" }}>Website preview</Text>
        <Text style={{ marginTop: 6, color: MUTED, textAlign: "center" }}>Open the site to continue.</Text>
      </View>
    </View>
  );
}
