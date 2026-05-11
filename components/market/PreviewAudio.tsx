import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Audio } from "expo-av";
import WatermarkOverlay from "./WatermarkOverlay";
import { useSecureScreen } from "@/hooks/useSecureScreen";

type Props = {
  uri: string;
  locked?: boolean;
  watermarkLabel?: string;
};

export default function PreviewAudio({
  uri,
  locked = true,
  watermarkLabel = "Preview",
}: Props) {
  useSecureScreen(true);

  const soundRef = useRef<Audio.Sound | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);

  async function stop() {
    try {
      const s = soundRef.current;
      if (s) {
        await s.stopAsync();
        await s.unloadAsync();
      }
    } catch {}
    soundRef.current = null;
    setPlaying(false);
  }

  async function toggle() {
    if (locked) return;

    if (playing) {
      await stop();
      return;
    }

    setLoading(true);
    try {
      await stop();
      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true },
      );
      soundRef.current = sound;

      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) return;
        if (status.didJustFinish) stop();
      });

      setPlaying(true);
    } catch (e) {
      await stop();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.card}>
      <WatermarkOverlay label={watermarkLabel} opacity={0.10} />

      <Text style={styles.title}>Audio preview</Text>
      <Text style={styles.sub}>
        {locked ? "Preview unavailable." : "Ready to play."}
      </Text>

      <Pressable
        onPress={toggle}
        disabled={locked || loading}
        style={[
          styles.btn,
          locked ? styles.btnLocked : null,
        ]}
      >
        {loading ? <ActivityIndicator /> : <Text style={[styles.btnText, locked ? styles.btnTextLocked : null]}>{playing ? "Stop" : "Play"}</Text>}
      </Pressable>
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
  },
  title: { color: "#fff", fontWeight: "900", fontSize: 14 },
  sub: { marginTop: 6, color: "rgba(255,255,255,0.65)", fontWeight: "700" },
  btn: {
    marginTop: 12,
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#2DD4BF",
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.45)",
  },
  btnLocked: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderColor: "rgba(255,255,255,0.12)",
  },
  btnText: { color: "#07100D", fontWeight: "900" },
  btnTextLocked: { color: "rgba(255,255,255,0.60)" },
});
