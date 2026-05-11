import { ResizeMode, Video, Audio } from "expo-av";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Linking, Modal, Pressable, Text, View } from "react-native";
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

  const title = useMemo(() => payload?.title ?? "Preview", [payload]);
  const isPreview = payload?.access === "preview";

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
  }, [open, payload]);

  return (
    <Modal visible={open} animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <LinearGradient
        colors={[BG1, BG0]}
        style={{
          flex: 1,
          paddingTop: Math.max(insets.top, 18),
          paddingBottom: Math.max(insets.bottom, 16),
          paddingHorizontal: 16,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>
              {title}
            </Text>
            <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>
              {isPreview ? "Preview access" : "Full access"}
            </Text>
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
            <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>X</Text>
          </Pressable>
        </View>

        {busy ? (
          <CenterMessage icon="hourglass-outline" title="Loading preview" message="One moment..." />
        ) : err ? (
          <CenterMessage icon="alert-circle-outline" title="Preview failed" message={err} tone={ROSE} />
        ) : !payload ? null : payload.kind === "image" ? (
          resolvedUrl ? <ImageBlock uri={resolvedUrl} watermark={isPreview} fill /> : null
        ) : payload.kind === "video" ? (
          <VideoBlock uri={resolvedUrl} watermark={isPreview} previewSeconds={payload.previewSeconds ?? 20} fill />
        ) : payload.kind === "audio" ? (
          <AudioBlock uri={resolvedUrl} watermark={isPreview} previewSeconds={payload.previewSeconds ?? 20} />
        ) : payload.kind === "file" ? (
          <FileBlock uri={resolvedUrl} watermark={isPreview} />
        ) : payload.kind === "link" ? (
          resolvedUrl ? (
            <View style={{ marginTop: 12, flex: 1 }}>
              <WatermarkedBrowser initialUrl={resolvedUrl} allowGoogleSearch lockToInitialHost />
            </View>
          ) : null
        ) : null}
      </LinearGradient>
    </Modal>
  );
}

function CenterMessage({
  icon,
  title,
  message,
  tone = TEAL,
}: {
  icon: IconName;
  title: string;
  message: string;
  tone?: string;
}) {
  return (
    <View
      style={{
        marginTop: 18,
        borderRadius: 22,
        padding: 18,
        backgroundColor: PANEL,
        borderWidth: 1,
        borderColor: BORDER,
        alignItems: "center",
      }}
    >
      {title === "Loading preview" ? <ActivityIndicator color={tone} /> : <Ionicons name={icon} size={22} color={tone} />}
      <Text style={{ marginTop: 10, color: TEXT, fontWeight: "900" }}>{title}</Text>
      <Text style={{ marginTop: 5, color: MUTED, textAlign: "center" }}>{message}</Text>
    </View>
  );
}

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
}: {
  watermark: boolean;
  children: React.ReactNode;
  fill?: boolean;
  aspectRatio?: number | null;
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

function ImageBlock({ uri, watermark, fill = false }: { uri: string; watermark: boolean; fill?: boolean }) {
  const [aspectRatio, setAspectRatio] = useState<number>(9 / 16);

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

  return (
    <MediaFrame watermark={watermark} fill={fill} aspectRatio={aspectRatio}>
      <Image source={{ uri }} style={{ width: "100%", height: "100%" }} resizeMode="contain" />
    </MediaFrame>
  );
}

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
  const [aspectRatio, setAspectRatio] = useState<number>(9 / 16);

  useEffect(() => {
    setAspectRatio(9 / 16);
  }, [uri]);

  if (!uri) return <CenterMessage icon="videocam-outline" title="Loading video" message="One moment..." />;

  return (
    <MediaFrame watermark={watermark} fill={fill} aspectRatio={aspectRatio}>
      <Video
        ref={videoRef}
        source={{ uri }}
        style={{ width: "100%", height: "100%" }}
        resizeMode={ResizeMode.CONTAIN}
        useNativeControls
        shouldPlay={false}
        isMuted={false}
        onReadyForDisplay={(event: any) => {
          const naturalWidth = Number(event?.naturalSize?.width ?? event?.status?.naturalSize?.width ?? 0);
          const naturalHeight = Number(event?.naturalSize?.height ?? event?.status?.naturalSize?.height ?? 0);
          if (naturalWidth > 0 && naturalHeight > 0) setAspectRatio(naturalWidth / naturalHeight);
        }}
        onPlaybackStatusUpdate={(status: any) => {
          if (!watermark || !status?.isLoaded) return;
          if (status.positionMillis >= previewSeconds * 1000 && status.isPlaying) {
            videoRef.current?.pauseAsync?.();
          }
        }}
      />
    </MediaFrame>
  );
}

