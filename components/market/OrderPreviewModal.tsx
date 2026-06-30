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
// eslint-disable-next-line import/no-unresolved
import * as Haptics from "expo-haptics";

import { usePreventScreenCapture } from "@/hooks/usePreventScreenCapture";
import { WatermarkedBrowser } from "@/components/market/WatermarkedBrowser";

const BG0 = "#060807";
const BG1 = "#10130E";
const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.68)";
const FAINT = "rgba(255,253,247,0.44)";
const BORDER_TOP = "rgba(255,253,247,0.24)";
const TEAL = "#2DD4BF";
const AMBER = "#F4B75D";
const ROSE = "#FB7185";
const INK = "#090D0B";
const GLOW_TEAL = "rgba(45,212,191,0.4)";
const GLOW_AMBER = "rgba(244,183,93,0.4)";
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

export type MultiPreviewPayload = {
  items: PreviewPayload[];
  startIndex?: number;
};

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

export function OrderPreviewModal({
  open,
  onClose,
  payload,
}: {
  open: boolean;
  onClose: () => void;
  payload: PreviewPayload | MultiPreviewPayload | null;
}) {
  usePreventScreenCapture(open);
  const insets = useSafeAreaInsets();

  const isMulti = payload && "items" in (payload as MultiPreviewPayload);
  const multiPayload = isMulti ? (payload as MultiPreviewPayload) : null;
  const singlePayload = !isMulti ? (payload as PreviewPayload) : null;

  const items = multiPayload?.items ?? (singlePayload ? [singlePayload] : []);
  const initialIndex = multiPayload?.startIndex ?? 0;
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [resolvedUrls, setResolvedUrls] = useState<(string | null)[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const currentItem = items[currentIndex] || null;
  const resolvedUrl = resolvedUrls[currentIndex];
  const hasMultiple = items.length > 0 && items.length > 1;
  const isPreview = currentItem?.access === "preview";

  const dragY = useRef(new Animated.Value(0)).current;
  const dragOpacity = dragY.interpolate({
    inputRange: [0, 240],
    outputRange: [1, 0.4],
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
    if (open) {
      dragY.setValue(0);
      setCurrentIndex(initialIndex > 0 ? Math.min(initialIndex, items.length - 1) : 0);
    } else {
      setCurrentIndex(0);
      setResolvedUrls([]);
    }
  }, [open, dragY, initialIndex, items.length]);

  useEffect(() => {
    let alive = true;
    setErr(null);

    if (!open || !currentItem) return;

    (async () => {
      if (currentItem.kind === "link") {
        setResolvedUrls(prev => {
          const next = [...prev];
          next[currentIndex] = currentItem.url;
          return next;
        });
        return;
      }

      try {
        const nextUrl = await currentItem.urlPromise();
        if (!alive) return;
        setResolvedUrls(prev => {
          const next = [...prev];
          next[currentIndex] = nextUrl;
          return next;
        });
        if (!nextUrl) setErr("Preview unavailable.");
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Preview failed.");
      }
    })();

    return () => {
      alive = false;
    };
  }, [open, currentItem, currentIndex, retryTick]);

  function handleRetry() {
    setRetryTick(t => t + 1);
  }

  const isLoading = open && items.length > 0 && !resolvedUrl && !err;

  function goToIndex(index: number) {
    const bounded = Math.max(0, Math.min(items.length - 1, index));
    if (bounded !== currentIndex) {
      Haptics.selectionAsync();
    }
    setCurrentIndex(bounded);
  }

  function renderContent() {
    if (!currentItem) return null;

    if (currentItem.kind === "image") {
      return resolvedUrl ? <ReelImageBlock uri={resolvedUrl} watermark={isPreview} /> : null;
    }
    if (currentItem.kind === "video") {
      return (
        <ReelVideoBlock
          uri={resolvedUrl}
          watermark={isPreview}
          previewSeconds={currentItem.previewSeconds ?? 20}
        />
      );
    }
    if (currentItem.kind === "audio") {
      return (
        <View style={styles.audioPanel}>
          <AudioBlockSimple uri={resolvedUrl} watermark={isPreview} previewSeconds={currentItem.previewSeconds ?? 20} />
        </View>
      );
    }
    if (currentItem.kind === "file") {
      return (
        <View style={styles.audioPanel}>
          <FileBlockSimple uri={resolvedUrl} watermark={isPreview} mimeType={currentItem.mimeType} title={currentItem.title} />
        </View>
      );
    }
    if (currentItem.kind === "link") {
      return resolvedUrl ? (
        <View style={styles.browserWrapper}>
          <WatermarkedBrowser initialUrl={resolvedUrl} allowGoogleSearch lockToInitialHost />
        </View>
      ) : null;
    }
    return null;
  }

  return (
    <Modal visible={open} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={{ flex: 1, opacity: dragOpacity }}>
        <LinearGradient
          colors={[BG1, BG0]}
          style={{
            flex: 1,
            paddingTop: Math.max(insets.top, 12),
            paddingBottom: Math.max(insets.bottom, 12),
            paddingHorizontal: 12,
          }}
        >
          <View {...panResponder.panHandlers} style={styles.topBar}>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close preview"
              style={({ pressed }) => [
                styles.closeBtn,
                { backgroundColor: pressed ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.4)" },
              ]}
            >
              <Ionicons name="close" size={22} color={TEXT} />
            </Pressable>

            {hasMultiple && (
              <View style={styles.pageIndicatorBadge}>
                <Text style={styles.pageIndicatorText}>
                  {currentIndex + 1}/{items.length}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.playerContainer}>
            {isLoading ? <LoadingSkeleton /> : err ? <ErrorState message={err} onRetry={handleRetry} /> : renderContent()}
          </View>

          {hasMultiple && (
            <View style={styles.sideNav}>
              {currentIndex > 0 && (
                <Pressable 
                  onPress={() => goToIndex(currentIndex - 1)} 
                  style={[styles.sideNavBtn, styles.prevBtn]} 
                  accessibilityLabel="Previous preview"
                >
                  <Ionicons name="chevron-back" size={28} color={TEXT} />
                </Pressable>
              )}
              {currentIndex < items.length - 1 && (
                <Pressable 
                  onPress={() => goToIndex(currentIndex + 1)} 
                  style={[styles.sideNavBtn, styles.nextBtn]} 
                  accessibilityLabel="Next preview"
                >
                  <Ionicons name="chevron-forward" size={28} color={TEXT} />
                </Pressable>
              )}
            </View>
          )}

          {hasMultiple && (
              <View style={styles.bottomDots}>
                {items.map((_, i) => (
                  <Pressable
                    key={`dot-${i}`}
                    onPress={() => goToIndex(i)}
                    style={[
                      styles.dot,
                      { backgroundColor: i === currentIndex ? TEAL : "rgba(255,255,255,0.2)" },
                    ]}
                  />
                ))}
              </View>
            )}
        </LinearGradient>
      </Animated.View>
    </Modal>
  );
}

function LoadingSkeleton({ kind }: { kind?: PreviewPayload["kind"] }) {
  return (
    <View style={styles.skeletonWrapper}>
      <Shimmer style={{ flex: 1, borderRadius: 28 }} />
      <View style={styles.skeletonSpinner}>
        <ActivityIndicator color={TEAL} size="large" />
      </View>
    </View>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.errorWrapper}>
      <View style={styles.errorIcon}>
        <Ionicons name="alert-circle-outline" size={32} color={ROSE} />
      </View>
      <Text style={styles.errorTitle}>Preview failed</Text>
      <Text style={styles.errorText}>{message}</Text>
      <Pressable onPress={onRetry} style={styles.retryBtn}>
        <Ionicons name="refresh" size={18} color={TEAL} />
        <Text style={styles.retryText}>Try again</Text>
      </Pressable>
    </View>
  );
}

function PreviewWatermark() {
  return (
    <View pointerEvents="none" style={styles.watermarkOverlay}>
      {Array.from({ length: 9 }).map((_, row) => (
        <View key={`wm-row-${row}`} style={[styles.watermarkRow, { top: row * 56 - 20 }]}>
          {Array.from({ length: 8 }).map((__, col) => (
            <View key={`wm-cell-${row}-${col}`} style={styles.watermarkCell}>
              <Text style={styles.watermarkText}>PREVIEW</Text>
            </View>
          ))}
        </View>
      ))}
      <View style={styles.watermarkLogo}>
        <Image source={WatermarkIcon} style={{ width: 32, height: 32 }} />
      </View>
    </View>
  );
}

function ReelImageBlock({ uri, watermark }: { uri: string; watermark: boolean }) {
  const imageSource = useMemo(() => ({ uri }), [uri]);
  const [zoomScale, setZoomScale] = useState(1);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const loadedImageUriRef = useRef<string | null>(null);
  const scale = useRef(new Animated.Value(1)).current;
  const lastTapRef = useRef<number>(0);

  useEffect(() => {
    scale.setValue(1);
    setZoomScale(1);
    setImageLoaded(loadedImageUriRef.current === uri);
    setImageError(false);
  }, [uri, scale]);

  const handleDoubleTap = () => {
    const now = Date.now();
    if (lastTapRef.current && now - lastTapRef.current < 300) {
      const newScale = zoomScale === 1 ? 2 : 1;
      setZoomScale(newScale);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Animated.spring(scale, {
        toValue: newScale,
        useNativeDriver: true,
        bouncy: 8,
        speed: 20,
      }).start();
    }
    lastTapRef.current = now;
  };

  return (
    <View style={styles.reelImageContainer}>
      <Pressable onPress={handleDoubleTap} style={styles.reelImagePressable}>
        <Animated.View style={[styles.reelImageZoomLayer, { transform: [{ scale }] }]}>
          <View style={styles.reelImageFrame}>
            <Image
              source={imageSource}
              style={[styles.reelImage, { opacity: imageLoaded ? 1 : 0 }]}
              resizeMode="contain"
              onLoadStart={() => {
                if (loadedImageUriRef.current !== uri) {
                  setImageLoaded(false);
                }
                setImageError(false);
              }}
              onLoad={() => {
                loadedImageUriRef.current = uri;
                setImageLoaded(true);
              }}
              onError={() => {
                setImageLoaded(false);
                setImageError(true);
              }}
            />
            {!imageLoaded && !imageError ? (
              <View pointerEvents="none" style={styles.reelImageLoading}>
                <Shimmer style={StyleSheet.absoluteFill} />
                <ActivityIndicator color={TEAL} size="large" />
              </View>
            ) : null}
            {imageError ? (
              <View style={styles.reelImageError}>
                <Ionicons name="image-outline" size={34} color={ROSE} />
                <Text style={styles.reelImageErrorText}>Image failed to load</Text>
              </View>
            ) : null}
            {watermark && imageLoaded && !imageError ? <PreviewWatermark /> : null}
          </View>
        </Animated.View>
      </Pressable>
    </View>
  );
}

function ReelVideoBlock({
  uri,
  watermark,
  previewSeconds,
}: {
  uri: string | null;
  watermark: boolean;
  previewSeconds: number;
}) {
  const videoRef = useRef<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [positionMillis, setPositionMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState(0);
  const [previewEnded, setPreviewEnded] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
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
      <View style={styles.loadingWrapper}>
        <ActivityIndicator color={TEAL} size="large" />
      </View>
    );
  }

  const previewCapMillis = previewSeconds * 1000;
  const effectiveDuration = watermark ? Math.min(durationMillis || previewCapMillis, previewCapMillis) : durationMillis;
  const progress = effectiveDuration > 0 ? Math.max(0, Math.min(1, positionMillis / effectiveDuration)) : 0;

  async function togglePlay() {
    if (previewEnded) {
      await videoRef.current?.setPositionAsync?.(0);
      setPreviewEnded(false);
      await videoRef.current?.playAsync?.();
      Haptics.selectionAsync();
      return;
    }
    if (isPlaying) {
      await videoRef.current?.pauseAsync?.();
    } else {
      await videoRef.current?.playAsync?.();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    setControlsVisible(true);
    scheduleHide();
  }

  async function toggleMute() {
    Haptics.selectionAsync();
    setIsMuted(m => !m);
  }

  const positionSecs = Math.floor(positionMillis / 1000);
  const durationSecs = Math.floor(effectiveDuration / 1000);
  const timeDisplay = watermark 
    ? `${formatTime(positionSecs)} / ${formatTime(previewSeconds)}`
    : `${formatTime(positionSecs)} / ${formatTime(durationSecs)}`;

  return (
    <View style={styles.reelVideoContainer}>
      <View style={styles.reelVideoFrame}>
        <Video
            ref={videoRef}
            source={{ uri }}
            style={styles.reelVideo}
            resizeMode={ResizeMode.CONTAIN}
            useNativeControls={false}
            shouldPlay={false}
            isMuted={isMuted}
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
          {watermark && <PreviewWatermark />}

          {!isPlaying && !previewEnded && (
            <View style={styles.bigPlayCenter}>
              <Pressable onPress={togglePlay} style={styles.bigPlayBtn}>
                <Ionicons name="play" size={32} color={INK} />
              </Pressable>
            </View>
          )}

          {previewEnded && (
            <View style={styles.previewEndedOverlayReel}>
              <View style={styles.previewEndedIcon}>
                <Ionicons name="lock-closed-outline" size={24} color={AMBER} />
              </View>
              <Text style={styles.previewEndedTitle}>Preview ended</Text>
              <Pressable onPress={togglePlay} style={styles.previewEndedBtn}>
                <Ionicons name="refresh" size={16} color={INK} />
                <Text style={styles.previewEndedText}>Replay</Text>
              </Pressable>
            </View>
          )}

          {controlsVisible && (
            <View style={styles.reelControls}>
              <Pressable onPress={togglePlay} style={styles.controlBtn}>
                <Ionicons name={previewEnded ? "refresh" : isPlaying ? "pause" : "play"} size={20} color={TEXT} />
              </Pressable>

              <View style={styles.progressTrack}>
                <View style={styles.progressBg} />
                <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
              </View>

              <Text style={styles.progressTime}>{timeDisplay}</Text>

              <Pressable onPress={toggleMute} style={styles.controlBtn}>
                <Ionicons name={isMuted ? "volume-mute" : "volume-medium"} size={18} color={TEXT} />
              </Pressable>
            </View>
          )}
        </View>
    </View>
  );
}

function AudioBlockSimple({ uri, watermark, previewSeconds }: { uri: string | null; watermark: boolean; previewSeconds: number }) {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [positionMillis, setPositionMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState(0);
  const [ended, setEnded] = useState(false);
  const rotateAnim = useRef(new Animated.Value(0)).current;

  const barHeights = Array.from({ length: 40 }, (_, i) => 8 + ((i * 47) % 40));

  useEffect(() => {
    if (playing) {
      const spin = Animated.loop(
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 3000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      spin.start();
      return () => spin.stop();
    }
  }, [playing, rotateAnim]);

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
        Haptics.selectionAsync();
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
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } else {
        const status: any = await sound.getStatusAsync();
        if (status.isLoaded && status.isPlaying) {
          await sound.pauseAsync();
        } else {
          await sound.playAsync();
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  if (!uri) return null;

  const effectiveDuration = watermark ? Math.min(durationMillis || previewSeconds * 1000, previewSeconds * 1000) : durationMillis;
  const progress = effectiveDuration > 0 ? Math.max(0, Math.min(1, positionMillis / effectiveDuration)) : 0;
  const activeBars = Math.round(progress * barHeights.length);

  const spin = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <View style={styles.mediaPanel}>
      <Animated.View style={{ transform: [{ rotate: spin }] }}>
        <View style={styles.audioIconCircle}>
          <Ionicons name="musical-notes" size={32} color={AMBER} />
        </View>
      </Animated.View>

      <View style={styles.waveformContainer}>
        {barHeights.map((h, i) => (
          <View
            key={i}
            style={[
              styles.waveformBar,
              {
                height: h,
                backgroundColor: i < activeBars 
                  ? `rgba(45,212,191,${0.4 + (i / barHeights.length) * 0.5})` 
                  : "rgba(255,255,255,0.12)",
              },
            ]}
          />
        ))}
      </View>

      <Text style={{ color: MUTED, fontSize: 12, marginTop: -8 }}>
        {watermark ? `${formatTime(Math.floor(positionMillis / 1000))} / ${formatTime(previewSeconds)}` : formatTime(Math.floor(positionMillis / 1000))}
      </Text>

      <Pressable onPress={toggle} disabled={loading} style={styles.playBtn}>
        {loading ? (
          <ActivityIndicator color={INK} />
        ) : (
          <Ionicons name={ended ? "refresh" : playing ? "pause" : "play"} size={24} color={INK} />
        )}
      </Pressable>

      {ended && watermark && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
          <Ionicons name="lock-closed" size={14} color={AMBER} />
          <Text style={{ color: AMBER, fontSize: 12, fontWeight: "700" }}>Preview ended</Text>
        </View>
      )}
    </View>
  );
}

function FileBlockSimple({ uri, watermark, mimeType, title }: { uri: string | null; watermark: boolean; mimeType?: string | null; title?: string | null }) {
  const fileName = title?.trim() || guessFileNameFromUrl(uri);
  const ext = getFileExtension(fileName) || getFileExtension(mimeType ?? "");
  const icon = fileIconForExtension(ext);

  return (
    <View style={styles.mediaPanel}>
      <View style={styles.fileIconCircle}>
        <Ionicons name={icon} size={32} color={TEAL} />
      </View>
      {ext && (
        <View style={styles.fileExtBadge}>
          <Text style={styles.fileExtText}>{ext.toUpperCase()}</Text>
        </View>
      )}
      {watermark && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
          <Ionicons name="lock-closed" size={14} color={AMBER} />
          <Text style={{ color: AMBER, fontSize: 12, fontWeight: "700" }}>Preview access</Text>
        </View>
      )}
      <Pressable disabled={!uri} onPress={() => uri && Linking.openURL(uri)} style={styles.openBtn}>
        <Ionicons name="open-outline" size={22} color={uri ? INK : FAINT} />
      </Pressable>
      <Text style={{ color: MUTED, fontSize: 12, marginTop: -12, maxWidth: 200, textAlign: "center" }}>
        {fileName}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  pageIndicatorBadge: {
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  pageIndicatorText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  playerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  sideNav: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    pointerEvents: "box-none",
  },
  sideNavBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  prevBtn: {
    marginLeft: 4,
    shadowColor: GLOW_TEAL,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
  },
  nextBtn: {
    marginRight: 4,
    shadowColor: GLOW_TEAL,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
  },
  bottomDots: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 20,
    marginBottom: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginHorizontal: 3,
  },
  skeletonWrapper: {
    flex: 1,
    borderRadius: 28,
    overflow: "hidden",
  },
  skeletonSpinner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  errorWrapper: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  errorIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(251,113,133,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  errorTitle: {
    color: TEXT,
    fontWeight: "900",
    fontSize: 18,
    letterSpacing: 0.3,
  },
  errorText: {
    color: MUTED,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: "rgba(45,212,191,0.2)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.4)",
  },
  retryText: {
    color: TEAL,
    fontWeight: "800",
    fontSize: 14,
  },
  watermarkOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: "hidden",
  },
  watermarkRow: {
    position: "absolute",
    left: -100,
    flexDirection: "row",
  },
  watermarkCell: {
    width: 140,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "-24deg" }],
    opacity: 0.08,
  },
  watermarkText: {
    color: "rgba(255,253,255,0.4)",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2,
  },
  watermarkLogo: {
    position: "absolute",
    right: 12,
    bottom: 12,
    opacity: 0.25,
  },
  reelImageContainer: {
    flex: 1,
    alignSelf: "stretch",
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  reelImagePressable: {
    flex: 1,
    alignSelf: "stretch",
    width: "100%",
  },
  reelImageZoomLayer: {
    flex: 1,
    alignSelf: "stretch",
    width: "100%",
  },
  reelImageFrame: {
    flex: 1,
    width: "100%",
    height: "100%",
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  reelImage: {
    width: "100%",
    height: "100%",
  },
  reelImageLoading: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  reelImageError: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "rgba(251,113,133,0.10)",
  },
  reelImageErrorText: {
    color: ROSE,
    fontWeight: "800",
    fontSize: 13,
  },
  reelVideoContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  reelVideoFrame: {
    borderRadius: 28,
    overflow: "hidden",
    width: "100%",
    height: "100%",
  },
  reelVideo: {
    width: "100%",
    height: "100%",
  },
  bigPlayCenter: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  bigPlayBtn: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "rgba(255,255,255,0.95)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: GLOW_TEAL,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
    elevation: 10,
  },
  previewEndedOverlayReel: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.75)",
    gap: 12,
  },
  previewEndedIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(244,183,93,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  previewEndedTitle: {
    color: TEXT,
    fontWeight: "900",
    fontSize: 18,
    letterSpacing: 0.5,
  },
  previewEndedBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: AMBER,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 18,
    marginTop: 8,
  },
  previewEndedText: {
    color: INK,
    fontWeight: "800",
    fontSize: 14,
  },
  reelControls: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 22,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  controlBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  progressTrack: {
    flex: 1,
    height: 8,
    justifyContent: "center",
  },
  progressBg: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  progressFill: {
    position: "absolute",
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: TEAL,
  },
  progressTime: {
    color: TEXT,
    fontSize: 12,
    fontWeight: "700",
    minWidth: 70,
    textAlign: "right",
  },
  loadingWrapper: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  audioPanel: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  mediaPanel: {
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
  },
  audioIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "rgba(244,183,93,0.15)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(244,183,93,0.4)",
    shadowColor: GLOW_AMBER,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
  },
  fileIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "rgba(45,212,191,0.12)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(45,212,191,0.4)",
    shadowColor: GLOW_TEAL,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 14,
  },
  waveformContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 56,
  },
  waveformBar: {
    flex: 1,
    borderRadius: 3,
  },
  playBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: TEAL,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: GLOW_TEAL,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 14,
  },
  openBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: TEAL,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: GLOW_TEAL,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
  },
  fileExtBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "rgba(45,212,191,0.95)",
  },
  fileExtText: {
    color: INK,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  browserWrapper: {
    flex: 1,
    width: "100%",
    borderRadius: 28,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: BORDER_TOP,
  },
});
