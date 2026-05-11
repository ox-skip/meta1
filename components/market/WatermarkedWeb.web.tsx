import React from "react";
import { Pressable, Text, View } from "react-native";

const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.68)";
const BORDER = "rgba(255,253,247,0.12)";
const TEAL = "#2DD4BF";
const INK = "#090D0B";

export function WatermarkedWeb({ url }: { url: string }) {
  return (
    <View
      style={{
        padding: 14,
        borderRadius: 18,
        backgroundColor: "rgba(255,253,247,0.06)",
        borderWidth: 1,
        borderColor: BORDER,
      }}
    >
      <Text style={{ color: TEXT, fontWeight: "900" }}>Website preview</Text>
      <Text style={{ marginTop: 6, color: MUTED }}>Open the site to continue.</Text>
      <Pressable
        onPress={() => window.open(url, "_blank", "noopener,noreferrer")}
        style={{
          marginTop: 12,
          borderRadius: 14,
          paddingVertical: 12,
          alignItems: "center",
          backgroundColor: TEAL,
        }}
      >
        <Text style={{ color: INK, fontWeight: "900" }}>Open website</Text>
      </Pressable>
    </View>
  );
}
