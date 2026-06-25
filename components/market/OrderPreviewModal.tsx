import { ResizeMode, Video, Audio, type AVPlaybackStatus } from "expo-av";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Linking,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePreventScreenCapture } from "@/hooks/usePreventScreenCapture";
import { WatermarkedBrowser } from "@/components/market/WatermarkedBrowser";

const BG0 = "#060807";
const BG1 = "#10130E";
const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.68)";
const FAINT = "rgba(255,253,247,0.44)";
const BORDER = "rgba(255,253,247,0.12)";
const BORDER_TOP = "rgba(255,253,247,0.24)";
const PANEL = "rgba(255,253,247,0.065)";
const PANEL_RAISED = "rgba(255,253,247,0.09)";
const TEAL = "#2DD4BF";
const AMBER = "#F4B75D";
const ROSE = "#FB7185";
const INK = "#090D0B";
const WatermarkIcon = require("../../assets/images/icon.png");
type IconName = React.ComponentProps<typeof Ionicons>["name"];

export type PreviewPayload =
  | {
      kind: "image" | "audio" | "video" | "file";
      title?: string | null;
      access: "preview" | "final";
      previewSeconds?: number | null;
      urlPromise: () => Promise<string | null>;
      mimeType?: string | null;
    }
  | {
      kind: "link";
      title?: string | null;
      access: "preview" | "final";
      url: string;
    };

// ─── Shared helpers ─────────────────────────────────────────────────────────────

function formatTime(totalSeconds: number) {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function guessFileNameFromUrl(url: string | null) {
  if (!url) return "file";
  try {
    const clean = url.split("?")[0].split("#")[0];
    const parts = clean.split("/");
    const last = parts[parts.length - 1];
    return last ? decodeURIComponent(last) : "file";
  } catch {
    return "file";
  }
}

function getFileExtension(nameOrUrl: string | null) {
  if (!nameOrUrl) return "";
  const clean = nameOrUrl.split("?")[0].split("#")[0];
  const dot = clean.lastIndexOf(".");
  if (dot === -1 || dot === clean.length - 1) return "";
  return clean.slice(dot + 1).toLowerCase();
}

function fileIconForExtension(ext: string): IconName {
  if (["pdf"].includes(ext)) return "document-text-outline";
  if (["doc", "docx"].includes(ext)) return "document-outline";
  if (["xls", "xlsx", "csv"].includes(ext)) return "grid-outline";
  if (["zip", "rar", "7z"].includes(ext)) return "file-tray-full-outline";
  if (["ppt", "pptx"].includes(ext)) return "easel-outline";
  return "document-attach-outline";
}

// ─── Shimmer / skeleton ─────────────────────────────────────────────────────────

function Shimmer({ style }: { style?: any }) {
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 1200,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);

  const translateX = sweep.interpolate({ inputRange: [0, 1], outputRange: [-220, 220] });

  return (
    <View style={[{ overflow: "hidden", backgroundColor: "rgba(255,255,255,0.06)" }, style]}>
      <Animated.View
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          width: 120,
          backgroundColor: "rgba(255,255,255,0.12)",
          transform: [{ translateX }, { rotate: "10deg" }],
        }}
      />
    </View>
  );
}

// ─── Root modal ─────────────────────────────────────────────────────────────────

