import React from "react";
import { Image, Text, View } from "react-native";

const WatermarkIcon = require("../../assets/images/icon.png");

export function WatermarkedImage({
  uri,
  height = 280,
  label = "Preview",
}: {
  uri: string;
  height?: number;
  label?: string;
}) {
  return (
    <View
      style={{
        width: "100%",
        height,
        borderRadius: 18,
        overflow: "hidden",
        backgroundColor: "rgba(255,253,247,0.06)",
      }}
    >
      <Image source={{ uri }} style={{ width: "100%", height: "100%" }} resizeMode="contain" />

      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Image source={WatermarkIcon} style={{ width: 88, height: 88, opacity: 0.2 }} />
        <Text style={{ marginTop: 10, color: "rgba(255,253,247,0.55)", fontWeight: "900" }}>{label}</Text>
      </View>

      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          paddingVertical: 10,
          paddingHorizontal: 12,
          backgroundColor: "rgba(0,0,0,0.35)",
        }}
      >
        <Text style={{ color: "rgba(255,253,247,0.85)", fontWeight: "900", fontSize: 12 }}>Preview access</Text>
      </View>
    </View>
  );
}
