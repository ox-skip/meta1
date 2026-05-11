import React, { useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import WatermarkOverlay from "./WatermarkOverlay";
import { useSecureScreen } from "@/hooks/useSecureScreen";

type Props = {
  url: string;
  locked?: boolean;
  watermarkLabel?: string;
};

export default function PreviewWebsite({
  url,
  locked = true,
  watermarkLabel = "Preview",
}: Props) {
  useSecureScreen(true);

  const injected = useMemo(() => {
    return `
      (function() {
        try {
          var wm = document.createElement('div');
          wm.style.position = 'fixed';
          wm.style.left = '0';
          wm.style.top = '0';
          wm.style.right = '0';
          wm.style.bottom = '0';
          wm.style.pointerEvents = 'none';
          wm.style.zIndex = '999999';
          wm.style.opacity = '0.10';
          wm.style.transform = 'rotate(-18deg)';
          wm.style.display = 'flex';
          wm.style.flexWrap = 'wrap';
          wm.style.alignItems = 'center';
          wm.style.justifyContent = 'center';
          wm.style.gap = '18px';
          wm.style.padding = '20px';
          var text = ${JSON.stringify(watermarkLabel)};
          for (var i = 0; i < 36; i++) {
            var tile = document.createElement('div');
            tile.style.width = '180px';
            tile.style.height = '90px';
            tile.style.display = 'flex';
            tile.style.alignItems = 'center';
            tile.style.justifyContent = 'center';
            tile.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto';
            tile.style.fontSize = '12px';
            tile.style.fontWeight = '800';
            tile.style.color = '#ffffff';
            tile.innerText = text;
            wm.appendChild(tile);
          }
          document.documentElement.appendChild(wm);
          document.documentElement.style.userSelect = 'none';
        } catch(e) {}
      })();
      true;
    `;
  }, [watermarkLabel]);

  if (locked) {
    return (
      <View style={styles.card}>
        <WatermarkOverlay label={watermarkLabel} opacity={0.10} />
        <Text style={styles.title}>Website preview</Text>
        <Text style={styles.sub}>Preview unavailable.</Text>
      </View>
    );
  }

  return (
    <View style={styles.cardWeb}>
      <WebView
        source={{ uri: url }}
        injectedJavaScript={injected}
        startInLoadingState
        renderLoading={() => (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator />
            <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.7)" }}>Loading preview</Text>
          </View>
        )}
        style={{ backgroundColor: "transparent" }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    borderRadius: 22,
    padding: 16,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    minHeight: 140,
  },
  cardWeb: {
    marginTop: 12,
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(0,0,0,0.20)",
    height: 420,
  },
  title: { color: "#fff", fontWeight: "900", fontSize: 14 },
  sub: { marginTop: 6, color: "rgba(255,255,255,0.65)", fontWeight: "700" },
});
