import { Ionicons } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { Linking, Pressable, Text, View } from "react-native";

import { OfficialSocialPlatform, useOfficialSocialLinks } from "@/hooks/market/useOfficialSocialLinks";

const BORDER = "rgba(255,255,255,0.10)";
const CARD = "rgba(255,255,255,0.06)";

type PlatformMeta = {
  platform: OfficialSocialPlatform;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const PLATFORM_META: PlatformMeta[] = [
  { platform: "discord", label: "Discord", icon: "logo-discord" },
  { platform: "twitter", label: "Twitter", icon: "logo-twitter" },
  { platform: "telegram", label: "Telegram", icon: "paper-plane" },
  { platform: "instagram", label: "Instagram", icon: "logo-instagram" },
  { platform: "youtube", label: "YouTube", icon: "logo-youtube" },
  { platform: "tiktok", label: "TikTok", icon: "logo-tiktok" },
  { platform: "facebook", label: "Facebook", icon: "logo-facebook" },
  { platform: "linkedin", label: "LinkedIn", icon: "logo-linkedin" },
];

export default function OfficialMarketSocials() {
  const { byPlatform, loading } = useOfficialSocialLinks();

  const items = useMemo(
    () =>
      PLATFORM_META.map((meta) => {
        const row = byPlatform.get(meta.platform);
        const url = row?.url ?? null;
        const enabled = Boolean(url);
        return {
          ...meta,
          url,
          enabled,
          title: row?.label || meta.label,
        };
      }),
    [byPlatform],
  );

  return (
    <View style={{ marginTop: 10, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD }}>
      <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>BestCity official community</Text>
      <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.66)", fontSize: 11 }}>
        Follow official channels for announcements.
      </Text>

      <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {items.map((item) => (
          <Pressable
            key={item.platform}
            disabled={!item.enabled}
            onPress={async () => {
              if (!item.url) return;
              const canOpen = await Linking.canOpenURL(item.url);
              if (!canOpen) return;
              await Linking.openURL(item.url);
            }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: item.enabled ? "rgba(124,58,237,0.45)" : "rgba(255,255,255,0.14)",
              backgroundColor: item.enabled ? "rgba(124,58,237,0.20)" : "rgba(255,255,255,0.04)",
              opacity: item.enabled ? 1 : 0.5,
            }}
          >
            <Ionicons name={item.icon} size={14} color={item.enabled ? "#fff" : "rgba(255,255,255,0.7)"} />
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 11 }}>{item.title}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <Text style={{ marginTop: 8, color: "rgba(255,255,255,0.52)", fontSize: 11 }}>Loading official links...</Text>
      ) : null}
    </View>
  );
}
