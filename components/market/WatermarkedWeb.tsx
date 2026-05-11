import * as Linking from "expo-linking";
import React from "react";
import { Image, Platform, Pressable, Text, View } from "react-native";
import { WebView } from "react-native-webview";

const WatermarkIcon = require("../../assets/images/icon.png");

const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.68)";
const BORDER = "rgba(255,253,247,0.12)";
const TEAL = "#2DD4BF";
const INK = "#090D0B";

export function WatermarkedWeb({ url }: { url: string }) {
  if (Platform.OS === "web") {
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

  return (
    <View
      style={{
        height: 420,
        borderRadius: 18,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: BORDER,
        backgroundColor: "#020302",
      }}
    >
      <WebView source={{ uri: url }} />
      <View pointerEvents="none" style={{ position: "absolute", top: 14, right: 14, alignItems: "center" }}>
        <View style={{ padding: 10, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center" }}>
          <Image source={WatermarkIcon} style={{ width: 34, height: 34, opacity: 0.35 }} />
          <Text style={{ marginTop: 6, color: "rgba(255,253,247,0.75)", fontWeight: "900", fontSize: 12 }}>
            Preview
          </Text>
        </View>
      </View>

      <Pressable
        onPress={() => Linking.openURL(url)}
        style={{
          position: "absolute",
          left: 14,
          bottom: 14,
          borderRadius: 14,
          paddingVertical: 10,
          paddingHorizontal: 12,
          backgroundColor: TEAL,
        }}
      >
        <Text style={{ color: INK, fontWeight: "900", fontSize: 12 }}>Open website</Text>
      </Pressable>
    </View>
  );
}
