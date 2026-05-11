import React, { useMemo } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

type Props = {
  label?: string;
  opacity?: number;
  tileSize?: number;
  rotateDeg?: number;
};

const ICON = require("../../assets/images/icon.png");

export default function WatermarkOverlay({
  label = "Preview",
  opacity = 0.12,
  tileSize = 44,
  rotateDeg = -18,
}: Props) {
  const tiles = useMemo(() => Array.from({ length: 36 }), []);

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { opacity }]}>
      <View style={[styles.wrap, { transform: [{ rotate: `${rotateDeg}deg` }] }]}>
        {tiles.map((_, i) => (
          <View key={i} style={styles.tile}>
            <Image source={ICON} style={{ width: tileSize, height: tileSize, opacity: 0.95 }} />
            <Text style={styles.label} numberOfLines={1}>
              {label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    padding: 14,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  tile: {
    width: 140,
    height: 86,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    marginTop: 6,
    color: "rgba(255,255,255,0.9)",
    fontWeight: "900",
    fontSize: 11,
    textAlign: "center",
  },
});
