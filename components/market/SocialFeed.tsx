import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OrderPreviewModal, type PreviewPayload } from "@/components/market/OrderPreviewModal";
import { uploadToSupabaseStorage } from "@/services/market/storageUpload";
import { supabase } from "@/services/supabase";

type FeedProfile = {
  user_id: string;
  market_username: string | null;
  display_name: string | null;
  business_name: string | null;
  logo_path: string | null;
  is_verified: boolean | null;
};

type FeedPost = {
  id: string;
  author_id: string;
  body: string | null;
  created_at: string;
};

type FeedMedia = {
  id: string;
  post_id: string;
  kind: "image" | "video" | "audio" | "file";
  storage_path: string;
  public_url: string | null;
  mime_type: string | null;
  sort_order: number | null;
};

type FeedComment = {
  id: string;
  post_id: string;
  user_id: string;
  body: string;
  created_at: string;
  profiles?: { username?: string | null; full_name?: string | null } | null;
};

type LocalAsset = {
  uri: string;
  mimeType: string;
  kind: "image" | "video" | "audio";
};

type Props = {
  profileUserId?: string;
  hideComposer?: boolean;
  mode?: "inline" | "contained";
};

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const BG0 = "#060807";
const BG1 = "#10130E";
const SURFACE = "#0D120F";
const PANEL = "rgba(255,253,247,0.065)";
const PANEL_STRONG = "rgba(255,253,247,0.095)";
const BORDER = "rgba(255,253,247,0.12)";
const BORDER_TOP = "rgba(255,253,247,0.24)";
const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.68)";
const FAINT = "rgba(255,253,247,0.44)";
const TEAL = "#2DD4BF";
const AMBER = "#F4B75D";
const BLUE = "#38BDF8";
const ROSE = "#FB7185";
const INK = "#090D0B";
const SOCIAL_BUCKET = "market-social";

function fileExtFromMime(mime: string) {
  const m = mime.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("heic")) return "heic";
  if (m.includes("mp4")) return "mp4";
  if (m.includes("quicktime")) return "mov";
  if (m.includes("m4a")) return "m4a";
  if (m.includes("aac")) return "aac";
  if (m.includes("mpeg")) return "mp3";
  if (m.includes("wav")) return "wav";
  return "jpg";
}

function pickKind(mime: string): FeedMedia["kind"] {
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "file";
}

function publicUrl(bucket: string, storagePath: string | null, existing: string | null) {
  if (existing) return existing;
  if (!storagePath) return null;
  return supabase.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl;
}

function friendlySocialError(error: unknown, fallback = "Social feed is unavailable right now.") {
  const msg = String((error as any)?.message || error || "").trim();
  if (!msg) return fallback;
  const lower = msg.toLowerCase();
  if (
    lower.includes("does not exist") ||
    lower.includes("schema cache") ||
    lower.includes("row-level security") ||
    lower.includes("policy") ||
    lower.includes("bucket")
  ) {
    return fallback;
  }
  return msg;
}