export function OrderPreviewModal({
  open,
  onClose,
  payload,
}: {
  open: boolean;
  onClose: () => void;
  payload: PreviewPayload | null;
}) {
  usePreventScreenCapture(open);
  const insets = useSafeAreaInsets();

  const [busy, setBusy] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const title = useMemo(() => payload?.title ?? "Preview", [payload]);
  const isPreview = payload?.access === "preview";

  // ── Swipe-down-to-dismiss ───────────────────────────────────────────────────
  const dragY = useRef(new Animated.Value(0)).current;
  const dragOpacity = dragY.interpolate({
    inputRange: [0, 240],
    outputRange: [1, 0.4],
    extrapolate: "clamp",
  });
  const dragScale = dragY.interpolate({
    inputRange: [0, 240],
    outputRange: [1, 0.94],
    extrapolate: "clamp",
  });

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_, gesture) => {
        if (gesture.dy > 0) dragY.setValue(gesture.dy);
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 120) {
          Animated.timing(dragY, { toValue: 600, duration: 180, useNativeDriver: false }).start(() => {
            dragY.setValue(0);
            onClose();
          });
        } else {
          Animated.spring(dragY, { toValue: 0, useNativeDriver: false, damping: 16, stiffness: 200 }).start();
        }
      },
    }),
  ).current;

  useEffect(() => {
    if (open) dragY.setValue(0);
  }, [open, dragY]);

  useEffect(() => {
    let alive = true;
    setErr(null);
    setResolvedUrl(null);

    (async () => {
      if (!open || !payload) return;

      if (payload.kind === "link") {
        setResolvedUrl(payload.url);
        return;
      }

      setBusy(true);
      try {
        const nextUrl = await payload.urlPromise();
        if (!alive) return;
        setResolvedUrl(nextUrl);
        if (!nextUrl) setErr("Preview is unavailable.");
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Preview is unavailable.");
      } finally {
        if (alive) setBusy(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open, payload, retryTick]);

  function handleRetry() {
    setRetryTick((t) => t + 1);
  }

  return (
    <Modal visible={open} animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={{ flex: 1, opacity: dragOpacity, transform: [{ translateY: dragY }, { scale: dragScale }] }}>
        <LinearGradient
          colors={[BG1, BG0]}
          style={{
            flex: 1,
            paddingTop: Math.max(insets.top, 18),
            paddingBottom: Math.max(insets.bottom, 16),
            paddingHorizontal: 16,
          }}
        >
          <View {...panResponder.panHandlers}>
            <View style={styles.dragHandle} />

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>
                  {title}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <View
                    style={[
                      styles.accessDot,
                      { backgroundColor: isPreview ? AMBER : TEAL },
                    ]}
                  />
                  <Text style={{ color: MUTED, fontSize: 12, fontWeight: "700" }}>
                    {isPreview ? "Preview access" : "Full access"}
                  </Text>
                </View>
              </View>

              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close preview"
                style={({ pressed }) => ({
                  width: 42,
                  height: 42,
                  borderRadius: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: pressed ? "rgba(255,253,247,0.14)" : "rgba(255,253,247,0.08)",
                  borderWidth: 1,
                  borderColor: BORDER,
                  transform: [{ scale: pressed ? 0.96 : 1 }],
                })}
              >
                <Ionicons name="close" size={20} color={TEXT} />
              </Pressable>
            </View>
          </View>

          {busy ? (
            <LoadingSkeleton kind={payload?.kind} />
          ) : err ? (
            <ErrorState message={err} onRetry={handleRetry} />
          ) : !payload ? null : payload.kind === "image" ? (
            resolvedUrl ? <ImageBlock uri={resolvedUrl} watermark={isPreview} fill /> : null
          ) : payload.kind === "video" ? (
            <VideoBlock uri={resolvedUrl} watermark={isPreview} previewSeconds={payload.previewSeconds ?? 20} fill />
          ) : payload.kind === "audio" ? (
            <AudioBlock uri={resolvedUrl} watermark={isPreview} previewSeconds={payload.previewSeconds ?? 20} />
          ) : payload.kind === "file" ? (
            <FileBlock uri={resolvedUrl} watermark={isPreview} mimeType={payload.mimeType} title={payload.title} />
          ) : payload.kind === "link" ? (
            resolvedUrl ? (
              <View style={{ marginTop: 12, flex: 1 }}>
                <WatermarkedBrowser initialUrl={resolvedUrl} allowGoogleSearch lockToInitialHost />
              </View>
            ) : null
          ) : null}
        </LinearGradient>
      </Animated.View>
    </Modal>
  );
}

// ─── Loading / error states ─────────────────────────────────────────────────────

function LoadingSkeleton({ kind }: { kind?: PreviewPayload["kind"] }) {
  if (kind === "audio") {
    return (
      <View style={[styles.panel, { marginTop: 14 }]}>
        <Shimmer style={{ width: 56, height: 56, borderRadius: 22 }} />
        <Shimmer style={{ width: "60%", height: 16, borderRadius: 6, marginTop: 16 }} />
        <Shimmer style={{ width: "40%", height: 12, borderRadius: 6, marginTop: 8 }} />
        <Shimmer style={{ width: "100%", height: 48, borderRadius: 18, marginTop: 16 }} />
      </View>
    );
  }
  if (kind === "file") {
    return (
      <View style={[styles.panel, { marginTop: 14 }]}>
        <Shimmer style={{ width: 56, height: 56, borderRadius: 16 }} />
        <Shimmer style={{ width: "70%", height: 16, borderRadius: 6, marginTop: 16 }} />
        <Shimmer style={{ width: "100%", height: 48, borderRadius: 18, marginTop: 16 }} />
      </View>
    );
  }
  return (
    <View
      style={{
        marginTop: 14,
        flex: 1,
        borderRadius: 22,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: BORDER_TOP,
      }}
    >
      <Shimmer style={{ flex: 1 }} />
      <View style={styles.skeletonSpinnerWrap}>
        <ActivityIndicator color={TEAL} size="small" />
      </View>
    </View>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={[styles.panel, { marginTop: 18, alignItems: "center" }]}>
      <Ionicons name="alert-circle-outline" size={26} color={ROSE} />
      <Text style={{ marginTop: 10, color: TEXT, fontWeight: "900", fontSize: 15 }}>Preview failed</Text>
      <Text style={{ marginTop: 5, color: MUTED, textAlign: "center" }}>{message}</Text>
      <Pressable
        onPress={onRetry}
        style={({ pressed }) => ({
          marginTop: 16,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          borderRadius: 16,
          paddingVertical: 12,
          paddingHorizontal: 20,
          backgroundColor: pressed ? "rgba(45,212,191,0.22)" : "rgba(45,212,191,0.14)",
          borderWidth: 1,
          borderColor: "rgba(45,212,191,0.4)",
        })}
      >
        <Ionicons name="refresh" size={16} color={TEAL} />
        <Text style={{ color: TEAL, fontWeight: "900" }}>Try again</Text>
      </Pressable>
    </View>
  );
}

// ─── Media frame shell (watermark + access badge wrapper) ─────────────────────

function fitAspectRatio(raw?: number | null) {
  const ratio = Number(raw || 0);
  if (!Number.isFinite(ratio) || ratio <= 0) return 9 / 16;
  return Math.max(9 / 21, Math.min(21 / 9, ratio));
}

function MediaFrame({
  watermark,
  children,
  fill = false,
  aspectRatio,
  footer,
}: {
  watermark: boolean;
  children: React.ReactNode;
  fill?: boolean;
  aspectRatio?: number | null;
  /** Optional custom footer content (e.g. video control bar) replacing the default access badge. */
  footer?: React.ReactNode;
}) {
  const fittedAspectRatio = fitAspectRatio(aspectRatio);
  const portraitLike = fittedAspectRatio < 1;

  return (
    <View
      style={{
        marginTop: 14,
        flex: fill ? 1 : undefined,
        minHeight: fill ? 0 : undefined,
        borderRadius: 22,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: BORDER_TOP,
        backgroundColor: "#000",
      }}
    >
      <View
        style={{
          flex: fill ? 1 : undefined,
          minHeight: fill ? 0 : 380,
          alignItems: "center",
          justifyContent: "center",
          paddingVertical: fill ? 8 : 0,
          paddingHorizontal: fill ? 4 : 0,
        }}
      >
        <View
          style={{
            width: portraitLike ? undefined : "100%",
            height: portraitLike ? "100%" : undefined,
            maxWidth: "100%",
            maxHeight: "100%",
            aspectRatio: fittedAspectRatio,
            alignSelf: "center",
          }}
        >
          {children}
        </View>

        {watermark ? <PreviewWatermark /> : null}
      </View>

      {footer ?? (
        <View
          style={{
            position: fill ? "absolute" : "relative",
            left: fill ? 12 : 0,
            right: fill ? 12 : 0,
            bottom: fill ? 12 : 0,
            borderRadius: fill ? 15 : 0,
            paddingHorizontal: 12,
            paddingVertical: 9,
            backgroundColor: fill ? "rgba(0,0,0,0.54)" : "rgba(0,0,0,0.36)",
            borderWidth: fill ? 1 : 0,
            borderColor: fill ? "rgba(255,253,247,0.12)" : "transparent",
          }}
        >
          <Text style={{ color: "rgba(255,253,247,0.86)", fontWeight: "900", fontSize: 12 }}>
            {watermark ? "Preview access" : "Full access"}
          </Text>
        </View>
      )}
    </View>
  );
}

function PreviewWatermark() {
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, overflow: "hidden" }}
    >
      {Array.from({ length: 8 }).map((_, row) => (
        <View
          key={`wm-row-${row}`}
          style={{
            position: "absolute",
            top: row * 58 - 20,
            left: row % 2 === 0 ? -24 : -82,
            flexDirection: "row",
          }}
        >
          {Array.from({ length: 7 }).map((__, col) => (
            <View
              key={`wm-cell-${row}-${col}`}
              style={{
                width: 140,
                transform: [{ rotate: "-24deg" }],
                opacity: 0.16,
              }}
            >
              <Text style={{ color: "rgba(255,253,247,0.42)", fontSize: 10, fontWeight: "900" }}>PREVIEW</Text>
            </View>
          ))}
        </View>
      ))}
      <View style={{ position: "absolute", right: 10, bottom: 10, opacity: 0.22 }}>
        <Image source={WatermarkIcon} style={{ width: 34, height: 34 }} />
      </View>
    </View>
  );
}

