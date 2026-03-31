import { ResizeMode, Video } from "expo-av";
import React from "react";
import { Image, StyleProp, StyleSheet, View, ViewStyle } from "react-native";

import { inferMarketMediaKind, type MarketMediaKind } from "@/utils/marketMedia";

type MediaResizeMode = "cover" | "contain" | "stretch" | "center" | "repeat";

function toVideoResizeMode(resizeMode: MediaResizeMode) {
  return resizeMode === "contain" ? ResizeMode.CONTAIN : ResizeMode.COVER;
}

export default function MarketMediaView({
  uri,
  kind,
  style,
  resizeMode = "cover",
  autoplay = false,
  muted = true,
  loop = false,
  controls = false,
  disablePointerEvents = false,
}: {
  uri: string;
  kind?: MarketMediaKind | null;
  style?: StyleProp<ViewStyle>;
  resizeMode?: MediaResizeMode;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  controls?: boolean;
  disablePointerEvents?: boolean;
}) {
  const resolvedKind = kind || inferMarketMediaKind(uri);

  return (
    <View style={style} pointerEvents={disablePointerEvents ? "none" : "auto"}>
      {resolvedKind === "video" ? (
        <Video
          source={{ uri }}
          style={styles.fill}
          resizeMode={toVideoResizeMode(resizeMode)}
          shouldPlay={autoplay}
          isMuted={muted}
          isLooping={loop}
          useNativeControls={controls}
        />
      ) : (
        <Image source={{ uri }} style={styles.fill} resizeMode={resizeMode} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    width: "100%",
    height: "100%",
  },
});