function formatRelativeTime(dateString: string) {
  const createdAt = new Date(dateString).getTime();
  const diffMs = Date.now() - createdAt;
  if (!Number.isFinite(createdAt) || diffMs < 0) return new Date(dateString).toLocaleDateString();

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;

  if (diffMs < minute) return "now";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h`;
  if (diffMs < week) return `${Math.floor(diffMs / day)}d`;
  if (diffMs < month) return `${Math.floor(diffMs / week)}w`;
  if (diffMs < year) return `${Math.floor(diffMs / month)}mo`;
  return `${Math.floor(diffMs / year)}y`;
}

function formatCount(value: number) {
  if (value < 1000) return String(value);
  if (value < 10_000) return `${(value / 1000).toFixed(1).replace(".0", "")}K`;
  if (value < 1_000_000) return `${Math.floor(value / 1000)}K`;
  return `${(value / 1_000_000).toFixed(1).replace(".0", "")}M`;
}

function getDisplayName(profile?: FeedProfile | null) {
  return profile?.business_name || profile?.display_name || "Seller";
}

function getHandle(profile?: FeedProfile | null) {
  return profile?.market_username || "seller";
}

function getInitial(label: string) {
  return label.trim().charAt(0).toUpperCase() || "S";
}

function mediaIcon(kind: FeedMedia["kind"] | LocalAsset["kind"]): IconName {
  if (kind === "video") return "videocam-outline";
  if (kind === "audio") return "mic-outline";
  if (kind === "file") return "document-outline";
  return "image-outline";
}

function previewTitle(kind: FeedMedia["kind"] | LocalAsset["kind"]) {
  if (kind === "video") return "Video";
  if (kind === "audio") return "Voice note";
  if (kind === "file") return "File";
  return "Image";
}

function buildPreviewPayload(input: {
  uri: string;
  kind: FeedMedia["kind"] | LocalAsset["kind"];
  mimeType?: string | null;
}): PreviewPayload {
  return {
    kind: input.kind,
    title: previewTitle(input.kind),
    access: "final",
    mimeType: input.mimeType ?? null,
    urlPromise: async () => input.uri,
  };
}

function VerifiedMark({ verified }: { verified?: boolean | null }) {
  if (!verified) return null;
  return <Ionicons name="checkmark-circle" size={16} color={BLUE} />;
}

function Avatar({ profile, size = 42 }: { profile?: FeedProfile | null; size?: number }) {
  const name = getDisplayName(profile);
  const avatar = profile?.logo_path
    ? supabase.storage.from("market-sellers").getPublicUrl(profile.logo_path).data.publicUrl
    : null;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,253,247,0.09)",
        borderWidth: 1,
        borderColor: BORDER,
      }}
    >
      {avatar ? (
        <Image source={{ uri: avatar }} style={{ width: size, height: size }} />
      ) : (
        <Text style={{ color: TEXT, fontWeight: "900" }}>{getInitial(name)}</Text>
      )}
    </View>
  );
}

function IconButton({
  icon,
  label,
  onPress,
  active,
  disabled,
  tone = TEAL,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
  tone?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        height: 38,
        minWidth: 38,
        borderRadius: 15,
        paddingHorizontal: label ? 11 : 0,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 7,
        backgroundColor: active ? `${tone}24` : "rgba(255,253,247,0.07)",
        borderWidth: 1,
        borderColor: active ? `${tone}55` : BORDER,
        opacity: disabled ? 0.45 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <Ionicons name={icon} size={17} color={active ? tone : MUTED} />
      {label ? <Text style={{ color: active ? TEXT : MUTED, fontWeight: "900", fontSize: 12 }}>{label}</Text> : null}
    </Pressable>
  );
}

export default function SocialFeed({ profileUserId, hideComposer = false, mode = "inline" }: Props) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isContained = mode === "contained";
  const isWide = width >= 760;
  const mediaHeight = isWide ? 360 : 280;
  const assetSize = isWide ? 92 : 78;

  const [meId, setMeId] = useState<string | null>(null);
  const [selfProfile, setSelfProfile] = useState<FeedProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [body, setBody] = useState("");
  const [assets, setAssets] = useState<LocalAsset[]>([]);
  const [recording, setRecording] = useState<any>(null);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [previewPayload, setPreviewPayload] = useState<PreviewPayload | null>(null);

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [mediaMap, setMediaMap] = useState<Record<string, FeedMedia[]>>({});
  const [profileMap, setProfileMap] = useState<Record<string, FeedProfile>>({});
  const [reactionCounts, setReactionCounts] = useState<Record<string, number>>({});
  const [myLikes, setMyLikes] = useState<Record<string, boolean>>({});
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});

  const [commentsOpenPost, setCommentsOpenPost] = useState<FeedPost | null>(null);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);

  const postingLockRef = useRef(false);
  const pendingPostIdsRef = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data?.user?.id ?? null;
      if (!alive) return;
      setMeId(uid);

      if (uid) {
        const { data: profile } = await supabase
          .from("market_seller_public_profiles")
          .select("user_id,market_username,display_name,business_name,logo_path,is_verified")
          .eq("user_id", uid)
          .maybeSingle();
        if (alive) setSelfProfile((profile as FeedProfile) ?? null);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      const rec = recording;
      if (rec) {
        rec.stopAndUnloadAsync?.().catch(() => undefined);
      }
    };
  }, [recording]);

  const loadProfiles = useCallback(async (authorIds: string[]) => {
    const ids = Array.from(new Set(authorIds.filter(Boolean)));
    if (!ids.length) return {};

    const { data, error: profileErr } = await supabase
      .from("market_seller_public_profiles")
      .select("user_id,market_username,display_name,business_name,logo_path,is_verified")
      .in("user_id", ids);

    if (profileErr) throw profileErr;

    const next: Record<string, FeedProfile> = {};
    ((data ?? []) as FeedProfile[]).forEach((profile) => {
      next[profile.user_id] = profile;
    });
    return next;
  }, []);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from("market_social_posts")
        .select("id,author_id,body,created_at")
        .order("created_at", { ascending: false })
        .limit(80);

      if (profileUserId) query = query.eq("author_id", profileUserId);

      const { data: postRows, error: postErr } = await query;
      if (postErr) throw postErr;

      const feedPosts = (postRows ?? []) as FeedPost[];
      setPosts(feedPosts);

      const postIds = feedPosts.map((post) => post.id);
      const authorIds = Array.from(new Set(feedPosts.map((post) => post.author_id)));

      const [mediaRes, profiles] = await Promise.all([
        postIds.length
          ? supabase
              .from("market_social_media")
              .select("id,post_id,kind,storage_path,public_url,mime_type,sort_order")
              .in("post_id", postIds)
              .order("sort_order", { ascending: true })
          : Promise.resolve({ data: [] } as any),
        loadProfiles(authorIds),
      ]);

      if ((mediaRes as any)?.error) throw (mediaRes as any).error;
      setProfileMap(profiles);

      const nextMediaMap: Record<string, FeedMedia[]> = {};
      ((mediaRes.data ?? []) as FeedMedia[]).forEach((item) => {
        if (!nextMediaMap[item.post_id]) nextMediaMap[item.post_id] = [];
        nextMediaMap[item.post_id].push(item);
      });
      setMediaMap(nextMediaMap);

      if (!postIds.length) {
        setReactionCounts({});
        setMyLikes({});
        setCommentCounts({});
        return;
      }

      const [reactionRes, myReactionRes, commentRes] = await Promise.all([
        supabase.from("market_social_reactions").select("post_id").in("post_id", postIds),
        meId
          ? supabase.from("market_social_reactions").select("post_id").eq("user_id", meId).in("post_id", postIds)
          : Promise.resolve({ data: [] } as any),
        supabase.from("market_social_comments").select("post_id").in("post_id", postIds),
      ]);

      if ((reactionRes as any)?.error) throw (reactionRes as any).error;
      if ((myReactionRes as any)?.error) throw (myReactionRes as any).error;
      if ((commentRes as any)?.error) throw (commentRes as any).error;

      const nextReactionCounts: Record<string, number> = {};
      (reactionRes.data ?? []).forEach((row: any) => {
        const postId = String(row.post_id);
        nextReactionCounts[postId] = (nextReactionCounts[postId] ?? 0) + 1;
      });
      setReactionCounts(nextReactionCounts);

      const nextLikes: Record<string, boolean> = {};
      (myReactionRes.data ?? []).forEach((row: any) => {
        nextLikes[String(row.post_id)] = true;
      });
      setMyLikes(nextLikes);

      const nextCommentCounts: Record<string, number> = {};
      (commentRes.data ?? []).forEach((row: any) => {
        const postId = String(row.post_id);
        nextCommentCounts[postId] = (nextCommentCounts[postId] ?? 0) + 1;
      });
      setCommentCounts(nextCommentCounts);
    } catch (e: any) {
      setError(friendlySocialError(e));
      setPosts([]);
      setMediaMap({});
    } finally {
      setLoading(false);
    }
  }, [loadProfiles, meId, profileUserId]);

  useEffect(() => {
    void fetchPosts();
  }, [fetchPosts]);

  useEffect(() => {
    const ch = supabase
      .channel(`market-social-feed-${profileUserId || "all"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "market_social_posts" }, (payload) => {
        const row = payload.new as any;
        const oldRow = payload.old as any;

        if (payload.eventType === "INSERT" && row?.id) {
          if (pendingPostIdsRef.current.has(String(row.id))) return;
          if (profileUserId && row.author_id !== profileUserId) return;
          setPosts((prev) => (prev.some((post) => post.id === row.id) ? prev : [row as FeedPost, ...prev]));
          void loadProfiles([String(row.author_id)]).then((profiles) =>
            setProfileMap((prev) => ({ ...prev, ...profiles })),
          );
        }

        if (payload.eventType === "DELETE" && oldRow?.id) {
          setPosts((prev) => prev.filter((post) => post.id !== oldRow.id));
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "market_social_media" }, (payload) => {
        const row = (payload.new ?? payload.old) as any;
        const postId = String(row?.post_id || "");
        if (!postId) return;

        setMediaMap((prev) => {
          const current = prev[postId] ?? [];

          if (payload.eventType === "INSERT" && payload.new) {
            const incoming = payload.new as FeedMedia;
            if (current.some((item) => item.id === incoming.id)) return prev;
            return { ...prev, [postId]: [...current, incoming].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) };
          }

          if (payload.eventType === "DELETE" && payload.old) {
            const next = current.filter((item) => item.id !== String(payload.old.id));
            if (!next.length) {
              const trimmed = { ...prev };
              delete trimmed[postId];
              return trimmed;
            }
            return { ...prev, [postId]: next };
          }

          return prev;
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "market_social_reactions" }, (payload) => {
        const row = (payload.new ?? payload.old) as any;
        const postId = String(row?.post_id || "");
        if (!postId) return;
        setReactionCounts((prev) => ({
          ...prev,
          [postId]: Math.max(0, (prev[postId] ?? 0) + (payload.eventType === "DELETE" ? -1 : 1)),
        }));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "market_social_comments" }, (payload) => {
        const row = (payload.new ?? payload.old) as any;
        const postId = String(row?.post_id || "");
        if (!postId) return;
        setCommentCounts((prev) => ({
          ...prev,
          [postId]: Math.max(0, (prev[postId] ?? 0) + (payload.eventType === "DELETE" ? -1 : 1)),
        }));
        if (commentsOpenPost?.id === postId) void loadComments(postId);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [commentsOpenPost?.id, loadProfiles, profileUserId]);

  async function chooseMedia() {
    if (assets.length >= 4) {
      setError("Remove an attachment before adding another.");
      return;
    }

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError("Allow photo access to attach media.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      selectionLimit: Math.max(1, 4 - assets.length),
      quality: 0.88,
    });

    if (result.canceled) return;

    const next = (result.assets ?? [])
      .filter((item) => !!item.uri)
      .map((item) => {
        const mime = item.mimeType || (item.type === "video" ? "video/mp4" : "image/jpeg");
        return {
          uri: item.uri,
          mimeType: mime,
          kind: item.type === "video" ? "video" : "image",
        } as LocalAsset;
      });

    setAssets((prev) => [...prev, ...next].slice(0, 4));
  }

  async function toggleRecording() {
    if (recordingBusy) return;
    if (assets.length >= 4 && !recording) {
      setError("Remove an attachment before recording.");
      return;
    }

    setRecordingBusy(true);
    setError(null);

    try {
      const mod = await import("expo-av");
      const Audio = mod.Audio;

      if (recording) {
        await recording.stopAndUnloadAsync();
        const uri = recording.getURI?.();
        setRecording(null);
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => undefined);
        if (uri) {
          const audioAsset: LocalAsset = { uri, mimeType: "audio/m4a", kind: "audio" };
          setAssets((prev) => [...prev, audioAsset].slice(0, 4));
        }
        return;
      }

      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        setError("Allow microphone access to record.");
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setRecording(rec);
    } catch (e: any) {
      setRecording(null);
      setError(friendlySocialError(e, "Voice recording is unavailable on this device."));
    } finally {
      setRecordingBusy(false);
    }
  }

  async function uploadAsset(userId: string, postId: string, asset: LocalAsset, index: number): Promise<FeedMedia> {
    const ext = fileExtFromMime(asset.mimeType);
    const path = `${userId}/${postId}/${Date.now()}-${index}.${ext}`;
    const { publicUrl: uploadedUrl } = await uploadToSupabaseStorage({
      bucket: SOCIAL_BUCKET,
      path,
      localUri: asset.uri,
      contentType: asset.mimeType,
      upsert: false,
    });

    const { data, error: mediaErr } = await supabase
      .from("market_social_media")
      .insert({
        post_id: postId,
        kind: pickKind(asset.mimeType),
        storage_path: path,
        public_url: uploadedUrl,
        mime_type: asset.mimeType,
        sort_order: index,
      })
      .select("id,post_id,kind,storage_path,public_url,mime_type,sort_order")
      .single();

    if (mediaErr) throw mediaErr;
    return data as FeedMedia;
  }

  async function submitPost() {
    const cleanBody = body.trim();
    if (!cleanBody && !assets.length) return;
    if (!meId) {
      setError("Sign in to post.");
      return;
    }
    if (postingLockRef.current) return;

    postingLockRef.current = true;
    setPosting(true);
    setError(null);

    try {
      const { data, error: postErr } = await supabase
        .from("market_social_posts")
        .insert({ author_id: meId, body: cleanBody || null })
        .select("id,author_id,body,created_at")
        .single();

      if (postErr) throw postErr;

      const created = data as FeedPost;
      pendingPostIdsRef.current.add(created.id);
      setPosts((prev) => [created, ...prev.filter((post) => post.id !== created.id)]);
      setProfileMap((prev) => (selfProfile ? { ...prev, [selfProfile.user_id]: selfProfile } : prev));

      const uploaded: FeedMedia[] = [];
      const failed: string[] = [];
      for (let index = 0; index < assets.length; index += 1) {
        try {
          uploaded.push(await uploadAsset(meId, created.id, assets[index], index));
        } catch (e: any) {
          failed.push(String(e?.message || "Upload failed"));
        }
      }

      if (uploaded.length) setMediaMap((prev) => ({ ...prev, [created.id]: uploaded }));
      pendingPostIdsRef.current.delete(created.id);
      setBody("");
      setAssets([]);

      if (failed.length) {
        setError(
          uploaded.length || cleanBody
            ? `Post published, but ${failed.length} attachment${failed.length === 1 ? "" : "s"} failed.`
            : "Attachment upload failed.",
        );
      }
    } catch (e: any) {
      setError(friendlySocialError(e, "Could not publish post."));
    } finally {
      postingLockRef.current = false;
      setPosting(false);
    }
  }

  async function toggleLike(postId: string) {
    if (!meId) {
      setError("Sign in to react.");
      return;
    }

    const liked = !!myLikes[postId];
    setMyLikes((prev) => ({ ...prev, [postId]: !liked }));
    setReactionCounts((prev) => ({
      ...prev,
      [postId]: Math.max(0, (prev[postId] ?? 0) + (liked ? -1 : 1)),
    }));

    try {
      if (liked) {
        await supabase.from("market_social_reactions").delete().eq("post_id", postId).eq("user_id", meId);
      } else {
        await supabase
          .from("market_social_reactions")
          .upsert({ post_id: postId, user_id: meId, reaction: "like" }, { onConflict: "post_id,user_id" });
      }
    } catch {
      setMyLikes((prev) => ({ ...prev, [postId]: liked }));
      setReactionCounts((prev) => ({
        ...prev,
        [postId]: Math.max(0, (prev[postId] ?? 0) + (liked ? 1 : -1)),
      }));
    }
  }

  async function loadComments(postId: string) {
    const { data, error: commentErr } = await supabase
      .from("market_social_comments")
      .select("id,post_id,user_id,body,created_at")
      .eq("post_id", postId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (commentErr) throw commentErr;

    const rows = (data ?? []) as FeedComment[];
    setComments(rows);

    const commenterIds = rows.map((comment) => comment.user_id).filter((userId) => !profileMap[userId]);
    if (commenterIds.length) {
      const profiles = await loadProfiles(commenterIds);
      setProfileMap((prev) => ({ ...prev, ...profiles }));
    }
  }

  async function openComments(post: FeedPost) {
    setCommentsOpenPost(post);
    setCommentText("");
    try {
      await loadComments(post.id);
    } catch (e) {
      setError(friendlySocialError(e, "Could not load comments."));
    }
  }

  async function submitComment() {
    if (!commentsOpenPost || !meId) return;
    const text = commentText.trim();
    if (!text) return;

    setCommentBusy(true);
    try {
      const { data, error: insertErr } = await supabase
        .from("market_social_comments")
        .insert({ post_id: commentsOpenPost.id, user_id: meId, body: text })
        .select("id,post_id,user_id,body,created_at")
        .single();
      if (insertErr) throw insertErr;

      if (data) setComments((prev) => [data as FeedComment, ...prev]);
      setCommentCounts((prev) => ({ ...prev, [commentsOpenPost.id]: (prev[commentsOpenPost.id] ?? 0) + 1 }));
      setCommentText("");
    } catch (e) {
      setError(friendlySocialError(e, "Could not post comment."));
    } finally {
      setCommentBusy(false);
    }
  }

  function openMediaPreview(media: FeedMedia) {
    const uri = publicUrl(SOCIAL_BUCKET, media.storage_path, media.public_url);
    if (!uri) return;
    setPreviewPayload(buildPreviewPayload({ uri, mimeType: media.mime_type, kind: media.kind }));
  }

  function openLocalPreview(asset: LocalAsset) {
    setPreviewPayload(buildPreviewPayload({ uri: asset.uri, mimeType: asset.mimeType, kind: asset.kind }));
  }

  function renderMediaTile(media: FeedMedia, height: number, overlayText?: string) {
    const uri = publicUrl(SOCIAL_BUCKET, media.storage_path, media.public_url);
    const isImage = media.kind === "image";

    return (
      <Pressable key={media.id} disabled={!uri} onPress={() => openMediaPreview(media)} style={{ flex: 1 }}>
        <View
          style={{
            height,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: BORDER,
            backgroundColor: "rgba(255,253,247,0.06)",
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {isImage && uri ? (
            <Image source={{ uri }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
          ) : (
            <View style={{ alignItems: "center", justifyContent: "center", paddingHorizontal: 14 }}>
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 20,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: media.kind === "audio" ? `${AMBER}24` : `${TEAL}20`,
                  borderWidth: 1,
                  borderColor: media.kind === "audio" ? `${AMBER}50` : `${TEAL}46`,
                }}
              >
                <Ionicons name={mediaIcon(media.kind)} size={23} color={media.kind === "audio" ? AMBER : TEAL} />
              </View>
              <Text style={{ marginTop: 9, color: TEXT, fontWeight: "900", fontSize: 13 }}>
                {previewTitle(media.kind)}
              </Text>
            </View>
          )}

          {overlayText ? (
            <View
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(9,13,11,0.62)",
              }}
            >
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 28 }}>{overlayText}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>
    );
  }

  function renderMediaGrid(media: FeedMedia[]) {
    const visible = media.slice(0, 4);
    const remainder = media.length - visible.length;
    if (!visible.length) return null;

    if (visible.length === 1) return renderMediaTile(visible[0], mediaHeight, remainder ? `+${remainder}` : undefined);

    if (visible.length === 2) {
      return (
        <View style={{ flexDirection: "row", gap: 8 }}>
          {visible.map((item, index) => renderMediaTile(item, isWide ? 260 : 190, index === 1 && remainder ? `+${remainder}` : undefined))}
        </View>
      );
    }

    return (
      <View style={{ gap: 8 }}>
        {renderMediaTile(visible[0], isWide ? 250 : 190)}
        <View style={{ flexDirection: "row", gap: 8 }}>
          {visible.slice(1).map((item, index) =>
            renderMediaTile(item, isWide ? 150 : 116, index === visible.slice(1).length - 1 && remainder ? `+${remainder}` : undefined),
          )}
        </View>
      </View>
    );
  }

  function renderComposer() {
    if (hideComposer) return null;

    const canPost = !!body.trim() || assets.length > 0;

    if (!meId) {
      return (
        <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: BORDER, backgroundColor: SURFACE }}>
          <Text style={{ color: TEXT, fontWeight: "900" }}>Sign in to post</Text>
          <Text style={{ marginTop: 5, color: MUTED, lineHeight: 18 }}>
            You can browse updates now. Sign in when you want to publish or comment.
          </Text>
        </View>
      );
    }

    return (
      <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: BORDER, backgroundColor: SURFACE }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
          <Avatar profile={selfProfile} size={44} />

          <View style={{ flex: 1, minWidth: 0 }}>
            <TextInput
              value={body}
              onChangeText={setBody}
              multiline
              placeholder="Share an update..."
              placeholderTextColor={FAINT}
              textAlignVertical="top"
              style={{
                minHeight: 62,
                color: TEXT,
                fontSize: 16,
                lineHeight: 23,
                paddingHorizontal: 0,
                paddingVertical: 4,
              }}
            />

            {assets.length ? (
              <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
                {assets.map((asset, index) => (
                  <Pressable key={`${asset.uri}-${index}`} onPress={() => openLocalPreview(asset)}>
                    <View
                      style={{
                        width: assetSize,
                        height: assetSize,
                        borderRadius: 18,
                        overflow: "hidden",
                        borderWidth: 1,
                        borderColor: BORDER,
                        backgroundColor: PANEL_STRONG,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {asset.kind === "image" ? (
                        <Image source={{ uri: asset.uri }} style={{ width: assetSize, height: assetSize }} />
                      ) : (
                        <View style={{ alignItems: "center", justifyContent: "center" }}>
                          <Ionicons name={mediaIcon(asset.kind)} size={24} color={asset.kind === "audio" ? AMBER : TEAL} />
                          <Text style={{ marginTop: 6, color: MUTED, fontSize: 11, fontWeight: "800" }}>
                            {asset.kind === "audio" ? "Voice" : "Video"}
                          </Text>
                        </View>
                      )}

                      <Pressable
                        onPress={() => setAssets((prev) => prev.filter((_, assetIndex) => assetIndex !== index))}
                        style={{
                          position: "absolute",
                          top: 6,
                          right: 6,
                          width: 24,
                          height: 24,
                          borderRadius: 12,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: "rgba(0,0,0,0.72)",
                        }}
                      >
                        <Ionicons name="close" size={14} color={TEXT} />
                      </Pressable>
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <View
              style={{
                marginTop: 12,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <IconButton icon="image-outline" label="" onPress={chooseMedia} disabled={posting} tone={TEAL} />
                <IconButton
                  icon={recording ? "stop-circle-outline" : "mic-outline"}
                  label=""
                  onPress={toggleRecording}
                  active={!!recording}
                  disabled={posting || recordingBusy}
                  tone={recording ? ROSE : AMBER}
                />
                <Text style={{ color: FAINT, fontSize: 12 }}>{assets.length}/4</Text>
              </View>

              <Pressable
                disabled={posting || !canPost}
                onPress={submitPost}
                style={({ pressed }) => ({
                  minWidth: 92,
                  height: 40,
                  borderRadius: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: posting || !canPost ? "rgba(255,253,247,0.14)" : TEAL,
                  opacity: posting || !canPost ? 0.7 : 1,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                })}
              >
                {posting ? (
                  <ActivityIndicator color={TEXT} />
                ) : (
                  <Text style={{ color: canPost ? INK : MUTED, fontWeight: "900" }}>Post</Text>
                )}
              </Pressable>
            </View>

            {recording ? <Text style={{ marginTop: 8, color: ROSE, fontWeight: "900", fontSize: 12 }}>Recording...</Text> : null}
            {error ? <Text style={{ marginTop: 8, color: ROSE, fontSize: 12, lineHeight: 17 }}>{error}</Text> : null}
          </View>
        </View>
      </View>
    );
  }

  function renderPost(post: FeedPost) {
    const author = profileMap[post.author_id];
    const media = mediaMap[post.id] ?? [];
    const liked = !!myLikes[post.id];
    const authorName = getDisplayName(author);
    const authorHandle = getHandle(author);

    return (
      <View
        style={{
          padding: 14,
          borderBottomWidth: 1,
          borderBottomColor: BORDER,
          backgroundColor: SURFACE,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
          <Avatar profile={author} size={44} />

          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Pressable
                disabled={!author?.market_username}
                onPress={() => author?.market_username && router.push(`/market/profile/${author.market_username}` as any)}
                style={{ flexDirection: "row", alignItems: "center", gap: 5, flex: 1, minWidth: 0 }}
              >
                <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 15, flexShrink: 1 }}>
                  {authorName}
                </Text>
                <VerifiedMark verified={author?.is_verified} />
              </Pressable>
              <Text style={{ color: FAINT, fontSize: 12 }}>{formatRelativeTime(post.created_at)}</Text>
            </View>
            <Text numberOfLines={1} style={{ marginTop: 2, color: MUTED, fontSize: 12 }}>
              @{authorHandle}
            </Text>

            {post.body ? (
              <Text style={{ marginTop: 9, color: TEXT, fontSize: 15, lineHeight: 22 }}>{post.body}</Text>
            ) : null}

            {media.length ? <View style={{ marginTop: 12 }}>{renderMediaGrid(media)}</View> : null}

            <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <IconButton
                icon={liked ? "heart" : "heart-outline"}
                label={reactionCounts[post.id] ? formatCount(reactionCounts[post.id]) : "Like"}
                onPress={() => toggleLike(post.id)}
                active={liked}
                tone={ROSE}
              />
              <IconButton
                icon="chatbubble-outline"
                label={commentCounts[post.id] ? formatCount(commentCounts[post.id]) : "Comment"}
                onPress={() => openComments(post)}
                tone={BLUE}
              />
              {media.length ? (
                <IconButton
                  icon="expand-outline"
                  label="Open"
                  onPress={() => openMediaPreview(media[0])}
                  tone={TEAL}
                />
              ) : null}
            </View>
          </View>
        </View>
      </View>
    );
  }

  function renderLoadingState() {
    return (
      <View style={{ paddingVertical: 28, alignItems: "center", backgroundColor: SURFACE }}>
        <ActivityIndicator color={TEAL} />
        <Text style={{ marginTop: 10, color: MUTED }}>Loading feed...</Text>
      </View>
    );
  }

  function renderEmptyState() {
    return (
      <View style={{ padding: 14, backgroundColor: SURFACE }}>
        <View
          style={{
            borderRadius: 22,
            borderWidth: 1,
            borderColor: BORDER,
            backgroundColor: PANEL,
            padding: 16,
          }}
        >
          <Ionicons name="chatbubbles-outline" size={22} color={TEAL} />
          <Text style={{ marginTop: 10, color: TEXT, fontWeight: "900", fontSize: 17 }}>
            {profileUserId ? "No posts yet" : "No updates yet"}
          </Text>
          <Text style={{ marginTop: 6, color: MUTED, lineHeight: 19 }}>
            {profileUserId ? "This seller has not posted yet." : "Seller updates will appear here."}
          </Text>
        </View>
      </View>
    );
  }

  function renderContainedHeader() {
    return (
      <View style={{ backgroundColor: SURFACE }}>
        <View
          style={{
            paddingTop: Math.max(insets.top, 14),
            paddingHorizontal: 16,
            paddingBottom: 12,
            borderBottomWidth: 1,
            borderBottomColor: BORDER,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: TEXT, fontWeight: "900", fontSize: 20 }}>Social Feed</Text>
            <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>
              {profileUserId ? "Seller updates" : "Marketplace updates"}
            </Text>
          </View>
          <IconButton icon="refresh" label="" onPress={fetchPosts} tone={TEAL} />
        </View>
        {renderComposer()}
      </View>
    );
  }

  function renderInlineContent() {
    return (
      <View
        style={{
          marginTop: 12,
          borderRadius: 24,
          borderWidth: 1,
          borderColor: BORDER,
          backgroundColor: SURFACE,
          overflow: "hidden",
        }}
      >
        {renderComposer()}
        {loading ? renderLoadingState() : posts.length ? posts.map((post) => <React.Fragment key={post.id}>{renderPost(post)}</React.Fragment>) : renderEmptyState()}
      </View>
    );
  }

  function renderContainedContent() {
    return (
      <View style={{ flex: 1, backgroundColor: BG0 }}>
        <FlatList
          data={posts}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => renderPost(item)}
          ListHeaderComponent={renderContainedHeader()}
          ListEmptyComponent={!loading ? renderEmptyState() : null}
          ListFooterComponent={
            loading && posts.length ? renderLoadingState() : <View style={{ height: Math.max(20, insets.bottom + 12) }} />
          }
          refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchPosts} tintColor={TEAL} />}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ backgroundColor: BG0 }}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: isContained ? 1 : 0, width: "100%", backgroundColor: isContained ? BG0 : "transparent" }}>
      {isContained ? renderContainedContent() : renderInlineContent()}

      <OrderPreviewModal open={!!previewPayload} onClose={() => setPreviewPayload(null)} payload={previewPayload} />

      <Modal visible={!!commentsOpenPost} transparent animationType="fade" onRequestClose={() => setCommentsOpenPost(null)}>
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(2,6,4,0.72)",
            alignItems: "center",
            justifyContent: isWide ? "center" : "flex-end",
            padding: 16,
          }}
        >
          <View
            style={{
              width: "100%",
              maxWidth: 680,
              maxHeight: isWide ? "82%" : "90%",
              borderRadius: 26,
              borderWidth: 1,
              borderColor: BORDER_TOP,
              backgroundColor: BG1,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                paddingHorizontal: 16,
                paddingVertical: 14,
                borderBottomWidth: 1,
                borderBottomColor: BORDER,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <View>
                <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>Comments</Text>
                <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>{comments.length} visible</Text>
              </View>
              <Pressable onPress={() => setCommentsOpenPost(null)} style={{ padding: 8 }}>
                <Ionicons name="close" size={22} color={TEXT} />
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 14, gap: 10 }}>
              {comments.length === 0 ? (
                <View style={{ borderRadius: 20, borderWidth: 1, borderColor: BORDER, backgroundColor: PANEL, padding: 14 }}>
                  <Text style={{ color: TEXT, fontWeight: "900" }}>No comments yet</Text>
                  <Text style={{ marginTop: 5, color: MUTED }}>Start the conversation.</Text>
                </View>
              ) : (
                comments.map((comment) => {
                  const commenter = profileMap[comment.user_id];
                  const commentName = commenter?.market_username
                    ? `@${commenter.market_username}`
                    : commenter
                    ? getDisplayName(commenter)
                    : "User";

                  return (
                    <View
                      key={comment.id}
                      style={{
                        borderRadius: 20,
                        borderWidth: 1,
                        borderColor: BORDER,
                        backgroundColor: PANEL,
                        padding: 14,
                      }}
                    >
                      <Text style={{ color: TEXT, fontWeight: "900" }}>{commentName}</Text>
                      <Text style={{ marginTop: 6, color: TEXT, lineHeight: 20 }}>{comment.body}</Text>
                      <Text style={{ marginTop: 6, color: FAINT, fontSize: 11 }}>
                        {new Date(comment.created_at).toLocaleString()}
                      </Text>
                    </View>
                  );
                })
              )}
            </ScrollView>

            <View
              style={{
                padding: 14,
                borderTopWidth: 1,
                borderTopColor: BORDER,
                flexDirection: "row",
                alignItems: "flex-end",
                gap: 10,
              }}
            >
              <TextInput
                value={commentText}
                onChangeText={setCommentText}
                placeholder="Write a comment..."
                placeholderTextColor={FAINT}
                multiline
                style={{
                  flex: 1,
                  minHeight: 46,
                  maxHeight: 118,
                  borderRadius: 17,
                  borderWidth: 1,
                  borderColor: BORDER,
                  backgroundColor: "rgba(255,253,247,0.06)",
                  color: TEXT,
                  paddingHorizontal: 13,
                  paddingVertical: 11,
                }}
              />
              <Pressable
                disabled={commentBusy || !commentText.trim()}
                onPress={submitComment}
                style={({ pressed }) => ({
                  width: 48,
                  height: 48,
                  borderRadius: 17,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: commentText.trim() ? TEAL : "rgba(255,253,247,0.12)",
                  opacity: commentBusy || !commentText.trim() ? 0.65 : 1,
                  transform: [{ scale: pressed ? 0.96 : 1 }],
                })}
              >
                {commentBusy ? <ActivityIndicator color={TEXT} /> : <Ionicons name="send" size={17} color={commentText.trim() ? INK : MUTED} />}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