// ─── Image (with pinch-free but real tap-to-zoom + drag-to-pan) ───────────────

function ImageBlock({ uri, watermark, fill = false }: { uri: string; watermark: boolean; fill?: boolean }) {
  const [aspectRatio, setAspectRatio] = useState<number>(9 / 16);
  const [zoomed, setZoomed] = useState(false);

  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const lastTap = useRef(0);
  const panStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
    let alive = true;
    Image.getSize(
      uri,
      (w, h) => {
        if (alive && w > 0 && h > 0) setAspectRatio(w / h);
      },
      () => {
        if (alive) setAspectRatio(9 / 16);
      },
    );
    return () => {
      alive = false;
    };
  }, [uri]);

  const currentOffset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const xId = translateX.addListener(({ value }) => {
      currentOffset.current.x = value;
    });
    const yId = translateY.addListener(({ value }) => {
      currentOffset.current.y = value;
    });
    return () => {
      translateX.removeListener(xId);
      translateY.removeListener(yId);
    };
  }, [translateX, translateY]);

  function resetZoom() {
    setZoomed(false);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 220 }),
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 220 }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 220 }),
    ]).start();
  }

  function zoomIn() {
    setZoomed(true);
    Animated.spring(scale, { toValue: 2.4, useNativeDriver: true, damping: 18, stiffness: 220 }).start();
  }

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => zoomed && (Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4),
      onPanResponderGrant: () => {
        panStart.current = { x: currentOffset.current.x, y: currentOffset.current.y };
      },
      onPanResponderMove: (_, gesture) => {
        if (!zoomed) return;
        translateX.setValue(panStart.current.x + gesture.dx);
        translateY.setValue(panStart.current.y + gesture.dy);
      },
    }),
  ).current;

  function handleTap() {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      // Double tap → toggle zoom
      zoomed ? resetZoom() : zoomIn();
    }
    lastTap.current = now;
  }


  return (
    <MediaFrame watermark={watermark} fill={fill} aspectRatio={aspectRatio}>
      <Pressable onPress={handleTap} {...panResponder.panHandlers} style={{ width: "100%", height: "100%" }}>
        <Animated.View
          style={{
            width: "100%",
            height: "100%",
            transform: [{ scale }, { translateX }, { translateY }],
          }}
        >
          <Image source={{ uri }} style={{ width: "100%", height: "100%" }} resizeMode="contain" />
        </Animated.View>
      </Pressable>
      {!zoomed ? (
        <View pointerEvents="none" style={styles.zoomHint}>
          <Ionicons name="scan-outline" size={12} color="rgba(255,253,247,0.7)" />
          <Text style={styles.zoomHintText}>Double-tap to zoom</Text>
        </View>
      ) : (
        <Pressable onPress={resetZoom} style={styles.zoomResetBtn}>
          <Ionicons name="contract-outline" size={14} color={TEXT} />
        </Pressable>
      )}
    </MediaFrame>
  );
}

