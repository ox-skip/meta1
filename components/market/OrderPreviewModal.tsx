import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Linking, Modal, Pressable, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ResizeMode, Video } from "expo-av";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePreventScreenCapture } from "@/hooks/usePreventScreenCapture";
import { WatermarkedBrowser } from "@/components/market/WatermarkedBrowser";

const BG0 = "#05040B";
const BG1 = "#0A0620";
const WatermarkIcon = require("../../assets/images/icon.png");

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
        const u = await payload.urlPromise();
        if (!alive) return;
        setResolvedUrl(u);
        if (!u) setErr("Could not load preview URL");
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Could not load preview");
      } finally {
        if (!alive) return;
        setBusy(false);
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
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Pressable
            onPress={onClose}
            style={{
              borderRadius: 16,
              paddingVertical: 10,
              paddingHorizontal: 12,
              backgroundColor: "rgba(255,255,255,0.08)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.12)",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900" }}>Close</Text>
          </Pressable>

          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ color: "#fff", fontWeight: "900" }}>{title}</Text>
            <Text style={{ marginTop: 2, color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
              {isPreview ? "Low quality - Watermarked" : "Original quality"}
            </Text>
          </View>
        </View>

        {busy ? (
          <View style={{ marginTop: 30, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.7)", fontWeight: "800" }}>Loading...</Text>
          </View>
        ) : err ? (
          <View style={{ marginTop: 18, borderRadius: 18, padding: 14, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" }}>
            <Text style={{ color: "#fff", fontWeight: "900" }}>Preview failed</Text>
            <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.65)" }}>{err}</Text>
          </View>
        ) : !payload ? null : payload.kind === "image" ? (
          resolvedUrl ? (
            <MediaFrame watermark={isPreview} fill>
              <Image source={{ uri: resolvedUrl }} style={{ width: "100%", height: "100%" }} resizeMode="contain" />
            </MediaFrame>
          ) : null
        ) : payload.kind === "video" ? (
          <VideoBlock
            uri={resolvedUrl}
            watermark={isPreview}
            previewSeconds={payload.previewSeconds ?? 20}
            fill
          />
        ) : payload.kind === "audio" ? (
          <AudioBlock uri={resolvedUrl} watermark={isPreview} previewSeconds={payload.previewSeconds ?? 20} />
        ) : payload.kind === "file" ? (
          <FileBlock uri={resolvedUrl} watermark={isPreview} />
        ) : payload.kind === "link" ? (
          resolvedUrl ? (
            <View style={{ marginTop: 12 }}>
              <WatermarkedBrowser initialUrl={resolvedUrl} allowGoogleSearch lockToInitialHost />
            </View>
          ) : null
        ) : null}
      </LinearGradient>
    </Modal>
  );
}

function MediaFrame({
  watermark,
  children,
  fill = false,
}: {
  watermark: boolean;
  children: React.ReactNode;
  fill?: boolean;
}) {
  return (
    <View
      style={{
        marginTop: 14,
        flex: fill ? 1 : undefined,
        minHeight: fill ? 0 : undefined,
        borderRadius: 18,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
      }}
    >
      <View
        style={{
          flex: fill ? 1 : undefined,
          minHeight: fill ? 0 : 380,
          backgroundColor: "rgba(0,0,0,0.96)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {children}
        {watermark ? (
          <View pointerEvents="none" style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
            {Array.from({ length: 8 }).map((_, row) => (
              <View
                key={`wm-row-${row}`}
                style={{
                  position: "absolute",
                  top: row * 56 - 20,
                  left: row % 2 === 0 ? -24 : -82,
                  flexDirection: "row",
                }}
              >
                {Array.from({ length: 7 }).map((__, col) => (
                  <View
                    key={`wm-cell-${row}-${col}`}
                    style={{
                      width: 138,
                      transform: [{ rotate: "-24deg" }],
                      opacity: 0.18,
                    }}
                  >
                    <Text
                      style={{
                        color: "rgba(255,255,255,0.40)",
                        fontSize: 10,
                        fontWeight: "900",
                        letterSpacing: 0.8,
                      }}
                    >
                      BESTCITY PREVIEW
                    </Text>
                  </View>
                ))}
              </View>
            ))}
            <View style={{ position: "absolute", right: 10, bottom: 10, opacity: 0.22 }}>
              <Image source={WatermarkIcon} style={{ width: 34, height: 34 }} />
            </View>
          </View>
        ) : null}
      </View>
      <View style={{ padding: 12, backgroundColor: "rgba(0,0,0,0.35)" }}>
        <Text style={{ color: "rgba(255,255,255,0.85)", fontWeight: "900", fontSize: 12 }}>
          {watermark ? "Preview only - Low quality / Watermarked" : "Original quality deliverable"}
        </Text>
      </View>
    </View>
  );
}

function FileBlock({ uri, watermark }: { uri: string | null; watermark: boolean }) {
  return (
    <View style={{ marginTop: 18, borderRadius: 18, padding: 14, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" }}>
      <Text style={{ color: "#fff", fontWeight: "900" }}>{watermark ? "File preview" : "File download"}</Text>
      <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.65)" }}>
        {watermark ? "This is a preview file. It may be watermarked or reduced quality." : "This is the full-quality file."}
      </Text>

      <Pressable
        disabled={!uri}
        onPress={() => uri && Linking.openURL(uri)}
        style={{
          marginTop: 12,
          borderRadius: 14,
          paddingVertical: 12,
          alignItems: "center",
          backgroundColor: uri ? "rgba(124,58,237,0.85)" : "rgba(255,255,255,0.08)",
          borderWidth: 1,
          borderColor: uri ? "rgba(124,58,237,0.95)" : "rgba(255,255,255,0.12)",
          opacity: uri ? 1 : 0.7,
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "900" }}>{uri ? "Open / Download" : "Loading..."}</Text>
      </Pressable>
    </View>
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

  if (!uri) {
    return (
      <View style={{ marginTop: 18, alignItems: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.7)", fontWeight: "800" }}>Loading video...</Text>
      </View>
    );
  }

  return (
    <MediaFrame watermark={watermark} fill={fill}>
      <Video
        ref={videoRef}
        source={{ uri }}
        style={{ width: "100%", height: "100%" }}
        resizeMode={ResizeMode.CONTAIN}
        useNativeControls
        shouldPlay={false}
        isMuted={false}
        onPlaybackStatusUpdate={(st: any) => {
          if (!watermark) return;
          if (!st?.isLoaded) return;
          const limitMs = previewSeconds * 1000;
          if (st.positionMillis >= limitMs && st.isPlaying) {
            videoRef.current?.pauseAsync?.();
          }
        }}
      />
    </MediaFrame>
  );
}

function AudioBlock({ uri, watermark, previewSeconds }: { uri: string | null; watermark: boolean; previewSeconds: number }) {
  const [av, setAv] = useState<any | null | false>(null);
  const [sound, setSound] = useState<any>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const mod = await import("expo-av");
        if (!alive) return;
        setAv(mod);
      } catch {
        if (!alive) return;
        setAv(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!av || av === false) return;
      if (!uri) return;

      try {
        if (sound) {
          await sound.unloadAsync();
          setSound(null);
          setPlaying(false);
        }

        const { sound: s } = await av.Audio.Sound.createAsync(
          { uri },
          { shouldPlay: false },
          (st: any) => {
            if (!st?.isLoaded) return;
            setPlaying(!!st.isPlaying);
            if (watermark) {
              const limitMs = previewSeconds * 1000;
              if (st.positionMillis >= limitMs && st.isPlaying) {
                s.pauseAsync();
              }
            }
          },
        );

        if (!mounted) return;
        setSound(s);
      } catch {}
    })();

    return () => {
      mounted = false;
      (async () => {
        try {
          if (sound) await sound.unloadAsync();
        } catch {}
      })();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [av, uri]);

  if (!uri) {
    return (
      <View style={{ marginTop: 18, alignItems: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.7)", fontWeight: "800" }}>Loading audio...</Text>
      </View>
    );
  }

  if (av === false) {
    return (
      <View style={{ marginTop: 18, borderRadius: 18, padding: 14, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" }}>
        <Text style={{ color: "#fff", fontWeight: "900" }}>Audio preview not installed</Text>
        <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.65)" }}>Install expo-av to play audio in-app.</Text>
        <Pressable
          onPress={() => Linking.openURL(uri)}
          style={{ marginTop: 12, borderRadius: 14, paddingVertical: 12, alignItems: "center", backgroundColor: "rgba(124,58,237,0.85)" }}
        >
          <Text style={{ color: "#fff", fontWeight: "900" }}>Open in browser</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ marginTop: 14, borderRadius: 18, padding: 14, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" }}>
      <Text style={{ color: "#fff", fontWeight: "900" }}>{watermark ? "Audio preview" : "Full audio"}</Text>
      <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.65)" }}>
        {watermark ? `Preview stops at ${previewSeconds}s.` : "Full-quality audio."}
      </Text>

      <Pressable
        disabled={!sound}
        onPress={async () => {
          if (!sound) return;
          if (playing) await sound.pauseAsync();
          else await sound.playAsync();
        }}
        style={{
          marginTop: 12,
          borderRadius: 14,
          paddingVertical: 12,
          alignItems: "center",
          backgroundColor: sound ? "rgba(124,58,237,0.85)" : "rgba(255,255,255,0.08)",
          borderWidth: 1,
          borderColor: sound ? "rgba(124,58,237,0.95)" : "rgba(255,255,255,0.12)",
          opacity: sound ? 1 : 0.7,
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "900" }}>{sound ? (playing ? "Pause" : "Play") : "Loading..."}</Text>
      </Pressable>
    </View>
  );
}

