import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppHeader from "@/components/common/AppHeader";
import {
  DMAttachment,
  DMMessage,
  fetchMessages,
  getOrCreateThread,
  getUserByUsername,
  markRead,
  reactToMessage,
  removeReaction,
  sendMedia,
  sendText,
} from "@/services/dm/dmService";
import { supabase } from "@/services/supabase";

const BG0 = "#05040B";
const BG1 = "#0A0620";
const PURPLE = "#7C3AED";
const CARD = "rgba(255,255,255,0.06)";
const BORDER = "rgba(255,255,255,0.10)";
const MUTED = "rgba(255,255,255,0.62)";

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

function getExpoAv() {
  try {
    return require("expo-av");
  } catch {
    return null;
  }
}
const ExpoAV = getExpoAv();
const Audio = ExpoAV?.Audio;
const Video = ExpoAV?.Video;
const ResizeMode = ExpoAV?.ResizeMode ?? { CONTAIN: "contain" };

type PendingMedia = {
  kind: "image" | "video" | "audio";
  uri: string;
  mime_type?: string | null;
  duration_sec?: number | null;
};

function formatTime(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isMine(senderId: string, meId: string | null) {
  return !!meId && senderId === meId;
}

export default function DMChat() {
  const insets = useSafeAreaInsets();
  const { username } = useLocalSearchParams<{ username: string }>();
  const handle = useMemo(() => String(username || "").trim().toLowerCase(), [username]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [other, setOther] = useState<any>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState<any>(null);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<PendingMedia | null>(null);
  const [replyTo, setReplyTo] = useState<DMMessage | null>(null);
  const [activeReactionFor, setActiveReactionFor] = useState<string | null>(null);

  const [imageViewer, setImageViewer] = useState<string | null>(null);
  const [videoViewer, setVideoViewer] = useState<string | null>(null);
  const [audioViewer, setAudioViewer] = useState<string | null>(null);
  const [audioSound, setAudioSound] = useState<any>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);

  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const { data: auth } = await supabase.auth.getUser();
        const me = auth?.user;
        if (!me) {
          router.replace("/(auth)/login" as any);
          return;
        }
        setMeId(me.id);

        const user = await getUserByUsername(handle);
        if (!user) {
          setErr("User not found");
          setOther(null);
          return;
        }

        setOther(user);
        const tid = await getOrCreateThread(user.id);
        setThreadId(tid);
        const msgs = await fetchMessages(tid, 120);
        setMessages(msgs);
        await markRead(tid);
      } catch (e: any) {
        if (mounted) setErr(e?.message || "Failed to open chat");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [handle]);

  useEffect(() => {
    if (!threadId) return;
    const ch = supabase
      .channel(`dm-thread-${threadId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "dm_messages", filter: `thread_id=eq.${threadId}` }, async () => {
        const msgs = await fetchMessages(threadId, 120);
        setMessages(msgs);
        await markRead(threadId);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "dm_messages", filter: `thread_id=eq.${threadId}` }, async () => {
        const msgs = await fetchMessages(threadId, 120);
        setMessages(msgs);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "dm_message_reactions" }, async () => {
        const msgs = await fetchMessages(threadId, 120);
        setMessages(msgs);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [threadId]);

  useEffect(() => {
    return () => {
      if (audioSound) audioSound.unloadAsync();
    };
  }, [audioSound]);

  async function onSend() {
    if (!threadId) return;
    if (!text.trim() && !pendingMedia) return;

    setSending(true);
    try {
      if (pendingMedia) {
        await sendMedia({
          threadId,
          kind: pendingMedia.kind,
          uri: pendingMedia.uri,
          mime_type: pendingMedia.mime_type,
          duration_sec: pendingMedia.duration_sec ?? null,
          body: text.trim() || null,
          reply_to_message_id: replyTo?.id ?? null,
        });
      } else {
        await sendText(threadId, text.trim(), replyTo?.id ?? null);
      }

      setText("");
      setPendingMedia(null);
      setReplyTo(null);
      const msgs = await fetchMessages(threadId, 120);
      setMessages(msgs);
      await markRead(threadId);
    } catch (e: any) {
      setErr(e?.message || "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  async function onPickFromLibrary() {
    if (!threadId) return;
    setErr(null);
    const libPerm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!libPerm.granted) {
      setErr("Media library permission denied");
      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.9,
    });

    if (res.canceled || !res.assets?.[0]?.uri) return;
    const asset = res.assets[0];
    const isVideo = asset.type === "video";
    setPendingMedia({
      kind: isVideo ? "video" : "image",
      uri: asset.uri,
      mime_type: asset.mimeType ?? null,
      duration_sec: asset.duration ? Math.round(asset.duration / 1000) : null,
    });
  }

  async function onPickCameraPhoto() {
    if (!threadId) return;
    setErr(null);
    const camPerm = await ImagePicker.requestCameraPermissionsAsync();
    if (!camPerm.granted) {
      setErr("Camera permission denied");
      return;
    }

    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });

    if (res.canceled || !res.assets?.[0]?.uri) return;
    const asset = res.assets[0];
    setPendingMedia({
      kind: "image",
      uri: asset.uri,
      mime_type: asset.mimeType ?? "image/jpeg",
    });
  }

  async function onPickCameraVideo() {
    if (!threadId) return;
    setErr(null);
    const camPerm = await ImagePicker.requestCameraPermissionsAsync();
    if (!camPerm.granted) {
      setErr("Camera permission denied");
      return;
    }

    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      quality: 1,
    });

    if (res.canceled || !res.assets?.[0]?.uri) return;
    const asset = res.assets[0];
    setPendingMedia({
      kind: "video",
      uri: asset.uri,
      mime_type: asset.mimeType ?? "video/mp4",
      duration_sec: asset.duration ? Math.round(asset.duration / 1000) : null,
    });
  }

  async function toggleRecord() {
    if (!threadId) return;
    if (!Audio) {
      setErr("Audio recording needs a dev build with expo-av.");
      return;
    }
    if (recording) {
      setRecordingBusy(true);
      try {
        await recording.stopAndUnloadAsync();
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
        }).catch(() => undefined);
        const uri = recording.getURI();
        const status = await recording.getStatusAsync();
        setRecording(null);
        if (!uri) throw new Error("Recording failed");
        setPendingMedia({
          kind: "audio",
          uri,
          mime_type: "audio/m4a",
          duration_sec: status?.durationMillis ? Math.round(status.durationMillis / 1000) : null,
        });
      } catch (e: any) {
        setErr(e?.message || "Audio capture failed");
      } finally {
        setRecordingBusy(false);
      }
      return;
    }

    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) throw new Error("Microphone permission denied");
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      setRecording(rec);
    } catch (e: any) {
      setErr(e?.message || "Could not start recording");
    }
  }

  async function onOpenAudio(url: string) {
    if (!Audio) {
      setErr("Audio playback needs a dev build with expo-av.");
      return;
    }
    try {
      if (audioSound) {
        await audioSound.unloadAsync();
      }
      const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true }, (status: any) => {
        if (!status.isLoaded) return;
        setAudioPlaying(status.isPlaying);
      });
      setAudioSound(sound);
      setAudioViewer(url);
      setAudioPlaying(true);
    } catch (e: any) {
      setErr(e?.message || "Audio playback failed");
    }
  }

  async function toggleAudio() {
    if (!audioSound) return;
    const status = await audioSound.getStatusAsync();
    if (!status.isLoaded) return;
    if (status.isPlaying) {
      await audioSound.pauseAsync();
      setAudioPlaying(false);
    } else {
      await audioSound.playAsync();
      setAudioPlaying(true);
    }
  }

  async function closeAudio() {
    if (audioSound) await audioSound.unloadAsync();
    setAudioSound(null);
    setAudioViewer(null);
    setAudioPlaying(false);
  }

  async function onReact(message: DMMessage, emoji: string) {
    if (!message?.id) return;
    const mine = message.reactions?.find((r) => r.user_id === meId);
    try {
      if (mine && mine.emoji === emoji) {
        await removeReaction(message.id);
      } else {
        await reactToMessage(message.id, emoji);
      }
      setActiveReactionFor(null);
      if (threadId) {
        const msgs = await fetchMessages(threadId, 120);
        setMessages(msgs);
      }
    } catch (e: any) {
      setErr(e?.message || "Could not react");
    }
  }

  const title = other?.seller_profile?.active
    ? other?.seller_profile?.business_name || other?.seller_profile?.market_username || "Business"
    : other?.full_name || other?.username || "User";
  const subtitle = other?.seller_profile?.active
    ? `@${other?.seller_profile?.market_username ?? other?.username ?? "seller"}`
    : `@${other?.username ?? "user"}`;

  if (loading) {
    return (
      <LinearGradient colors={[BG1, BG0]} style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <AppHeader title="Chat" />
        <ActivityIndicator />
        <Text style={{ marginTop: 10, color: MUTED }}>Opening chat...</Text>
      </LinearGradient>
    );
  }

  if (err && !threadId) {
    return (
      <LinearGradient colors={[BG1, BG0]} style={{ flex: 1, paddingTop: Math.max(insets.top, 14), paddingHorizontal: 16 }}>
        <AppHeader title="Chat" />
        <View style={{ marginTop: 16, borderRadius: 22, padding: 16, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
          <Text style={{ color: "#fff", fontWeight: "900" }}>Could not open chat</Text>
          <Text style={{ marginTop: 8, color: MUTED }}>{err}</Text>
          <Pressable
            onPress={() => router.back()}
            style={{ marginTop: 12, borderRadius: 18, paddingVertical: 12, alignItems: "center", backgroundColor: PURPLE, borderWidth: 1, borderColor: PURPLE }}
          >
            <Text style={{ color: "#fff", fontWeight: "900" }}>Go back</Text>
          </Pressable>
        </View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={[BG1, BG0]} style={{ flex: 1, paddingTop: Math.max(insets.top, 14) }}>
      <AppHeader title="Chat" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ paddingHorizontal: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <Pressable
              onPress={() => router.back()}
              style={{
                width: 44,
                height: 44,
                borderRadius: 16,
                backgroundColor: CARD,
                borderWidth: 1,
                borderColor: BORDER,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </Pressable>

            <View style={{ flex: 1 }}>
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 18 }} numberOfLines={1}>
                {title}
              </Text>
              <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>{subtitle}</Text>
            </View>
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {messages.length === 0 ? (
            <View style={{ marginTop: 12, borderRadius: 22, padding: 16, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
              <Text style={{ color: "#fff", fontWeight: "900" }}>Start the conversation</Text>
              <Text style={{ marginTop: 6, color: MUTED }}>Send a message, image, video, or voice note.</Text>
            </View>
          ) : null}

          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              mine={isMine(m.sender_id, meId)}
              onViewImage={setImageViewer}
              onViewVideo={setVideoViewer}
              onViewAudio={onOpenAudio}
              onReply={() => setReplyTo(m)}
              onReact={(emoji) => onReact(m, emoji)}
              showReactionPicker={activeReactionFor === m.id}
              setShowReactionPicker={(v) => setActiveReactionFor(v ? m.id : null)}
              meId={meId}
            />
          ))}
        </ScrollView>

        {err ? (
          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <Text style={{ color: "#FCA5A5", fontWeight: "800", fontSize: 12 }}>{err}</Text>
          </View>
        ) : null}

        <View
          style={{
            paddingHorizontal: 16,
            paddingTop: 10,
            paddingBottom: Math.max(insets.bottom, 12),
            borderTopWidth: 1,
            borderTopColor: "rgba(255,255,255,0.08)",
            backgroundColor: "rgba(5,4,11,0.92)",
          }}
        >
          {replyTo ? (
            <View style={{ marginBottom: 8, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.06)", padding: 10, flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ width: 3, height: "100%", backgroundColor: PURPLE, borderRadius: 3 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>Replying</Text>
                <Text numberOfLines={1} style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>
                  {replyTo.body || replyTo.meta?.kind || "Attachment"}
                </Text>
              </View>
              <Pressable onPress={() => setReplyTo(null)}>
                <Ionicons name="close" size={18} color="#fff" />
              </Pressable>
            </View>
          ) : null}

          {pendingMedia ? (
            <View style={{ marginBottom: 8, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.06)", padding: 10, flexDirection: "row", alignItems: "center", gap: 10 }}>
              {pendingMedia.kind === "image" ? (
                <Image source={{ uri: pendingMedia.uri }} style={{ width: 54, height: 54, borderRadius: 8 }} />
              ) : (
                <View style={{ width: 54, height: 54, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name={pendingMedia.kind === "video" ? "videocam-outline" : "mic-outline"} size={20} color="#fff" />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#fff", fontWeight: "900" }}>
                  {pendingMedia.kind === "image" ? "Image" : pendingMedia.kind === "video" ? "Video" : "Audio"}
                </Text>
                <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>Ready to send</Text>
              </View>
              <Pressable onPress={() => setPendingMedia(null)}>
                <Ionicons name="close-circle" size={20} color="#fff" />
              </Pressable>
            </View>
          ) : null}

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Pressable
              onPress={onPickFromLibrary}
              style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: "center", justifyContent: "center" }}
            >
              <Ionicons name="attach" size={18} color="#fff" />
            </Pressable>
            <Pressable
              onPress={onPickCameraPhoto}
              style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: "center", justifyContent: "center" }}
            >
              <Ionicons name="camera-outline" size={18} color="#fff" />
            </Pressable>
            <Pressable
              onPress={onPickCameraVideo}
              style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: "center", justifyContent: "center" }}
            >
              <Ionicons name="videocam-outline" size={18} color="#fff" />
            </Pressable>
            <Pressable
              onPress={toggleRecord}
              disabled={recordingBusy}
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                backgroundColor: recording ? "rgba(239,68,68,0.35)" : CARD,
                borderWidth: 1,
                borderColor: recording ? "rgba(239,68,68,0.65)" : BORDER,
                alignItems: "center",
                justifyContent: "center",
                opacity: recordingBusy ? 0.6 : 1,
              }}
            >
              <Ionicons name={recording ? "stop-circle-outline" : "mic-outline"} size={18} color="#fff" />
            </Pressable>

            <View style={{ flex: 1 }}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Type a message..."
                placeholderTextColor="rgba(255,255,255,0.35)"
                style={{
                  borderRadius: 16,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  color: "#fff",
                  backgroundColor: "rgba(255,255,255,0.06)",
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.10)",
                }}
              />
            </View>

            <Pressable
              onPress={onSend}
              disabled={sending || (!text.trim() && !pendingMedia)}
              style={{
                width: 42,
                height: 42,
                borderRadius: 14,
                backgroundColor: PURPLE,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.2)",
                alignItems: "center",
                justifyContent: "center",
                opacity: sending || (!text.trim() && !pendingMedia) ? 0.6 : 1,
              }}
            >
              {sending ? <ActivityIndicator color="#fff" /> : <Ionicons name="send" size={18} color="#fff" />}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={!!imageViewer} transparent animationType="fade" onRequestClose={() => setImageViewer(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.95)", justifyContent: "center" }}>
          <Pressable onPress={() => setImageViewer(null)} style={{ position: "absolute", top: insets.top + 12, right: 16 }}>
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
          {imageViewer ? <Image source={{ uri: imageViewer }} style={{ width: "100%", height: "80%" }} resizeMode="contain" /> : null}
        </View>
      </Modal>

      <Modal visible={!!videoViewer} transparent animationType="fade" onRequestClose={() => setVideoViewer(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.95)", justifyContent: "center" }}>
          <Pressable onPress={() => setVideoViewer(null)} style={{ position: "absolute", top: insets.top + 12, right: 16 }}>
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
          {videoViewer ? (
            Video ? (
              <Video
                source={{ uri: videoViewer }}
                style={{ width: "100%", height: "60%" }}
                useNativeControls
                resizeMode={ResizeMode.CONTAIN}
              />
            ) : (
              <View style={{ padding: 20, alignItems: "center", gap: 12 }}>
                <Text style={{ color: "#fff", fontWeight: "800" }}>Video player needs a dev build with expo-av.</Text>
                <Pressable
                  onPress={() => Linking.openURL(videoViewer)}
                  style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: "rgba(124,58,237,0.35)" }}
                >
                  <Text style={{ color: "#fff", fontWeight: "900" }}>Open video URL</Text>
                </Pressable>
              </View>
            )
          ) : null}
        </View>
      </Modal>

      <Modal visible={!!audioViewer} transparent animationType="fade" onRequestClose={closeAudio}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.85)", justifyContent: "center", padding: 24 }}>
          <View style={{ borderRadius: 18, padding: 16, backgroundColor: "#0B0F17", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" }}>
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>Audio</Text>
            <Pressable onPress={toggleAudio} style={{ marginTop: 14, paddingVertical: 12, borderRadius: 12, backgroundColor: PURPLE, alignItems: "center" }}>
              <Text style={{ color: "#fff", fontWeight: "900" }}>{audioPlaying ? "Pause" : "Play"}</Text>
            </Pressable>
            <Pressable onPress={closeAudio} style={{ marginTop: 10, paddingVertical: 12, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center" }}>
              <Text style={{ color: "#fff", fontWeight: "900" }}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </LinearGradient>
  );
}

function MessageBubble({
  message,
  mine,
  onViewImage,
  onViewVideo,
  onViewAudio,
  onReply,
  onReact,
  showReactionPicker,
  setShowReactionPicker,
  meId,
}: {
  message: DMMessage;
  mine: boolean;
  onViewImage: (url: string) => void;
  onViewVideo: (url: string) => void;
  onViewAudio: (url: string) => void;
  onReply: () => void;
  onReact: (emoji: string) => void;
  showReactionPicker: boolean;
  setShowReactionPicker: (v: boolean) => void;
  meId: string | null;
}) {
  const attachments = (message.dm_message_attachments ?? []) as DMAttachment[];
  const reactions = message.reactions ?? [];
  const grouped = reactions.reduce<Record<string, number>>((acc, r) => {
    acc[r.emoji] = (acc[r.emoji] || 0) + 1;
    return acc;
  }, {});
  const myReaction = reactions.find((r) => r.user_id === meId)?.emoji ?? null;

  return (
    <Swipeable
      renderLeftActions={() => (
        <View style={{ width: 64, justifyContent: "center", alignItems: "center" }}>
          <Ionicons name="return-down-back" size={18} color="rgba(255,255,255,0.6)" />
        </View>
      )}
      onSwipeableOpen={onReply}
    >
      <View style={{ marginTop: 8, alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "82%" }}>
        {showReactionPicker ? (
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 6, padding: 8, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.35)", alignSelf: mine ? "flex-end" : "flex-start" }}>
            {REACTIONS.map((e) => (
              <Pressable key={e} onPress={() => onReact(e)} style={{ padding: 4 }}>
                <Text style={{ fontSize: 18 }}>{e}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => setShowReactionPicker(false)} style={{ padding: 4 }}>
              <Ionicons name="close" size={16} color="#fff" />
            </Pressable>
          </View>
        ) : null}

        <Pressable
          onLongPress={() => setShowReactionPicker(true)}
          style={{
            padding: 12,
            borderRadius: 16,
            backgroundColor: mine ? "rgba(124,58,237,0.35)" : "rgba(255,255,255,0.08)",
            borderWidth: 1,
            borderColor: mine ? "rgba(124,58,237,0.55)" : "rgba(255,255,255,0.10)",
          }}
        >
          {message.reply_to ? (
            <View style={{ marginBottom: 8, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: PURPLE }}>
              <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 11 }}>
                Replying to {message.reply_to.sender_id === message.sender_id ? "self" : "message"}
              </Text>
              <Text numberOfLines={1} style={{ color: "rgba(255,255,255,0.8)", fontSize: 12 }}>
                {message.reply_to.body || "Attachment"}
              </Text>
            </View>
          ) : null}

          {message.body ? (
            <Text style={{ color: "#fff", fontWeight: "800", lineHeight: 20 }}>{message.body}</Text>
          ) : null}

          {attachments.length > 0 ? (
            <View style={{ marginTop: message.body ? 8 : 0, gap: 8 }}>
              {attachments.map((a) => (
                <AttachmentView key={a.id} attachment={a} onViewImage={onViewImage} onViewVideo={onViewVideo} onViewAudio={onViewAudio} />
              ))}
            </View>
          ) : null}
        </Pressable>

        {Object.keys(grouped).length ? (
          <View style={{ marginTop: 6, flexDirection: "row", gap: 6, alignSelf: mine ? "flex-end" : "flex-start" }}>
            {Object.entries(grouped).map(([emoji, count]) => (
              <View key={emoji} style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text>{emoji}</Text>
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 11 }}>{count}</Text>
                {myReaction === emoji ? <Ionicons name="checkmark" size={12} color="#fff" /> : null}
              </View>
            ))}
          </View>
        ) : null}

        <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.5)", fontSize: 10, textAlign: mine ? "right" : "left" }}>
          {formatTime(message.created_at)}
        </Text>
      </View>
    </Swipeable>
  );
}

function AttachmentView({
  attachment,
  onViewImage,
  onViewVideo,
  onViewAudio,
}: {
  attachment: DMAttachment;
  onViewImage: (url: string) => void;
  onViewVideo: (url: string) => void;
  onViewAudio: (url: string) => void;
}) {
  const url = attachment.public_url || "";

  if (attachment.kind === "image") {
    return (
      <Pressable onPress={() => onViewImage(url)} style={{ borderRadius: 12, overflow: "hidden" }}>
        <Image source={{ uri: url }} style={{ width: 220, height: 160 }} />
      </Pressable>
    );
  }

  if (attachment.kind === "video") {
    return (
      <Pressable onPress={() => onViewVideo(url)} style={{ width: 220, height: 160, borderRadius: 12, overflow: "hidden", backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="play-circle-outline" size={36} color="#fff" />
      </Pressable>
    );
  }

  if (attachment.kind === "audio") {
    return (
      <Pressable onPress={() => onViewAudio(url)} style={{ padding: 10, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.08)", flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="musical-notes-outline" size={18} color="#fff" />
        <Text style={{ color: "#fff", fontWeight: "800" }}>Play audio</Text>
      </Pressable>
    );
  }

  return (
    <View style={{ padding: 10, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.08)" }}>
      <Text style={{ color: "#fff", fontWeight: "800" }}>Attachment</Text>
    </View>
  );
}