// ─── Video, with a real scrubber + "preview ended" overlay ────────────────────

function VideoBlock({
  uri,
  watermark,
  previewSeconds,
  fill = false,
}: {
  uri: string | null;
  watermark: boolean;
  previewSeconds: number;
  fill?: boolean;
}) {
  const videoRef = useRef<any>(null);
  const trackWidthRef = useRef(0);
  const [aspectRatio, setAspectRatio] = useState<number>(9 / 16);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [positionMillis, setPositionMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState(0);
  const [previewEnded, setPreviewEnded] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setAspectRatio(9 / 16);
    setPreviewEnded(false);
    setPositionMillis(0);
  }, [uri]);

  function scheduleHide() {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), 2600);
  }

  useEffect(() => {
    scheduleHide();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [isPlaying]);

  if (!uri) {
    return (
      <View style={[styles.panel, { marginTop: 14, alignItems: "center" }]}>
        <ActivityIndicator color={TEAL} />
        <Text style={{ marginTop: 10, color: TEXT, fontWeight: "900" }}>Loading video</Text>
        <Text style={{ marginTop: 5, color: MUTED }}>One moment…</Text>
      </View>
    );
  }

  const previewCapMillis = previewSeconds * 1000;
  const effectiveDuration = watermark ? Math.min(durationMillis || previewCapMillis, previewCapMillis) : durationMillis;
  const progress = effectiveDuration > 0 ? clampNum(positionMillis / effectiveDuration, 0, 1) : 0;

  async function togglePlay() {
    if (previewEnded) {
      await videoRef.current?.setPositionAsync?.(0);
      setPreviewEnded(false);
      await videoRef.current?.playAsync?.();
      return;
    }
    if (isPlaying) {
      await videoRef.current?.pauseAsync?.();
    } else {
      await videoRef.current?.playAsync?.();
    }
    setControlsVisible(true);
    scheduleHide();
  }

  async function toggleMute() {
    setIsMuted((m) => !m);
  }

  async function seekTo(ratio: number) {
    if (!durationMillis) return;
    const cap = watermark ? previewCapMillis : durationMillis;
    const target = clampNum(ratio, 0, 1) * Math.min(cap, durationMillis);
    await videoRef.current?.setPositionAsync?.(target);
    setControlsVisible(true);
    scheduleHide();
  }

  return (
    <MediaFrame
      watermark={watermark}
      fill={fill}
      aspectRatio={aspectRatio}
      footer={
        <View style={styles.videoControlBar}>
          <Pressable onPress={togglePlay} style={styles.videoControlBtn} hitSlop={8}>
            <Ionicons name={previewEnded ? "refresh" : isPlaying ? "pause" : "play"} size={16} color={TEXT} />
          </Pressable>

          <Pressable
            style={styles.scrubTrack}
            onLayout={(e) => {
              trackWidthRef.current = e.nativeEvent.layout.width;
            }}
            onPress={(e) => {
              const x = e.nativeEvent.locationX;
              const w = trackWidthRef.current;
              void seekTo(w > 0 ? x / w : progress);
            }}
          >
            <View style={styles.scrubTrackBg} />
            <View style={[styles.scrubTrackFill, { width: `${progress * 100}%` }]} />
          </Pressable>

          <Text style={styles.videoTimeText}>
            {formatTime(positionMillis / 1000)} / {formatTime(effectiveDuration / 1000)}
          </Text>

          <Pressable onPress={toggleMute} style={styles.videoControlBtn} hitSlop={8}>
            <Ionicons name={isMuted ? "volume-mute" : "volume-medium"} size={16} color={TEXT} />
          </Pressable>
        </View>
      }
    >
      <Pressable
        style={{ width: "100%", height: "100%" }}
        onPress={() => {
          setControlsVisible((v) => !v);
          scheduleHide();
        }}
      >
        <Video
          ref={videoRef}
          source={{ uri }}
          style={{ width: "100%", height: "100%" }}
          resizeMode={ResizeMode.CONTAIN}
          useNativeControls={false}
          shouldPlay={false}
          isMuted={isMuted}
          onReadyForDisplay={(event: any) => {
            const naturalWidth = Number(event?.naturalSize?.width ?? event?.status?.naturalSize?.width ?? 0);
            const naturalHeight = Number(event?.naturalSize?.height ?? event?.status?.naturalSize?.height ?? 0);
            if (naturalWidth > 0 && naturalHeight > 0) setAspectRatio(naturalWidth / naturalHeight);
          }}
          onPlaybackStatusUpdate={(status: AVPlaybackStatus) => {
            if (!status?.isLoaded) return;
            setIsPlaying(!!status.isPlaying);
            setPositionMillis(status.positionMillis ?? 0);
            setDurationMillis(status.durationMillis ?? 0);

            if (watermark && (status.positionMillis ?? 0) >= previewCapMillis && status.isPlaying) {
              videoRef.current?.pauseAsync?.();
              setPreviewEnded(true);
              setControlsVisible(true);
            }
          }}
        />

        {!isPlaying && !previewEnded ? (
          <View style={styles.bigPlayWrap}>
            <View style={styles.bigPlayBtn}>
              <Ionicons name="play" size={26} color={INK} />
            </View>
          </View>
        ) : null}

        {previewEnded ? (
          <View style={styles.previewEndedOverlay}>
            <Ionicons name="lock-closed-outline" size={22} color={AMBER} />
            <Text style={styles.previewEndedTitle}>Preview ended</Text>
            <Text style={styles.previewEndedBody}>
              You've seen the first {previewSeconds}s. Full access unlocks after checkout.
            </Text>
            <Pressable onPress={togglePlay} style={styles.previewEndedReplay}>
              <Ionicons name="refresh" size={14} color={INK} />
              <Text style={styles.previewEndedReplayText}>Replay preview</Text>
            </Pressable>
          </View>
        ) : null}
      </Pressable>
    </MediaFrame>
  );
}

