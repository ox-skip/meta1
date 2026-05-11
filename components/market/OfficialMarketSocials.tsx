import React, { useMemo, useState } from "react";
import { Image, Linking, Pressable, Text, View } from "react-native";

import { useOfficialSocialLinks } from "@/hooks/market/useOfficialSocialLinks";

const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.68)";
const BORDER = "rgba(255,253,247,0.12)";
const CARD = "rgba(255,253,247,0.065)";
const TEAL = "#2DD4BF";
const INK = "#090D0B";

function extractHost(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "");
    return host || "link";
  } catch {
    return "link";
  }
}

function buildLogoUrl(url: string) {
  return `https://www.google.com/s2/favicons?sz=128&domain_url=${encodeURIComponent(url)}`;
}

function fallbackLabel(url: string, label: string | null) {
  const first = (label || extractHost(url)).trim().charAt(0).toUpperCase();
  return first || "L";
}

export default function OfficialMarketSocials() {
  const { rows, loading } = useOfficialSocialLinks();
  const [brokenLogos, setBrokenLogos] = useState<Record<string, boolean>>({});

  const items = useMemo(
    () =>
      rows
        .filter((row) => !!row.url)
        .map((row) => ({
          id: `${row.platform}-${row.url}`,
          label: row.label,
          url: row.url as string,
          host: extractHost(row.url as string),
          logoUrl: buildLogoUrl(row.url as string),
          fallback: fallbackLabel(row.url as string, row.label),
        })),
    [rows],
  );

  if (!loading && items.length === 0) return null;

  return (
    <View
      style={{
        marginTop: 10,
        borderRadius: 18,
        padding: 14,
        borderWidth: 1,
        borderColor: BORDER,
        backgroundColor: CARD,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: TEXT, fontWeight: "900", fontSize: 13 }}>Official channels</Text>
          <Text style={{ marginTop: 4, color: MUTED, fontSize: 11 }}>Verified links from the marketplace.</Text>
        </View>
        <View
          style={{
            minWidth: 44,
            height: 32,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 10,
            borderWidth: 1,
            borderColor: "rgba(45,212,191,0.34)",
            backgroundColor: "rgba(45,212,191,0.14)",
          }}
        >
          <Text style={{ color: TEAL, fontWeight: "900", fontSize: 12 }}>{items.length}</Text>
        </View>
      </View>

      <View style={{ marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {loading && items.length === 0
          ? Array.from({ length: 5 }).map((_, index) => (
              <View
                key={`official-social-loading-${index}`}
                style={{
                  width: 50,
                  height: 50,
                  borderRadius: 25,
                  borderWidth: 1,
                  borderColor: BORDER,
                  backgroundColor: "rgba(255,253,247,0.05)",
                }}
              />
            ))
          : items.map((item) => {
              const broken = !!brokenLogos[item.id];

              return (
                <Pressable
                  key={item.id}
                  onPress={async () => {
                    const canOpen = await Linking.canOpenURL(item.url);
                    if (!canOpen) return;
                    await Linking.openURL(item.url);
                  }}
                  style={({ pressed }) => ({
                    width: 50,
                    height: 50,
                    borderRadius: 25,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 1,
                    borderColor: "rgba(255,253,247,0.14)",
                    backgroundColor: pressed ? "rgba(45,212,191,0.18)" : "rgba(255,253,247,0.04)",
                    overflow: "hidden",
                  })}
                >
                  {broken ? (
                    <Text style={{ color: TEXT, fontWeight: "900", fontSize: 16 }}>{item.fallback}</Text>
                  ) : (
                    <Image
                      source={{ uri: item.logoUrl }}
                      accessibilityLabel={item.label || item.host}
                      onError={() =>
                        setBrokenLogos((prev) => ({
                          ...prev,
                          [item.id]: true,
                        }))
                      }
                      style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: INK }}
                      resizeMode="contain"
                    />
                  )}
                </Pressable>
              );
            })}
      </View>
    </View>
  );
}
