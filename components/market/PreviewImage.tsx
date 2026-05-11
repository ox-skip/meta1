import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import WatermarkOverlay from "./WatermarkOverlay";
import { useSecureScreen } from "@/hooks/useSecureScreen";

type Props = {
  uri: string;
  locked?: boolean;
  watermarkLabel?: string;
  onPressFull?: () => void;
};

export default function PreviewImage({
  uri,
  locked = true,
  watermarkLabel = "Preview",
  onPressFull,
}: Props) {
  useSecureScreen(true);

  return (
    <View style={styles.card}>
      <Pressable onPress={locked ? undefined : onPressFull} disabled={locked} style={styles.media}>
        <Image
          source={{ uri }}
          style={styles.img}
          blurRadius={locked ? 14 : 0}
          resizeMode="cover"
        />
        <WatermarkOverlay label={watermarkLabel} />
        {locked ? (
          <View style={styles.lockPill}>
            <Text style={styles.lockText}>PREVIEW</Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  media: {
    width: "100%",
    height: 220,
  },
  img: {
    width: "100%",
    height: "100%",
  },
  lockPill: {
    position: "absolute",
    left: 14,
    top: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  lockText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 12,
    letterSpacing: 0.4,
  },
});
