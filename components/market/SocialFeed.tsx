import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
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
import MarketMenuModal from "@/components/market/MarketMenuModal";
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
  focusPostId?: string;
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
const FEED_BODY_INITIAL_LIMIT = 320;
const FEED_BODY_WIDE_INITIAL_LIMIT = 520;
const FEED_BODY_STEP = 620;
const FEED_BODY_WIDE_STEP = 900;

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
    lower.includes("bucket") ||
    lower.includes("abort") ||
    lower.includes("signal")
  ) {
    return "Upload timed out or was interrupted. Try again with a smaller file or check your connection.";
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

function truncateBodyPreview(body: string, limit: number) {
  if (body.length <= limit) return body;
  const slice = body.slice(0, limit);
  const breakAt = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("\n"));
  const cutAt = breakAt > Math.floor(limit * 0.72) ? breakAt : limit;
  return `${slice.slice(0, cutAt).trimEnd()}...`;
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

export default function SocialFeed({ profileUserId, hideComposer = false, mode = "inline", focusPostId }: Props) {
  const { width, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const activePostId = String(focusPostId || "").trim();
  const isDetail = !!activePostId;
  const isContained = mode === "contained";
  const isDesktop = width >= 1024;
  const isWide = width >= 760;
  const showDesktopRail = isContained && isDesktop && !profileUserId && !isDetail;
  const feedMaxWidth = isDetail ? 820 : profileUserId ? 720 : showDesktopRail ? 820 : 700;
  const shellMaxWidth = showDesktopRail ? 1200 : feedMaxWidth;
  const sideRailWidth = 300;
  const cardRadius = isWide ? 24 : 20;
  const contentGutter = isContained ? (isDesktop ? 18 : 12) : 0;
  const postGap = isContained ? 14 : 12;
  const mediaHeight = isDesktop ? 390 : isWide ? 340 : 260;
  const assetSize = isWide ? 92 : 78;
  const galleryViewportWidth = Math.max(280, Math.min(width - 24, isDesktop ? 980 : width - 16));
  const galleryMediaHeight = Math.max(300, Math.min(windowHeight - 230, isDesktop ? 650 : Math.max(340, width * 1.08)));

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
  const [galleryMedia, setGalleryMedia] = useState<FeedMedia[]>([]);
  const [galleryIndex, setGalleryIndex] = useState(0);

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [mediaMap, setMediaMap] = useState<Record<string, FeedMedia[]>>({});
  const [profileMap, setProfileMap] = useState<Record<string, FeedProfile>>({});
  const [reactionCounts, setReactionCounts] = useState<Record<string, number>>({});
  const [myLikes, setMyLikes] = useState<Record<string, boolean>>({});
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [expandedBodySteps, setExpandedBodySteps] = useState<Record<string, number>>({});

  const [commentsOpenPost, setCommentsOpenPost] = useState<FeedPost | null>(null);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const postingLockRef = useRef(false);
  const pendingPostIdsRef = useRef(new Set<string>());
  const galleryScrollRef = useRef<ScrollView>(null);
  const feedColumnStyle = { width: "100%" as const, maxWidth: feedMaxWidth, alignSelf: "center" as const };
  const cardShadow = isWide
    ? {
        shadowColor: "#000",
        shadowOpacity: 0.18,
        shadowRadius: 22,
        shadowOffset: { width: 0, height: 12 },
        elevation: 4,
      }
    : {};

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
        .order("created_at", { ascending: false });

      if (activePostId) {
        query = query.eq("id", activePostId).limit(1);
      } else {
        if (profileUserId) query = query.eq("author_id", profileUserId);
        query = query.limit(80);
      }

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
  }, [activePostId, loadProfiles, meId, profileUserId]);

  const loadComments = useCallback(
    async (postId: string) => {
      const { data, error: commentErr } = await supabase
        .from("market_social_comments")
        .select("id,post_id,user_id,body,created_at")
        .eq("post_id", postId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (commentErr) throw commentErr;

      const rows = (data ?? []) as FeedComment[];
      setComments(rows);

      const commenterIds = Array.from(new Set(rows.map((comment) => comment.user_id).filter(Boolean)));
      if (commenterIds.length) {
        const profiles = await loadProfiles(commenterIds);
        setProfileMap((prev) => ({ ...prev, ...profiles }));
      }
    },
    [loadProfiles],
  );

  useEffect(() => {
    void fetchPosts();
  }, [fetchPosts]);

  useEffect(() => {
    if (!galleryMedia.length) return;
    requestAnimationFrame(() => {
      galleryScrollRef.current?.scrollTo({ x: galleryViewportWidth * galleryIndex, animated: false });
    });
  }, [galleryIndex, galleryMedia.length, galleryViewportWidth]);

  useEffect(() => {
    if (!isDetail || loading) return;

    const detailPost = posts.find((post) => post.id === activePostId);
    if (!detailPost) {
      setComments([]);
      return;
    }

    void loadComments(detailPost.id).catch((e) => {
      setError(friendlySocialError(e, "Could not load comments."));
    });
  }, [activePostId, isDetail, loadComments, loading, posts]);

  useEffect(() => {
    const ch = supabase
      .channel(`market-social-feed-${activePostId || profileUserId || "all"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "market_social_posts" }, (payload) => {
        const row = payload.new as any;
        const oldRow = payload.old as any;

        if ((payload.eventType === "INSERT" || payload.eventType === "UPDATE") && row?.id) {
          if (pendingPostIdsRef.current.has(String(row.id))) return;
          if (activePostId && row.id !== activePostId) return;
          if (profileUserId && row.author_id !== profileUserId) return;
          setPosts((prev) =>
            prev.some((post) => post.id === row.id)
              ? prev.map((post) => (post.id === row.id ? (row as FeedPost) : post))
              : [row as FeedPost, ...prev],
          );
          void loadProfiles([String(row.author_id)]).then((profiles) =>
            setProfileMap((prev) => ({ ...prev, ...profiles })),
          );
        }

        if (payload.eventType === "DELETE" && oldRow?.id) {
          if (activePostId && oldRow.id !== activePostId) return;
          setPosts((prev) => prev.filter((post) => post.id !== oldRow.id));
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "market_social_media" }, (payload) => {
        const row = (payload.new ?? payload.old) as any;
        const postId = String(row?.post_id || "");
        if (!postId) return;
        if (activePostId && postId !== activePostId) return;

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
        if (activePostId && postId !== activePostId) return;
        setReactionCounts((prev) => ({
          ...prev,
          [postId]: Math.max(0, (prev[postId] ?? 0) + (payload.eventType === "DELETE" ? -1 : 1)),
        }));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "market_social_comments" }, (payload) => {
        const row = (payload.new ?? payload.old) as any;
        const postId = String(row?.post_id || "");
        if (!postId) return;
        if (activePostId && postId !== activePostId) return;
        setCommentCounts((prev) => ({
          ...prev,
          [postId]: Math.max(0, (prev[postId] ?? 0) + (payload.eventType === "DELETE" ? -1 : 1)),
        }));
        if (commentsOpenPost?.id === postId || activePostId === postId) void loadComments(postId);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [activePostId, commentsOpenPost?.id, loadComments, loadProfiles, profileUserId]);

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
    const targetPost = commentsOpenPost ?? (activePostId ? posts.find((post) => post.id === activePostId) ?? null : null);
    if (!targetPost || !meId) return;
    const text = commentText.trim();
    if (!text) return;

    setCommentBusy(true);
    try {
      const { data, error: insertErr } = await supabase
        .from("market_social_comments")
        .insert({ post_id: targetPost.id, user_id: meId, body: text })
        .select("id,post_id,user_id,body,created_at")
        .single();
      if (insertErr) throw insertErr;

      if (data) setComments((prev) => [data as FeedComment, ...prev]);
      setCommentCounts((prev) => ({ ...prev, [targetPost.id]: (prev[targetPost.id] ?? 0) + 1 }));
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

  function openMediaGallery(media: FeedMedia, collection: FeedMedia[]) {
    const available = collection.filter((item) => publicUrl(SOCIAL_BUCKET, item.storage_path, item.public_url));
    if (!available.length) return;

    const nextIndex = Math.max(0, available.findIndex((item) => item.id === media.id));
    setGalleryMedia(available);
    setGalleryIndex(nextIndex);
    requestAnimationFrame(() => {
      galleryScrollRef.current?.scrollTo({ x: galleryViewportWidth * nextIndex, animated: false });
    });
  }

  function closeMediaGallery() {
    setGalleryMedia([]);
    setGalleryIndex(0);
  }

  function goToGalleryIndex(nextIndex: number) {
    if (!galleryMedia.length) return;
    const bounded = Math.max(0, Math.min(galleryMedia.length - 1, nextIndex));
    setGalleryIndex(bounded);
    requestAnimationFrame(() => {
      galleryScrollRef.current?.scrollTo({ x: galleryViewportWidth * bounded, animated: true });
    });
  }

  function openLocalPreview(asset: LocalAsset) {
    setPreviewPayload(buildPreviewPayload({ uri: asset.uri, mimeType: asset.mimeType, kind: asset.kind }));
  }

  function openPostDetail(postId: string) {
    if (!postId || isDetail) return;
    router.push(`/market/social/${postId}` as any);
  }

  function expandPostBody(postId: string) {
    setExpandedBodySteps((prev) => ({ ...prev, [postId]: (prev[postId] ?? 0) + 1 }));
  }

  function collapsePostBody(postId: string) {
    setExpandedBodySteps((prev) => {
      const next = { ...prev };
      delete next[postId];
      return next;
    });
  }

  function renderMediaTile(media: FeedMedia, height: number, collection: FeedMedia[], overlayText?: string) {
    const uri = publicUrl(SOCIAL_BUCKET, media.storage_path, media.public_url);
    const isImage = media.kind === "image";

    return (
      <Pressable key={media.id} disabled={!uri} onPress={() => openMediaGallery(media, collection)} style={{ flex: 1, minWidth: 0 }}>
        <View
          style={{
            height,
            borderRadius: Math.max(16, cardRadius - 5),
            borderWidth: 1,
            borderColor: "rgba(255,253,247,0.16)",
            backgroundColor: "rgba(6,8,7,0.76)",
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
              <Text style={{ marginTop: 4, color: "rgba(255,253,247,0.74)", fontWeight: "800", fontSize: 11 }}>
                View all
              </Text>
            </View>
          ) : null}

          {collection.length > 1 && !overlayText ? (
            <View
              style={{
                position: "absolute",
                right: 9,
                top: 9,
                borderRadius: 999,
                paddingHorizontal: 8,
                paddingVertical: 5,
                backgroundColor: "rgba(6,8,7,0.72)",
                borderWidth: 1,
                borderColor: "rgba(255,253,247,0.16)",
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Ionicons name="images-outline" size={12} color={TEXT} />
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 11 }}>{collection.length}</Text>
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

    if (visible.length === 1) return renderMediaTile(visible[0], mediaHeight, media, remainder ? `+${remainder}` : undefined);

    if (visible.length === 2) {
      return (
        <View style={{ flexDirection: "row", gap: 8 }}>
          {visible.map((item, index) =>
            renderMediaTile(item, isDesktop ? 280 : isWide ? 240 : 176, media, index === 1 && remainder ? `+${remainder}` : undefined),
          )}
        </View>
      );
    }

    return (
      <View style={{ gap: 8 }}>
        {renderMediaTile(visible[0], isDesktop ? 270 : isWide ? 236 : 176, media)}
        <View style={{ flexDirection: "row", gap: 8 }}>
          {visible.slice(1).map((item, index) =>
            renderMediaTile(
              item,
              isDesktop ? 142 : isWide ? 136 : 106,
              media,
              index === visible.slice(1).length - 1 && remainder ? `+${remainder}` : undefined,
            ),
          )}
        </View>
      </View>
    );
  }

  function renderMediaGalleryModal() {
    const current = galleryMedia[galleryIndex];
    const hasMultiple = galleryMedia.length > 1;

    return (
      <Modal visible={!!galleryMedia.length} transparent animationType="fade" onRequestClose={closeMediaGallery}>
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(2,6,4,0.88)",
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 8,
            paddingVertical: Math.max(16, insets.top + 8),
          }}
        >
          <View
            style={{
              width: galleryViewportWidth,
              maxHeight: Math.max(420, windowHeight - Math.max(28, insets.top + insets.bottom)),
              borderRadius: isWide ? 26 : 20,
              overflow: "hidden",
              backgroundColor: "rgba(9,13,11,0.98)",
              borderWidth: 1,
              borderColor: BORDER_TOP,
            }}
          >
            <View
              style={{
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderBottomColor: "rgba(255,253,247,0.11)",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 13,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "rgba(45,212,191,0.16)",
                    borderWidth: 1,
                    borderColor: "rgba(94,234,212,0.34)",
                  }}
                >
                  <Ionicons name={current ? mediaIcon(current.kind) : "images-outline"} size={17} color={TEAL} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 14 }}>
                    {current ? previewTitle(current.kind) : "Media"}
                  </Text>
                  <Text style={{ marginTop: 2, color: MUTED, fontWeight: "800", fontSize: 11 }}>
                    {galleryIndex + 1} / {Math.max(1, galleryMedia.length)}
                  </Text>
                </View>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close media viewer"
                onPress={closeMediaGallery}
                style={({ pressed }) => ({
                  width: 38,
                  height: 38,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: pressed ? "rgba(255,253,247,0.14)" : "rgba(255,253,247,0.08)",
                  borderWidth: 1,
                  borderColor: BORDER,
                })}
              >
                <Ionicons name="close" size={20} color={TEXT} />
              </Pressable>
            </View>

            <View style={{ position: "relative", backgroundColor: "#030504" }}>
              <ScrollView
                ref={galleryScrollRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                decelerationRate="fast"
                keyboardShouldPersistTaps="handled"
                onMomentumScrollEnd={(event) => {
                  const page = Math.round(event.nativeEvent.contentOffset.x / galleryViewportWidth);
                  setGalleryIndex(Math.max(0, Math.min(galleryMedia.length - 1, page)));
                }}
              >
                {galleryMedia.map((item) => {
                  const uri = publicUrl(SOCIAL_BUCKET, item.storage_path, item.public_url);
                  const isImage = item.kind === "image";

                  return (
                    <View
                      key={`gallery-${item.id}`}
                      style={{
                        width: galleryViewportWidth,
                        height: galleryMediaHeight,
                        alignItems: "center",
                        justifyContent: "center",
                        padding: isImage ? 0 : 18,
                      }}
                    >
                      {isImage && uri ? (
                        <Image source={{ uri }} style={{ width: "100%", height: "100%" }} resizeMode="contain" />
                      ) : (
                        <View
                          style={{
                            width: "100%",
                            maxWidth: 420,
                            borderRadius: 22,
                            padding: 18,
                            alignItems: "center",
                            backgroundColor: "rgba(255,253,247,0.07)",
                            borderWidth: 1,
                            borderColor: BORDER,
                          }}
                        >
                          <View
                            style={{
                              width: 58,
                              height: 58,
                              borderRadius: 22,
                              alignItems: "center",
                              justifyContent: "center",
                              backgroundColor: item.kind === "audio" ? `${AMBER}24` : `${TEAL}20`,
                              borderWidth: 1,
                              borderColor: item.kind === "audio" ? `${AMBER}50` : `${TEAL}46`,
                            }}
                          >
                            <Ionicons name={mediaIcon(item.kind)} size={28} color={item.kind === "audio" ? AMBER : TEAL} />
                          </View>
                          <Text style={{ marginTop: 12, color: TEXT, fontWeight: "900", fontSize: 16 }}>
                            {previewTitle(item.kind)}
                          </Text>
                          <Pressable
                            disabled={!uri}
                            onPress={() => uri && openMediaPreview(item)}
                            style={({ pressed }) => ({
                              marginTop: 14,
                              minHeight: 42,
                              borderRadius: 15,
                              paddingHorizontal: 14,
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 7,
                              backgroundColor: pressed ? "rgba(45,212,191,0.22)" : "rgba(45,212,191,0.14)",
                              borderWidth: 1,
                              borderColor: "rgba(94,234,212,0.34)",
                              opacity: uri ? 1 : 0.55,
                            })}
                          >
                            <Ionicons name="open-outline" size={16} color={TEAL} />
                            <Text style={{ color: TEXT, fontWeight: "900", fontSize: 12 }}>Open</Text>
                          </Pressable>
                        </View>
                      )}
                    </View>
                  );
                })}
              </ScrollView>

              {hasMultiple ? (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Previous media"
                    disabled={galleryIndex <= 0}
                    onPress={() => goToGalleryIndex(galleryIndex - 1)}
                    style={({ pressed }) => ({
                      position: "absolute",
                      left: 10,
                      top: "50%",
                      marginTop: -24,
                      width: 46,
                      height: 48,
                      borderRadius: 17,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: pressed ? "rgba(255,253,247,0.20)" : "rgba(6,8,7,0.62)",
                      borderWidth: 1,
                      borderColor: "rgba(255,253,247,0.18)",
                      opacity: galleryIndex <= 0 ? 0.35 : 1,
                    })}
                  >
                    <Ionicons name="chevron-back" size={24} color={TEXT} />
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Next media"
                    disabled={galleryIndex >= galleryMedia.length - 1}
                    onPress={() => goToGalleryIndex(galleryIndex + 1)}
                    style={({ pressed }) => ({
                      position: "absolute",
                      right: 10,
                      top: "50%",
                      marginTop: -24,
                      width: 46,
                      height: 48,
                      borderRadius: 17,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: pressed ? "rgba(255,253,247,0.20)" : "rgba(6,8,7,0.62)",
                      borderWidth: 1,
                      borderColor: "rgba(255,253,247,0.18)",
                      opacity: galleryIndex >= galleryMedia.length - 1 ? 0.35 : 1,
                    })}
                  >
                    <Ionicons name="chevron-forward" size={24} color={TEXT} />
                  </Pressable>
                </>
              ) : null}
            </View>

            {hasMultiple ? (
              <View
                style={{
                  minHeight: 42,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderTopWidth: 1,
                  borderTopColor: "rgba(255,253,247,0.11)",
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 7,
                }}
              >
                {galleryMedia.map((item, index) => (
                  <Pressable
                    key={`gallery-dot-${item.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Open media ${index + 1}`}
                    onPress={() => goToGalleryIndex(index)}
                    style={{
                      width: index === galleryIndex ? 18 : 7,
                      height: 7,
                      borderRadius: 999,
                      backgroundColor: index === galleryIndex ? TEAL : "rgba(255,253,247,0.28)",
                    }}
                  />
                ))}
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    );
  }

  function renderComposer() {
    if (hideComposer || isDetail) return null;

    const canPost = !!body.trim() || assets.length > 0;
    const composerShellStyle = {
      ...feedColumnStyle,
      marginTop: isContained ? 14 : 0,
      marginBottom: postGap,
      padding: isWide ? 16 : 14,
      borderRadius: cardRadius,
      borderWidth: 1,
      borderColor: "rgba(255,253,247,0.16)",
      overflow: "hidden" as const,
      ...cardShadow,
    };

    if (!meId) {
      return (
        <LinearGradient
          colors={["rgba(45,212,191,0.10)", "rgba(255,253,247,0.055)", "rgba(9,13,11,0.96)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={composerShellStyle}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(45,212,191,0.16)",
                borderWidth: 1,
                borderColor: "rgba(94,234,212,0.36)",
              }}
            >
              <Ionicons name="person-circle-outline" size={22} color={TEAL} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 15 }}>Sign in to post</Text>
              <Text style={{ marginTop: 4, color: MUTED, lineHeight: 18, fontSize: 12 }}>
                Browse seller updates now. Sign in to publish or comment.
              </Text>
            </View>
          </View>
        </LinearGradient>
      );
    }

    return (
      <LinearGradient
        colors={["rgba(45,212,191,0.11)", "rgba(244,183,93,0.055)", "rgba(9,13,11,0.96)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={composerShellStyle}
      >
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
          <Avatar profile={selfProfile} size={isWide ? 46 : 42} />

          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <Text style={{ color: TEAL, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>
                Market update
              </Text>
              <Text style={{ color: FAINT, fontSize: 11, fontWeight: "800" }}>{assets.length}/4 media</Text>
            </View>

            <TextInput
              value={body}
              onChangeText={setBody}
              multiline
              placeholder="What's new in your store?"
              placeholderTextColor={FAINT}
              textAlignVertical="top"
              style={{
                minHeight: isWide ? 74 : 62,
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
      </LinearGradient>
    );
  }

  function renderPost(post: FeedPost) {
    const author = profileMap[post.author_id];
    const media = mediaMap[post.id] ?? [];
    const liked = !!myLikes[post.id];
    const authorName = getDisplayName(author);
    const authorHandle = getHandle(author);
    const bodyText = post.body ?? "";
    const bodyBaseLimit = isWide ? FEED_BODY_WIDE_INITIAL_LIMIT : FEED_BODY_INITIAL_LIMIT;
    const bodyStepSize = isWide ? FEED_BODY_WIDE_STEP : FEED_BODY_STEP;
    const bodySteps = expandedBodySteps[post.id] ?? 0;
    const bodyLimit = bodyBaseLimit + bodySteps * bodyStepSize;
    const bodyIsLong = !isDetail && bodyText.length > bodyBaseLimit;
    const bodyIsTruncated = !isDetail && bodyText.length > bodyLimit;
    const visibleBody = isDetail || !bodyIsTruncated ? bodyText : truncateBodyPreview(bodyText, bodyLimit);

    return (
      <LinearGradient
        colors={
          isDetail
            ? ["rgba(45,212,191,0.13)", "rgba(13,18,15,0.98)", "rgba(9,13,11,0.98)"]
            : media.length
            ? ["rgba(244,183,93,0.11)", "rgba(45,212,191,0.065)", "rgba(13,18,15,0.97)"]
            : ["rgba(45,212,191,0.10)", "rgba(255,253,247,0.055)", "rgba(13,18,15,0.97)"]
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          ...feedColumnStyle,
          marginBottom: postGap,
          padding: isWide ? 17 : 14,
          borderRadius: cardRadius,
          borderWidth: 1,
          borderColor: isDetail ? "rgba(94,234,212,0.24)" : "rgba(255,253,247,0.15)",
          overflow: "hidden",
          ...cardShadow,
        }}
      >
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            backgroundColor: media.length ? AMBER : TEAL,
            opacity: 0.88,
          }}
        />
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
          <Avatar profile={author} size={isWide ? 46 : 42} />

          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
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
              <View
                style={{
                  borderRadius: 999,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  backgroundColor: "rgba(255,253,247,0.07)",
                  borderWidth: 1,
                  borderColor: "rgba(255,253,247,0.10)",
                }}
              >
                <Text style={{ color: FAINT, fontSize: 11, fontWeight: "900" }}>{formatRelativeTime(post.created_at)}</Text>
              </View>
            </View>
            <View style={{ marginTop: 4, flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
              <Text numberOfLines={1} style={{ color: MUTED, fontSize: 12, fontWeight: "800" }}>
                @{authorHandle}
              </Text>
              <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: "rgba(255,253,247,0.24)" }} />
              <Text style={{ color: TEAL, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>Store update</Text>
            </View>

            {bodyText ? (
              <View style={{ marginTop: 11 }}>
                <Pressable
                  disabled={isDetail}
                  accessibilityRole={isDetail ? undefined : "button"}
                  accessibilityLabel={isDetail ? undefined : "Open full social post"}
                  onPress={() => openPostDetail(post.id)}
                  style={({ pressed }) => ({
                    opacity: pressed && !isDetail ? 0.82 : 1,
                  })}
                >
                  <Text style={{ color: TEXT, fontSize: isWide ? 16 : 15, lineHeight: isWide ? 24 : 22 }}>
                    {visibleBody}
                  </Text>
                </Pressable>

                {bodyIsLong ? (
                  <View style={{ marginTop: 9, flexDirection: "row", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={bodyIsTruncated ? "Show more post text" : "Show less post text"}
                      onPress={() => (bodyIsTruncated ? expandPostBody(post.id) : collapsePostBody(post.id))}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 5,
                        opacity: pressed ? 0.78 : 1,
                      })}
                    >
                      <Text style={{ color: TEAL, fontWeight: "900", fontSize: 13 }}>
                        {bodyIsTruncated ? "Show more" : "Show less"}
                      </Text>
                      <Ionicons name={bodyIsTruncated ? "chevron-down" : "chevron-up"} size={14} color={TEAL} />
                    </Pressable>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Open full social post"
                      onPress={() => openPostDetail(post.id)}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 5,
                        opacity: pressed ? 0.78 : 1,
                      })}
                    >
                      <Text style={{ color: AMBER, fontWeight: "900", fontSize: 13 }}>Open full post</Text>
                      <Ionicons name="open-outline" size={14} color={AMBER} />
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : null}

            {media.length ? <View style={{ marginTop: 14 }}>{renderMediaGrid(media)}</View> : null}

            <View
              style={{
                marginTop: 14,
                paddingTop: 12,
                borderTopWidth: 1,
                borderTopColor: "rgba(255,253,247,0.10)",
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
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
                onPress={() =>
                  isDetail
                    ? void loadComments(post.id).catch((e) => setError(friendlySocialError(e, "Could not load comments.")))
                    : openComments(post)
                }
                tone={BLUE}
              />
              {!isDetail ? (
                <IconButton
                  icon="document-text-outline"
                  label="View"
                  onPress={() => openPostDetail(post.id)}
                  tone={AMBER}
                />
              ) : null}
              {media.length ? (
                <IconButton
                  icon="expand-outline"
                  label="Open"
                  onPress={() => openMediaGallery(media[0], media)}
                  tone={TEAL}
                />
              ) : null}
            </View>
          </View>
        </View>
      </LinearGradient>
    );
  }

  function renderCommentCards() {
    if (comments.length === 0) {
      return (
        <View style={{ borderRadius: 20, borderWidth: 1, borderColor: BORDER, backgroundColor: PANEL, padding: 14 }}>
          <Text style={{ color: TEXT, fontWeight: "900" }}>No comments available</Text>
          <Text style={{ marginTop: 5, color: MUTED }}>Be the first to comment.</Text>
        </View>
      );
    }

    return comments.map((comment) => {
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
    });
  }

  function renderCommentInput() {
    const canSend = !!meId && !!commentText.trim();

    return (
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10 }}>
        <TextInput
          value={commentText}
          onChangeText={setCommentText}
          placeholder={meId ? "Write a comment..." : "Sign in to comment..."}
          placeholderTextColor={FAINT}
          editable={!!meId}
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
          disabled={commentBusy || !canSend}
          onPress={submitComment}
          style={({ pressed }) => ({
            width: 48,
            height: 48,
            borderRadius: 17,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: canSend ? TEAL : "rgba(255,253,247,0.12)",
            opacity: commentBusy || !canSend ? 0.65 : 1,
            transform: [{ scale: pressed ? 0.96 : 1 }],
          })}
        >
          {commentBusy ? <ActivityIndicator color={TEXT} /> : <Ionicons name="send" size={17} color={canSend ? INK : MUTED} />}
        </Pressable>
      </View>
    );
  }

  function renderDetailComments() {
    if (!isDetail) return null;

    return (
      <View
        style={{
          ...feedColumnStyle,
          marginBottom: postGap,
          padding: isWide ? 16 : 14,
          borderRadius: cardRadius,
          borderWidth: 1,
          borderColor: "rgba(255,253,247,0.14)",
          backgroundColor: "rgba(13,18,15,0.96)",
          ...cardShadow,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>Comments</Text>
            <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>{comments.length} visible</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh comments"
            onPress={() => {
              if (activePostId) void loadComments(activePostId);
            }}
            style={({ pressed }) => ({
              width: 40,
              height: 40,
              borderRadius: 15,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? "rgba(255,253,247,0.12)" : "rgba(255,253,247,0.07)",
              borderWidth: 1,
              borderColor: BORDER,
            })}
          >
            <Ionicons name="refresh" size={17} color={MUTED} />
          </Pressable>
        </View>

        <View style={{ marginTop: 13, gap: 10 }}>{renderCommentCards()}</View>
        <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: BORDER }}>
          {renderCommentInput()}
        </View>
      </View>
    );
  }

  function renderLoadingState() {
    return (
      <View
        style={{
          ...feedColumnStyle,
          marginBottom: postGap,
          paddingVertical: 28,
          alignItems: "center",
          borderRadius: cardRadius,
          borderWidth: 1,
          borderColor: BORDER,
          backgroundColor: SURFACE,
        }}
      >
        <ActivityIndicator color={TEAL} />
        <Text style={{ marginTop: 10, color: MUTED }}>Loading feed...</Text>
      </View>
    );
  }

  function renderEmptyState() {
    return (
      <View style={{ ...feedColumnStyle, marginBottom: postGap }}>
        <View
          style={{
            borderRadius: cardRadius,
            borderWidth: 1,
            borderColor: BORDER,
            backgroundColor: PANEL,
            padding: isWide ? 20 : 16,
            ...cardShadow,
          }}
        >
          <Ionicons name="chatbubbles-outline" size={22} color={TEAL} />
          <Text style={{ marginTop: 10, color: TEXT, fontWeight: "900", fontSize: 17 }}>
            {isDetail ? "Post not found" : profileUserId ? "No posts available" : "No updates available"}
          </Text>
          <Text style={{ marginTop: 6, color: MUTED, lineHeight: 19 }}>
            {isDetail
              ? "This social post may have been removed or is no longer available."
              : profileUserId
              ? "This seller has no published posts."
              : "No seller updates match this view."}
          </Text>
        </View>
      </View>
    );
  }

  function renderContainedHeader() {
    if (isDetail) {
      return (
        <View style={{ paddingTop: 14, paddingBottom: 2 }}>
          <LinearGradient
            colors={["rgba(45,212,191,0.14)", "rgba(244,183,93,0.08)", "rgba(13,18,15,0.96)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              ...feedColumnStyle,
              borderRadius: cardRadius,
              borderWidth: 1,
              borderColor: "rgba(255,253,247,0.16)",
              padding: isWide ? 18 : 15,
              marginBottom: postGap,
              overflow: "hidden",
              ...cardShadow,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 11,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: "rgba(45,212,191,0.16)",
                      borderWidth: 1,
                      borderColor: "rgba(94,234,212,0.34)",
                    }}
                  >
                    <Ionicons name="document-text-outline" size={15} color={TEAL} />
                  </View>
                  <Text style={{ color: TEAL, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>
                    Full post
                  </Text>
                </View>
                <Text style={{ marginTop: 9, color: TEXT, fontWeight: "900", fontSize: isWide ? 25 : 22, letterSpacing: 0 }}>
                  Social Content
                </Text>
                <Text style={{ marginTop: 5, color: MUTED, fontSize: 13, lineHeight: 19 }}>
                  Full seller update, media, reactions, and comments in one place.
                </Text>
              </View>
              <IconButton icon="refresh" label="" onPress={fetchPosts} tone={TEAL} />
            </View>
          </LinearGradient>
        </View>
      );
    }

    const headerMediaCount = posts.filter((post) => (mediaMap[post.id] ?? []).length > 0).length;
    const headerAuthorCount = new Set(posts.map((post) => post.author_id)).size;
    const headerChip = (icon: IconName, label: string, value: string, tone: string) => (
      <View
        style={{
          minWidth: isWide ? 112 : 96,
          flexGrow: isWide ? 0 : 1,
          borderRadius: 16,
          paddingHorizontal: 11,
          paddingVertical: 9,
          backgroundColor: `${tone}12`,
          borderWidth: 1,
          borderColor: `${tone}2E`,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Ionicons name={icon} size={15} color={tone} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 12 }}>
            {value}
          </Text>
          <Text numberOfLines={1} style={{ marginTop: 1, color: MUTED, fontWeight: "800", fontSize: 10 }}>
            {label}
          </Text>
        </View>
      </View>
    );

    if (showDesktopRail) {
      return (
        <View style={{ paddingTop: 14, paddingBottom: 2 }}>
          <LinearGradient
            colors={["rgba(45,212,191,0.13)", "rgba(244,183,93,0.055)", "rgba(13,18,15,0.96)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              ...feedColumnStyle,
              borderRadius: cardRadius,
              borderWidth: 1,
              borderColor: "rgba(255,253,247,0.15)",
              paddingHorizontal: 16,
              paddingVertical: 14,
              overflow: "hidden",
              ...cardShadow,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 13,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "rgba(45,212,191,0.16)",
                    borderWidth: 1,
                    borderColor: "rgba(94,234,212,0.34)",
                  }}
                >
                  <Ionicons name="newspaper-outline" size={17} color={TEAL} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: TEAL, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>
                    {profileUserId ? "Seller channel" : "Market social"}
                  </Text>
                  <Text numberOfLines={1} style={{ marginTop: 3, color: TEXT, fontWeight: "900", fontSize: 20, letterSpacing: 0 }}>
                    Social Feed
                  </Text>
                </View>
              </View>
              <IconButton icon="refresh" label="" onPress={fetchPosts} tone={TEAL} />
            </View>
            <View style={{ marginTop: 13, flexDirection: "row", gap: 9, flexWrap: "wrap" }}>
              {headerChip("newspaper-outline", "Updates", formatCount(posts.length), TEAL)}
              {headerChip("images-outline", "With media", formatCount(headerMediaCount), AMBER)}
              {headerChip("storefront-outline", "Stores", formatCount(headerAuthorCount), BLUE)}
            </View>
          </LinearGradient>
          {renderComposer()}
        </View>
      );
    }

    return (
      <View style={{ paddingTop: 14, paddingBottom: 2 }}>
        <LinearGradient
          colors={["rgba(45,212,191,0.16)", "rgba(244,183,93,0.08)", "rgba(13,18,15,0.96)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            ...feedColumnStyle,
            borderRadius: cardRadius,
            borderWidth: 1,
            borderColor: "rgba(255,253,247,0.16)",
            padding: isWide ? 18 : 15,
            marginBottom: 0,
            overflow: "hidden",
            ...cardShadow,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 11,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "rgba(45,212,191,0.16)",
                    borderWidth: 1,
                    borderColor: "rgba(94,234,212,0.34)",
                  }}
                >
                  <Ionicons name="newspaper-outline" size={15} color={TEAL} />
                </View>
                <Text style={{ color: TEAL, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>
                  {profileUserId ? "Seller channel" : "Market social"}
                </Text>
              </View>
              <Text style={{ marginTop: 9, color: TEXT, fontWeight: "900", fontSize: isWide ? 26 : 22, letterSpacing: 0 }}>
                Social Feed
              </Text>
              <Text style={{ marginTop: 5, color: MUTED, fontSize: 13, lineHeight: 19 }}>
                {profileUserId ? "Seller updates, launches, and media." : "Storefront updates, launches, and buyer-safe market activity."}
              </Text>
            </View>
            <IconButton icon="refresh" label="" onPress={fetchPosts} tone={TEAL} />
          </View>
          <View style={{ marginTop: 14, flexDirection: "row", gap: 9, flexWrap: "wrap" }}>
            {headerChip("newspaper-outline", "Updates", formatCount(posts.length), TEAL)}
            {headerChip("images-outline", "Media", formatCount(headerMediaCount), AMBER)}
            {headerChip("radio-outline", "Live", loading ? "..." : "Now", ROSE)}
          </View>
        </LinearGradient>
        {renderComposer()}
      </View>
    );
  }

  function renderInlineContent() {
    return (
      <View
        style={{
          marginTop: 12,
          width: "100%",
          alignSelf: "center",
        }}
      >
        {renderComposer()}
        {loading ? renderLoadingState() : posts.length ? posts.map((post) => <React.Fragment key={post.id}>{renderPost(post)}</React.Fragment>) : renderEmptyState()}
        {isDetail && posts.length ? renderDetailComments() : null}
      </View>
    );
  }

  function renderBoardTopBar() {
    if (!isContained) return null;

    return (
      <View
        style={{
          paddingTop: Math.max(insets.top, 12),
          paddingHorizontal: isDesktop ? 18 : 12,
          paddingBottom: 10,
          borderBottomWidth: 1,
          borderBottomColor: "rgba(255,253,247,0.09)",
          backgroundColor: "rgba(6,8,7,0.96)",
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: shellMaxWidth,
            alignSelf: "center",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            style={({ pressed }) => ({
              width: 42,
              height: 42,
              borderRadius: 15,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? "rgba(255,253,247,0.12)" : "rgba(255,253,247,0.07)",
              borderWidth: 1,
              borderColor: "rgba(255,253,247,0.12)",
            })}
          >
            <Ionicons name="arrow-back" size={19} color={TEXT} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open marketplace home"
            onPress={() => router.push("/market/(tabs)" as any)}
            style={({ pressed }) => ({
              flex: 1,
              minWidth: 0,
              borderRadius: 18,
              paddingHorizontal: 12,
              paddingVertical: 9,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              backgroundColor: pressed ? "rgba(45,212,191,0.14)" : "rgba(45,212,191,0.08)",
              borderWidth: 1,
              borderColor: "rgba(94,234,212,0.24)",
            })}
          >
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 13,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(45,212,191,0.16)",
                borderWidth: 1,
                borderColor: "rgba(94,234,212,0.34)",
              }}
            >
              <Ionicons name="shield-checkmark-outline" size={18} color={TEAL} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: isWide ? 15 : 13 }}>
                {isDetail ? "Social Post" : "Market Social Board"}
              </Text>
              <Text numberOfLines={1} style={{ marginTop: 1, color: MUTED, fontSize: 11, fontWeight: "800" }}>
                {isDetail ? "Full update, media, and comments" : "Protected seller updates and storefront activity"}
              </Text>
            </View>
          </Pressable>

          {isWide ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open marketplace"
              onPress={() => router.push("/market/(tabs)" as any)}
              style={({ pressed }) => ({
                height: 42,
                borderRadius: 15,
                paddingHorizontal: 13,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                backgroundColor: pressed ? "rgba(244,183,93,0.18)" : "rgba(244,183,93,0.10)",
                borderWidth: 1,
                borderColor: "rgba(244,183,93,0.28)",
              })}
            >
              <Ionicons name="storefront-outline" size={16} color={AMBER} />
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 12 }}>Market</Text>
            </Pressable>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open market menu"
            onPress={() => setMenuOpen(true)}
            style={({ pressed }) => ({
              width: isWide ? 46 : 42,
              height: 42,
              borderRadius: 15,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? "rgba(255,253,247,0.13)" : "rgba(255,253,247,0.075)",
              borderWidth: 1,
              borderColor: "rgba(255,253,247,0.13)",
            })}
          >
            <Ionicons name="menu-outline" size={20} color={TEXT} />
          </Pressable>
        </View>
      </View>
    );
  }

  function renderDesktopRail() {
    if (!showDesktopRail) return null;

    const authorCount = new Set(posts.map((post) => post.author_id)).size;
    const mediaPostCount = posts.filter((post) => (mediaMap[post.id] ?? []).length > 0).length;
    const featuredPosts = posts.slice(0, 4);

    const metric = (label: string, value: string, icon: IconName, tone: string) => (
      <View
        style={{
          flex: 1,
          minWidth: 0,
          borderRadius: 18,
          padding: 12,
          backgroundColor: "rgba(255,253,247,0.065)",
          borderWidth: 1,
          borderColor: "rgba(255,253,247,0.12)",
        }}
      >
        <Ionicons name={icon} size={16} color={tone} />
        <Text style={{ marginTop: 8, color: TEXT, fontWeight: "900", fontSize: 18 }}>{value}</Text>
        <Text style={{ marginTop: 2, color: MUTED, fontWeight: "800", fontSize: 11 }}>{label}</Text>
      </View>
    );

    return (
      <View style={{ gap: 14 }}>
        <LinearGradient
          colors={["rgba(244,183,93,0.13)", "rgba(45,212,191,0.08)", "rgba(13,18,15,0.96)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            borderRadius: 24,
            borderWidth: 1,
            borderColor: "rgba(255,253,247,0.15)",
            padding: 16,
          }}
        >
          <Text style={{ color: AMBER, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>Market pulse</Text>
          <Text style={{ marginTop: 8, color: TEXT, fontWeight: "900", fontSize: 20 }}>Seller activity</Text>
          <Text style={{ marginTop: 6, color: MUTED, fontSize: 12, lineHeight: 18 }}>
            Fresh launches, store notes, product drops, and proof-of-work updates from the marketplace.
          </Text>

          <View style={{ marginTop: 14, flexDirection: "row", gap: 10 }}>
            {metric("Posts", formatCount(posts.length), "newspaper-outline", TEAL)}
            {metric("Stores", formatCount(authorCount), "storefront-outline", BLUE)}
          </View>
          <View style={{ marginTop: 10, flexDirection: "row", gap: 10 }}>
            {metric("Media", formatCount(mediaPostCount), "images-outline", AMBER)}
            {metric("Live", loading ? "..." : "Now", "radio-outline", ROSE)}
          </View>
        </LinearGradient>

        <View
          style={{
            borderRadius: 24,
            borderWidth: 1,
            borderColor: "rgba(255,253,247,0.13)",
            backgroundColor: "rgba(13,18,15,0.94)",
            padding: 14,
          }}
        >
          <Text style={{ color: TEXT, fontWeight: "900", fontSize: 15 }}>Recent sellers</Text>
          <View style={{ marginTop: 12, gap: 10 }}>
            {featuredPosts.length ? (
              featuredPosts.map((post) => {
                const author = profileMap[post.author_id];
                const authorName = getDisplayName(author);
                return (
                  <Pressable
                    key={`rail-${post.id}`}
                    disabled={!author?.market_username}
                    onPress={() => author?.market_username && router.push(`/market/profile/${author.market_username}` as any)}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      borderRadius: 16,
                      padding: 9,
                      backgroundColor: pressed ? "rgba(255,253,247,0.10)" : "rgba(255,253,247,0.055)",
                      borderWidth: 1,
                      borderColor: "rgba(255,253,247,0.10)",
                    })}
                  >
                    <Avatar profile={author} size={36} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 12 }}>
                        {authorName}
                      </Text>
                      <Text numberOfLines={1} style={{ marginTop: 2, color: MUTED, fontSize: 11, fontWeight: "800" }}>
                        @{getHandle(author)} - {formatRelativeTime(post.created_at)}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={15} color={FAINT} />
                  </Pressable>
                );
              })
            ) : (
              <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>Recent seller activity will appear here.</Text>
            )}
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable
            onPress={() => router.push("/market/(tabs)/sell" as any)}
            style={({ pressed }) => ({
              flex: 1,
              borderRadius: 18,
              padding: 12,
              alignItems: "center",
              backgroundColor: pressed ? "rgba(45,212,191,0.22)" : "rgba(45,212,191,0.14)",
              borderWidth: 1,
              borderColor: "rgba(94,234,212,0.34)",
            })}
          >
            <Ionicons name="add-circle-outline" size={18} color={TEAL} />
            <Text style={{ marginTop: 6, color: TEXT, fontWeight: "900", fontSize: 12 }}>Sell</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/market/(tabs)" as any)}
            style={({ pressed }) => ({
              flex: 1,
              borderRadius: 18,
              padding: 12,
              alignItems: "center",
              backgroundColor: pressed ? "rgba(244,183,93,0.22)" : "rgba(244,183,93,0.14)",
              borderWidth: 1,
              borderColor: "rgba(244,183,93,0.34)",
            })}
          >
            <Ionicons name="storefront-outline" size={18} color={AMBER} />
            <Text style={{ marginTop: 6, color: TEXT, fontWeight: "900", fontSize: 12 }}>Shop</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  function renderContainedContent() {
    const list = (
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => renderPost(item)}
        ListHeaderComponent={renderContainedHeader()}
        ListEmptyComponent={loading ? renderLoadingState() : renderEmptyState()}
        ListFooterComponent={
          isDetail && posts.length
            ? renderDetailComments()
            : loading && posts.length
            ? renderLoadingState()
            : <View style={{ height: Math.max(20, insets.bottom + 12) }} />
        }
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchPosts} tintColor={TEAL} />}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: contentGutter,
          paddingBottom: Math.max(24, insets.bottom + 16),
        }}
      />
    );

    return (
      <View style={{ flex: 1, backgroundColor: BG0 }}>
        {renderBoardTopBar()}
        {showDesktopRail ? (
          <View
            style={{
              flex: 1,
              width: "100%",
              maxWidth: shellMaxWidth,
              alignSelf: "center",
              flexDirection: "row",
              gap: 18,
              paddingHorizontal: 18,
            }}
          >
            <View style={{ flex: 1.8, flexBasis: 0, minWidth: 0, maxWidth: feedMaxWidth }}>{list}</View>
            <ScrollView
              style={{
                width: sideRailWidth,
                maxWidth: sideRailWidth,
                flexBasis: sideRailWidth,
                flexGrow: 0,
                flexShrink: 0,
                alignSelf: "stretch",
              }}
              contentContainerStyle={{
                paddingTop: 14,
                paddingBottom: Math.max(32, insets.bottom + 24),
              }}
              showsVerticalScrollIndicator
            >
              {renderDesktopRail()}
            </ScrollView>
          </View>
        ) : (
          <View style={{ flex: 1, width: "100%", maxWidth: shellMaxWidth, alignSelf: "center" }}>{list}</View>
        )}
      </View>
    );
  }

  return (
    <View style={{ flex: isContained ? 1 : 0, width: "100%", backgroundColor: isContained ? BG0 : "transparent" }}>
      {isContained ? renderContainedContent() : renderInlineContent()}

      {renderMediaGalleryModal()}

      <OrderPreviewModal open={!!previewPayload} onClose={() => setPreviewPayload(null)} payload={previewPayload} />

      <MarketMenuModal
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        onNavigate={(route) => {
          setMenuOpen(false);
          router.push(route as any);
        }}
      />

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
              {renderCommentCards()}
            </ScrollView>

            <View
              style={{
                padding: 14,
                borderTopWidth: 1,
                borderTopColor: BORDER,
              }}
            >
              {renderCommentInput()}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
