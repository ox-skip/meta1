import { ResizeMode, Video, type AVPlaybackStatus } from "expo-av";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, StyleProp, StyleSheet, View, ViewStyle } from "react-native";

import { inferMarketMediaKind, type MarketMediaKind } from "@/utils/marketMedia";

type MediaResizeMode = "cover" | "contain" | "stretch" | "center" | "repeat";

const SKELETON_BASE = "rgba(255,255,255,0.06)";
const SKELETON_SHEEN = "rgba(255,255,255,0.14)";
const ERROR_BG = "rgba(251,113,133,0.10)";
const ERROR_BORDER = "rgba(251,113,133,0.28)";
const ERROR_ICON = "#FB7185";
const BADGE_BG = "rgba(6,8,7,0.62)";

function toVideoResizeMode(resizeMode: MediaResizeMode) {
  return resizeMode === "contain" ? ResizeMode.CONTAIN : ResizeMode.COVER;
}

/**
 * Soft shimmer placeholder shown while a thumbnail is loading.
 * Pure Animated API — no extra dependencies required.
 */
function ShimmerOverlay() {
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 1100,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);

  const translateX = sweep.interpolate({ inputRange: [0, 1], outputRange: [-160, 160] });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: SKELETON_BASE }]} />
      <Animated.View
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          width: 90,
          backgroundColor: SKELETON_SHEEN,
          opacity: 0.5,
          transform: [{ translateX }, { rotate: "12deg" }],
        }}
      />
    </View>
  );
}

function ErrorFallback({ kind }: { kind: MarketMediaKind | "file" | "link" | "audio" }) {
  const icon =
    kind === "video"
      ? "videocam-outline"
      : kind === "audio"
      ? "musical-notes-outline"
      : kind === "link"
      ? "globe-outline"
      : kind === "file"
      ? "document-attach-outline"
      : "image-outline";

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        {
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: ERROR_BG,
          borderWidth: 1,
          borderColor: ERROR_BORDER,
          gap: 6,
        },
      ]}
    >
      <Ionicons name="alert-circle-outline" size={20} color={ERROR_ICON} />
      <Ionicons name={icon as any} size={16} color="rgba(255,255,255,0.32)" />
    </View>
  );
}

function VideoBadge() {
  return (
    <View style={styles.videoBadge}>
      <Ionicons name="play" size={11} color="#FFFDF7" />
    </View>
  );
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
  showVideoBadge = true,
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
  /** Shows a small play-icon badge in the corner for video tiles. Defaults to true. */
  showVideoBadge?: boolean;
}) {
  const resolvedKind = kind || inferMarketMediaKind(uri);
  const [imageLoading, setImageLoading] = useState(resolvedKind === "image");
  const [imageError, setImageError] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Reset state when the underlying source changes (e.g. carousel swaps media item).
  useEffect(() => {
    setImageLoading(resolvedKind === "image");
    setImageError(false);
    setVideoReady(false);
    setVideoError(false);
    fadeAnim.setValue(0);
  }, [uri, resolvedKind, fadeAnim]);

  function fadeIn() {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }

  const hasError = resolvedKind === "video" ? videoError : imageError;

  return (
    <View style={[styles.root, style]} pointerEvents={disablePointerEvents ? "none" : "auto"}>
      {hasError ? (
        <ErrorFallback kind={resolvedKind} />
      ) : resolvedKind === "video" ? (
        <>
          <Animated.View style={[styles.fill, { opacity: videoReady ? fadeAnim : 0 }]}>
            <Video
              source={{ uri }}
              style={styles.fill}
              resizeMode={toVideoResizeMode(resizeMode)}
              shouldPlay={autoplay}
              isMuted={muted}
              isLooping={loop}
              useNativeControls={controls}
              onReadyForDisplay={() => {
                setVideoReady(true);
                fadeIn();
              }}
              onError={() => setVideoError(true)}
              onPlaybackStatusUpdate={(status: AVPlaybackStatus) => {
                if ("isLoaded" in status && !status.isLoaded && (status as any).error) {
                  setVideoError(true);
                }
              }}
            />
          </Animated.View>
          {!videoReady ? <ShimmerOverlay /> : null}
          {videoReady && showVideoBadge && !autoplay ? <VideoBadge /> : null}
        </>
      ) : (
        <>
          <Animated.View style={[styles.fill, { opacity: imageLoading ? 0 : fadeAnim }]}>
            <Image
              source={{ uri }}
              style={styles.fill}
              resizeMode={resizeMode}
              onLoadStart={() => setImageLoading(true)}
              onLoad={() => {
                setImageLoading(false);
                fadeIn();
              }}
              onError={() => {
                setImageLoading(false);
                setImageError(true);
              }}
            />
          </Animated.View>
          {imageLoading ? <ShimmerOverlay /> : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    overflow: "hidden",
    backgroundColor: "#0B0D0B",
  },
  fill: {
    width: "100%",
    height: "100%",
  },
  videoBadge: {
    position: "absolute",
    right: 8,
    bottom: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BADGE_BG,
  },
});