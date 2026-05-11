import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Audio } from "expo-av";

export function AudioPreview({
  uri,
  previewSeconds = 20,
}: {
  uri: string;
  previewSeconds?: number;
}) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);

  useEffect(() => {
    return () => {
      (async () => {
        try {
          if (soundRef.current) {
            await soundRef.current.unloadAsync();
          }
        } catch {}
      })();
    };
  }, []);

  async function toggle() {
    if (loading) return;
    setLoading(true);
    try {
      if (!soundRef.current) {
        const { sound } = await Audio.Sound.createAsync(
          { uri },
          { shouldPlay: true, positionMillis: 0 },
        );
        soundRef.current = sound;

        sound.setOnPlaybackStatusUpdate((st: any) => {
          if (!st?.isLoaded) return;
          setPlaying(!!st.isPlaying);
          setPos(Math.floor((st.positionMillis ?? 0) / 1000));

          if ((st.positionMillis ?? 0) >= previewSeconds * 1000) {
            sound.pauseAsync();
            sound.setPositionAsync(0);
          }
        });
      } else {
        const s = soundRef.current;
        const status: any = await s.getStatusAsync();
        if (status.isLoaded && status.isPlaying) await s.pauseAsync();
        else {
          await s.setPositionAsync(0);
          await s.playAsync();
        }
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <View
      style={{
        marginTop: 10,
        borderRadius: 18,
        padding: 14,
        backgroundColor: "rgba(255,253,247,0.06)",
        borderWidth: 1,
        borderColor: "rgba(255,253,247,0.12)",
      }}
    >
      <Text style={{ color: "#fff", fontWeight: "900" }}>Audio preview</Text>
      <Text style={{ marginTop: 6, color: "rgba(255,253,247,0.65)" }}>
        Plays up to {previewSeconds}s.
      </Text>

      <Pressable
        onPress={toggle}
        style={{
          marginTop: 12,
          borderRadius: 14,
          paddingVertical: 12,
          alignItems: "center",
          backgroundColor: "#2DD4BF",
        }}
      >
        {loading ? <ActivityIndicator color="#07100D" /> : <Text style={{ color: "#07100D", fontWeight: "900" }}>{playing ? "Pause" : "Play preview"}</Text>}
      </Pressable>

      <Text style={{ marginTop: 10, color: "rgba(255,253,247,0.70)", fontWeight: "900" }}>
        {pos}s / {previewSeconds}s
      </Text>
    </View>
  );
}