function AudioBlock({ uri, watermark, previewSeconds }: { uri: string | null; watermark: boolean; previewSeconds: number }) {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    return () => {
      sound?.unloadAsync().catch(() => undefined);
    };
  }, [sound]);

  async function toggle() {
    if (!uri || loading) return;
    setLoading(true);
    try {
      if (!sound) {
        const { sound: nextSound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
        nextSound.setOnPlaybackStatusUpdate((status: any) => {
          if (!status?.isLoaded) return;
          setPlaying(!!status.isPlaying);
          if (watermark && status.positionMillis >= previewSeconds * 1000) {
            nextSound.pauseAsync();
            nextSound.setPositionAsync(0);
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

  if (!uri) return <CenterMessage icon="musical-notes-outline" title="Loading audio" message="One moment..." />;

  return (
    <View
      style={{
        marginTop: 14,
        borderRadius: 22,
        padding: 18,
        backgroundColor: PANEL,
        borderWidth: 1,
        borderColor: BORDER_TOP,
      }}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 22,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(244,183,93,0.14)",
          borderWidth: 1,
          borderColor: "rgba(244,183,93,0.34)",
        }}
      >
        <Ionicons name="musical-notes" size={23} color={AMBER} />
      </View>
      <Text style={{ marginTop: 14, color: TEXT, fontWeight: "900", fontSize: 18 }}>
        {watermark ? "Audio preview" : "Audio"}
      </Text>
      <Text style={{ marginTop: 6, color: MUTED }}>{watermark ? `Playback stops at ${previewSeconds}s.` : "Ready to play."}</Text>

      <Pressable
        onPress={toggle}
        disabled={loading}
        style={({ pressed }) => ({
          marginTop: 14,
          borderRadius: 18,
          paddingVertical: 13,
          alignItems: "center",
          backgroundColor: TEAL,
          opacity: loading ? 0.7 : 1,
          transform: [{ translateY: pressed ? 1 : 0 }],
        })}
      >
        {loading ? <ActivityIndicator color={INK} /> : <Text style={{ color: INK, fontWeight: "900" }}>{playing ? "Pause" : "Play"}</Text>}
      </Pressable>
    </View>
  );
}

function FileBlock({ uri, watermark }: { uri: string | null; watermark: boolean }) {
  return (
    <View
      style={{
        marginTop: 14,
        borderRadius: 22,
        padding: 18,
        backgroundColor: PANEL,
        borderWidth: 1,
        borderColor: BORDER_TOP,
      }}
    >
      <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>{watermark ? "Preview file" : "File"}</Text>
      <Text style={{ marginTop: 6, color: MUTED }}>Open this file in your device browser.</Text>

      <Pressable
        disabled={!uri}
        onPress={() => uri && Linking.openURL(uri)}
        style={({ pressed }) => ({
          marginTop: 14,
          borderRadius: 18,
          paddingVertical: 13,
          alignItems: "center",
          backgroundColor: uri ? TEAL : "rgba(255,253,247,0.12)",
          opacity: uri ? 1 : 0.7,
          transform: [{ translateY: pressed ? 1 : 0 }],
        })}
      >
        <Text style={{ color: uri ? INK : FAINT, fontWeight: "900" }}>{uri ? "Open file" : "Loading..."}</Text>
      </Pressable>
    </View>
  );
}