function clampNum(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// ─── Audio, with a real progress bar + waveform-style visual ──────────────────

function AudioBlock({ uri, watermark, previewSeconds }: { uri: string | null; watermark: boolean; previewSeconds: number }) {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [positionMillis, setPositionMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState(0);
  const [ended, setEnded] = useState(false);

  const barHeights = useMemo(() => Array.from({ length: 28 }, (_, i) => 10 + ((i * 37) % 26)), []);

  useEffect(() => {
    return () => {
      sound?.unloadAsync().catch(() => undefined);
    };
  }, [sound]);

  async function toggle() {
    if (!uri || loading) return;
    setLoading(true);
    try {
      if (ended) {
        await sound?.setPositionAsync(0);
        await sound?.playAsync();
        setEnded(false);
        return;
      }
      if (!sound) {
        const { sound: nextSound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
        nextSound.setOnPlaybackStatusUpdate((status: any) => {
          if (!status?.isLoaded) return;
          setPlaying(!!status.isPlaying);
          setPositionMillis(status.positionMillis ?? 0);
          setDurationMillis(status.durationMillis ?? 0);
          if (watermark && status.positionMillis >= previewSeconds * 1000) {
            nextSound.pauseAsync();
            nextSound.setPositionAsync(0);
            setEnded(true);
          }
        });
        setSound(nextSound);
      } else {
        const status: any = await sound.getStatusAsync();
        if (status.isLoaded && status.isPlaying) await sound.pauseAsync();
        else await sound.playAsync();
      }
    } finally {
      setLoading(false);
    }
  }

  if (!uri) {
    return (
      <View style={[styles.panel, { marginTop: 14, alignItems: "center" }]}>
        <ActivityIndicator color={AMBER} />
        <Text style={{ marginTop: 10, color: TEXT, fontWeight: "900" }}>Loading audio</Text>
        <Text style={{ marginTop: 5, color: MUTED }}>One moment…</Text>
      </View>
    );
  }

  const effectiveDuration = watermark ? Math.min(durationMillis || previewSeconds * 1000, previewSeconds * 1000) : durationMillis;
  const progress = effectiveDuration > 0 ? clampNum(positionMillis / effectiveDuration, 0, 1) : 0;
  const activeBars = Math.round(progress * barHeights.length);

  return (
    <View style={[styles.panel, { marginTop: 14 }]}>
      <View style={styles.audioIconWrap}>
        <Ionicons name="musical-notes" size={23} color={AMBER} />
      </View>
      <Text style={{ marginTop: 14, color: TEXT, fontWeight: "900", fontSize: 18 }}>
        {watermark ? "Audio preview" : "Audio"}
      </Text>
      <Text style={{ marginTop: 6, color: MUTED }}>
        {ended
          ? `Preview ended at ${previewSeconds}s. Tap play to replay the preview.`
          : watermark
          ? `Playback stops at ${previewSeconds}s.`
          : "Ready to play."}
      </Text>

      <View style={styles.waveformRow}>
        {barHeights.map((h, i) => (
          <View
            key={i}
            style={[
              styles.waveformBar,
              { height: h, backgroundColor: i < activeBars ? TEAL : "rgba(255,253,247,0.14)" },
            ]}
          />
        ))}
      </View>

      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
        <Text style={styles.audioTimeText}>{formatTime(positionMillis / 1000)}</Text>
        <Text style={styles.audioTimeText}>{formatTime(effectiveDuration / 1000)}</Text>
      </View>

      <Pressable
        onPress={toggle}
        disabled={loading}
        style={({ pressed }) => ({
          marginTop: 14,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          borderRadius: 18,
          paddingVertical: 13,
          backgroundColor: TEAL,
          opacity: loading ? 0.7 : 1,
          transform: [{ translateY: pressed ? 1 : 0 }],
        })}
      >
        {loading ? (
          <ActivityIndicator color={INK} />
        ) : (
          <>
            <Ionicons name={ended ? "refresh" : playing ? "pause" : "play"} size={16} color={INK} />
            <Text style={{ color: INK, fontWeight: "900" }}>{ended ? "Replay" : playing ? "Pause" : "Play"}</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

// ─── File, with extension-aware icon + filename ────────────────────────────────

function FileBlock({
  uri,
  watermark,
  mimeType,
  title,
}: {
  uri: string | null;
  watermark: boolean;
  mimeType?: string | null;
  title?: string | null;
}) {
  const fileName = title?.trim() || guessFileNameFromUrl(uri);
  const ext = getFileExtension(fileName) || getFileExtension(mimeType ?? "");
  const icon = fileIconForExtension(ext);

  return (
    <View style={[styles.panel, { marginTop: 14 }]}>
      <View style={styles.fileIconWrap}>
        <Ionicons name={icon} size={24} color={TEAL} />
      </View>
      <Text style={{ marginTop: 14, color: TEXT, fontWeight: "900", fontSize: 16 }} numberOfLines={2}>
        {fileName}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
        {ext ? (
          <View style={styles.fileExtBadge}>
            <Text style={styles.fileExtBadgeText}>{ext.toUpperCase()}</Text>
          </View>
        ) : null}
        <Text style={{ color: MUTED, fontSize: 12 }}>
          {watermark ? "Preview file · opens in your device browser" : "Opens in your device browser"}
        </Text>
      </View>

      <Pressable
        disabled={!uri}
        onPress={() => uri && Linking.openURL(uri)}
        style={({ pressed }) => ({
          marginTop: 14,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          borderRadius: 18,
          paddingVertical: 13,
          backgroundColor: uri ? TEAL : "rgba(255,253,247,0.12)",
          opacity: uri ? 1 : 0.7,
          transform: [{ translateY: pressed ? 1 : 0 }],
        })}
      >
        <Ionicons name="open-outline" size={16} color={uri ? INK : FAINT} />
        <Text style={{ color: uri ? INK : FAINT, fontWeight: "900" }}>{uri ? "Open file" : "Loading…"}</Text>
      </Pressable>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  dragHandle: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,253,247,0.24)",
    marginBottom: 12,
  },
  accessDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  panel: {
    borderRadius: 22,
    padding: 18,
    backgroundColor: PANEL,
    borderWidth: 1,
    borderColor: BORDER_TOP,
  },
  skeletonSpinnerWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },

  // Image zoom affordances
  zoomHint: {
    position: "absolute",
    top: 12,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  zoomHintText: {
    color: "rgba(255,253,247,0.78)",
    fontSize: 10,
    fontWeight: "800",
  },
  zoomResetBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },

  // Video controls
  videoControlBar: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 10,
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: "rgba(6,8,7,0.72)",
    borderWidth: 1,
    borderColor: "rgba(255,253,247,0.12)",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  videoControlBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  scrubTrack: {
    flex: 1,
    height: 16,
    justifyContent: "center",
  },
  scrubTrackBg: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,253,247,0.2)",
  },
  scrubTrackFill: {
    position: "absolute",
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: TEAL,
  },
  videoTimeText: {
    color: "rgba(255,253,247,0.78)",
    fontSize: 10,
    fontWeight: "800",
    minWidth: 70,
    textAlign: "right",
  },
  bigPlayWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  bigPlayBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,253,247,0.92)",
  },
  previewEndedOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(6,8,7,0.86)",
    paddingHorizontal: 24,
    gap: 6,
  },
  previewEndedTitle: {
    color: TEXT,
    fontWeight: "900",
    fontSize: 16,
  },
  previewEndedBody: {
    color: MUTED,
    fontSize: 12,
    textAlign: "center",
    lineHeight: 17,
  },
  previewEndedReplay: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 14,
    paddingVertical: 9,
    paddingHorizontal: 16,
    backgroundColor: AMBER,
  },
  previewEndedReplayText: {
    color: INK,
    fontWeight: "900",
    fontSize: 12,
  },

  // Audio
  audioIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,183,93,0.14)",
    borderWidth: 1,
    borderColor: "rgba(244,183,93,0.34)",
  },
  waveformRow: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    height: 36,
  },
  waveformBar: {
    flex: 1,
    borderRadius: 2,
  },
  audioTimeText: {
    color: FAINT,
    fontSize: 10,
    fontWeight: "800",
  },

  // File
  fileIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(45,212,191,0.13)",
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.32)",
  },
  fileExtBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(45,212,191,0.16)",
  },
  fileExtBadgeText: {
    color: TEAL,
    fontSize: 10,
    fontWeight: "900",
  },
});