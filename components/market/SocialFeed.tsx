import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import React, { useEffect, useRef, useState } from "react";
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

import { supabase } from "@/services/supabase";
import { uploadToSupabaseStorage } from "@/services/market/storageUpload";

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
  kind: "image" | "video";
};

type PreviewAsset = {
  uri: string;
  mimeType: string;
  kind: "image" | "video" | "audio" | "file";
};

type Props = {
  profileUserId?: string;
  hideComposer?: boolean;
  mode?: "inline" | "contained";
};

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const TIMELINE_BG = "#000000";
const SURFACE = "#090B0F";
const SURFACE_ALT = "#0F1419";
const CARD = "#111821";
const BORDER = "rgba(255,255,255,0.14)";
const BORDER_SOFT = "rgba(255,255,255,0.08)";
const TEXT = "#F7F9F9";
const MUTED = "rgba(247,249,249,0.66)";
const ACCENT = "#1D9BF0";
const ACCENT_BG = "rgba(29,155,240,0.16)";
const LIKE = "#F91880";
const LIKE_BG = "rgba(249,24,128,0.16)";
const MEDIA = "#22C55E";
const MEDIA_BG = "rgba(34,197,94,0.16)";
const GOLD = "#F59E0B";
const GOLD_BG = "rgba(245,158,11,0.16)";
const SOCIAL_BUCKET = "market-social";

function fileExtFromMime(mime: string) {
  const m = mime.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("heic")) return "heic";
  if (m.includes("mp4")) return "mp4";
  if (m.includes("quicktime")) return "mov";
  if (m.includes("mpeg")) return "mp3";
  if (m.includes("wav")) return "wav";
  return "bin";
}

function pickKind(mime: string): "image" | "video" | "audio" | "file" {
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "file";
}

function safePublicUrl(bucket: string, storagePath: string | null, publicUrl: string | null) {
  if (publicUrl) return publicUrl;
  if (!storagePath) return null;
  return supabase.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl;
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

function getDisplayName(profile?: FeedProfile) {
  return profile?.business_name || profile?.display_name || "Business";
}

function getHandle(profile?: FeedProfile) {
  return profile?.market_username || "store";
}

function getInitial(label: string) {
  return label.trim().charAt(0).toUpperCase() || "B";
}

function mediaIcon(kind: FeedMedia["kind"]): IconName {
  if (kind === "video") return "videocam-outline";
  if (kind === "audio") return "musical-notes-outline";
  if (kind === "file") return "document-outline";
  return "images-outline";
}

function SellerBadge({ verified }: { verified?: boolean | null }) {
  if (!verified) return null;
  return <Ionicons name="checkmark-circle" size={17} color={ACCENT} />;
}

function MetricChip({ icon, label }: { icon: IconName; label: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: BORDER,
        backgroundColor: "rgba(255,255,255,0.03)",
        paddingHorizontal: 12,
        paddingVertical: 8,
      }}
    >
      <Ionicons name={icon} size={14} color={ACCENT} />
      <Text style={{ color: TEXT, fontWeight: "700", fontSize: 12 }}>{label}</Text>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  count,
  onPress,
  highlighted = false,
  highlightColor = ACCENT,
  highlightBackground = ACCENT_BG,
  disabled = false,
}: {
  icon: IconName;
  label: string;
  count?: number;
  onPress: () => void;
  highlighted?: boolean;
  highlightColor?: string;
  highlightBackground?: string;
  disabled?: boolean;
}) {
  const color = highlighted ? highlightColor : MUTED;
  const badgeBg = highlighted ? highlightBackground : "transparent";
  const displayLabel = typeof count === "number" && count > 0 ? formatCount(count) : label;

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minWidth: 84,
        opacity: disabled ? 0.45 : pressed ? 0.82 : 1,
      })}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: badgeBg,
        }}
      >
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={{ color, fontWeight: "700", fontSize: 13 }}>{displayLabel}</Text>
    </Pressable>
  );
}

export default function SocialFeed({ profileUserId, hideComposer = false, mode = "inline" }: Props) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [meId, setMeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [body, setBody] = useState("");
  const [assets, setAssets] = useState<LocalAsset[]>([]);
  const [previewAsset, setPreviewAsset] = useState<PreviewAsset | null>(null);

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

  const isContained = mode === "contained";
  const isTablet = width >= 768;
  const showLeftRail = isContained && width >= 1024;
  const showRightRail = isContained && width >= 1280;
  const showRailLabels = isContained && width >= 1180;
  const thumbSize = isTablet ? 108 : 88;

  const myProfile = meId ? profileMap[meId] : undefined;
  const myAvatar = myProfile?.logo_path
    ? supabase.storage.from("market-sellers").getPublicUrl(myProfile.logo_path).data.publicUrl
    : null;
  const totalMedia = Object.values(mediaMap).reduce((sum, list) => sum + list.length, 0);
  const activeProfiles = Array.from(new Set(posts.map((post) => post.author_id)))
    .map((authorId) => profileMap[authorId])
    .filter((profile): profile is FeedProfile => !!profile)
    .slice(0, 5);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setMeId(data?.user?.id ?? null);
    })();
  }, []);

  async function fetchPosts() {
    setLoading(true);
    setError(null);
    try {
      const targetAuthorIds = new Set<string>();

      if (profileUserId) {
        targetAuthorIds.add(profileUserId);
      } else {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id;
        if (uid) {
          targetAuthorIds.add(uid);
          const { data: follows } = await supabase
            .from("market_profile_follows")
            .select("followed_id")
            .eq("follower_id", uid);
          (follows ?? []).forEach((row: any) => targetAuthorIds.add(String(row.followed_id)));
        }
      }

      if (!targetAuthorIds.size) {
        setPosts([]);
        setMediaMap({});
        setProfileMap({});
        setReactionCounts({});
        setMyLikes({});
        setCommentCounts({});
        return;
      }

      const authorIds = Array.from(targetAuthorIds);
      const { data: postRows, error: postErr } = await supabase
        .from("market_social_posts")
        .select("id,author_id,body,created_at")
        .in("author_id", authorIds)
        .order("created_at", { ascending: false })
        .limit(120);

      if (postErr) throw postErr;

      const feedPosts = (postRows ?? []) as FeedPost[];
      setPosts(feedPosts);

      const postIds = feedPosts.map((post) => post.id);
      const authorSet = Array.from(new Set(feedPosts.map((post) => post.author_id)));

      const [mediaRes, profilesRes] = await Promise.all([
        postIds.length
          ? supabase
              .from("market_social_media")
              .select("id,post_id,kind,storage_path,public_url,mime_type,sort_order")
              .in("post_id", postIds)
              .order("sort_order", { ascending: true })
          : Promise.resolve({ data: [] } as any),
        authorSet.length
          ? supabase
              .from("market_seller_public_profiles")
              .select("user_id,market_username,display_name,business_name,logo_path,is_verified")
              .in("user_id", authorSet)
          : Promise.resolve({ data: [] } as any),
      ]);

      const nextMediaMap: Record<string, FeedMedia[]> = {};
      (mediaRes.data ?? []).forEach((item: FeedMedia) => {
        if (!nextMediaMap[item.post_id]) nextMediaMap[item.post_id] = [];
        nextMediaMap[item.post_id].push(item);
      });
      setMediaMap(nextMediaMap);

      const nextProfileMap: Record<string, FeedProfile> = {};
      (profilesRes.data ?? []).forEach((profile: FeedProfile) => {
        nextProfileMap[profile.user_id] = profile;
      });
      setProfileMap(nextProfileMap);

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
      setError(e?.message || "Could not load social feed");
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPosts();
  }, [profileUserId, meId]);

  useEffect(() => {
    const ch = supabase
      .channel(`market-social-feed-${profileUserId || "home"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "market_social_posts" }, (payload) => {
        const row = payload.new as any;
        const oldRow = payload.old as any;

        if (payload.eventType === "INSERT" && row?.id) {
          if (pendingPostIdsRef.current.has(String(row.id))) return;
          setPosts((prev) => {
            if (prev.some((post) => post.id === row.id)) return prev;
            if (profileUserId && row.author_id !== profileUserId) return prev;
            return [row as FeedPost, ...prev];
          });
        } else if (payload.eventType === "DELETE" && oldRow?.id) {
          setPosts((prev) => prev.filter((post) => post.id !== oldRow.id));
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "market_social_media" }, (payload) => {
        const row = (payload.new ?? payload.old) as any;
        const postId = String(row?.post_id || "");
        if (!postId) return;

        setMediaMap((prev) => {
          if (payload.eventType === "INSERT" && payload.new) {
            const incoming = payload.new as FeedMedia;
            const current = prev[postId] ?? [];
            if (current.some((item) => item.id === incoming.id)) return prev;

            return {
              ...prev,
              [postId]: [...current, incoming].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
            };
          }

          if (payload.eventType === "UPDATE" && payload.new) {
            const incoming = payload.new as FeedMedia;
            const current = prev[postId] ?? [];
            const next = current.some((item) => item.id === incoming.id)
              ? current
                  .map((item) => (item.id === incoming.id ? incoming : item))
                  .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
              : [...current, incoming].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

            return {
              ...prev,
              [postId]: next,
            };
          }

          if (payload.eventType === "DELETE" && payload.old) {
            const current = prev[postId] ?? [];
            const next = current.filter((item) => item.id !== String(payload.old.id));
            if (next.length === current.length) return prev;

            if (next.length === 0) {
              const trimmed = { ...prev };
              delete trimmed[postId];
              return trimmed;
            }

            return {
              ...prev,
              [postId]: next,
            };
          }

          return prev;
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "market_social_reactions" }, (payload) => {
        const row = (payload.new ?? payload.old) as any;
        const postId = String(row?.post_id || "");
        if (!postId) return;

        setReactionCounts((prev) => {
          const next = { ...prev };
          if (payload.eventType === "INSERT") next[postId] = (next[postId] ?? 0) + 1;
          if (payload.eventType === "DELETE") next[postId] = Math.max(0, (next[postId] ?? 0) - 1);
          return next;
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "market_social_comments" }, (payload) => {
        const row = (payload.new ?? payload.old) as any;
        const postId = String(row?.post_id || "");
        if (!postId) return;

        setCommentCounts((prev) => {
          const next = { ...prev };
          if (payload.eventType === "INSERT") next[postId] = (next[postId] ?? 0) + 1;
          if (payload.eventType === "DELETE") next[postId] = Math.max(0, (next[postId] ?? 0) - 1);
          return next;
        });

        if (commentsOpenPost?.id === postId) loadComments(postId);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [profileUserId, commentsOpenPost?.id]);

  async function chooseMedia() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError("Photo/video permission is required.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      selectionLimit: 4,
      quality: 0.9,
    });

    if (result.canceled) return;

    const pickedAssets = (result.assets ?? []) as Array<{
      uri?: string;
      mimeType?: string | null;
      type?: string | null;
    }>;

    const next = pickedAssets
      .filter((item) => !!item.uri)
      .map((item) => {
        const mime = item.mimeType || (item.type === "video" ? "video/mp4" : "image/jpeg");
        return {
          uri: item.uri || "",
          mimeType: mime,
          kind: item.type === "video" ? "video" : "image",
        } as LocalAsset;
      });

    setAssets((prev) => [...prev, ...next].slice(0, 4));
  }

  async function uploadAsset(userId: string, postId: string, asset: LocalAsset, idx: number): Promise<FeedMedia> {
    const ext = fileExtFromMime(asset.mimeType);
    const path = `${userId}/${postId}/${Date.now()}-${idx}.${ext}`;

    await uploadToSupabaseStorage({
      bucket: SOCIAL_BUCKET,
      path,
      localUri: asset.uri,
      contentType: asset.mimeType,
      upsert: false,
    });

    const { data: inserted, error: mediaErr } = await supabase
      .from("market_social_media")
      .insert({
        post_id: postId,
        kind: pickKind(asset.mimeType),
        storage_path: path,
        public_url: null,
        mime_type: asset.mimeType,
        sort_order: idx,
      })
      .select("id,post_id,kind,storage_path,public_url,mime_type,sort_order")
      .single();

    if (mediaErr) throw mediaErr;
    return inserted as FeedMedia;
  }

  async function submitPost() {
    const cleanBody = body.trim();
    let createdPostId: string | null = null;
    if (!cleanBody && assets.length === 0) return;
    if (!meId) {
      setError("Please sign in to post.");
      return;
    }
    if (postingLockRef.current) return;

    postingLockRef.current = true;
    setPosting(true);
    setError(null);
    try {
      const { data: inserted, error: postErr } = await supabase
        .from("market_social_posts")
        .insert({ author_id: meId, body: cleanBody || null })
        .select("id,author_id,body,created_at")
        .single();

      if (postErr) throw postErr;

      const created = inserted as FeedPost;
      createdPostId = created.id;
      pendingPostIdsRef.current.add(created.id);
      setPosts((prev) => prev.filter((post) => post.id !== created.id));

      const createdMedia: FeedMedia[] = [];
      const failedUploads: string[] = [];
      for (let i = 0; i < assets.length; i += 1) {
        try {
          createdMedia.push(await uploadAsset(meId, created.id, assets[i], i));
        } catch (uploadError: any) {
          failedUploads.push(String(uploadError?.message || "Attachment upload failed"));
        }
      }

      if (createdMedia.length) {
        setMediaMap((prev) => ({ ...prev, [created.id]: createdMedia }));
      }
      setPosts((prev) => [created, ...prev.filter((post) => post.id !== created.id)]);
      pendingPostIdsRef.current.delete(created.id);

      setBody("");
      setAssets([]);

      if (failedUploads.length) {
        if (!cleanBody && createdMedia.length === 0) {
          await supabase.from("market_social_posts").delete().eq("id", created.id);
          setPosts((prev) => prev.filter((post) => post.id !== created.id));
          setMediaMap((prev) => {
            const next = { ...prev };
            delete next[created.id];
            return next;
          });
          pendingPostIdsRef.current.delete(created.id);
          setError("We could not upload that attachment. Try a smaller photo/video or upload it again.");
          return;
        }

        const firstFailure = String(failedUploads[0] || "");
        if (firstFailure.toLowerCase().includes("row-level security")) {
          setError("Post published, but the attachment was blocked by storage policy for bucket: market-social.");
        } else {
          setError(
            `Post published, but ${failedUploads.length} attachment${failedUploads.length === 1 ? "" : "s"} failed to upload.`,
          );
        }
      }
    } catch (e: any) {
      if (createdPostId) pendingPostIdsRef.current.delete(createdPostId);
      const msg = String(e?.message || "Could not publish post");
      if (msg.toLowerCase().includes("row-level security")) {
        setError("Upload blocked by storage/table policy. Add insert policy for your user on bucket: market-social.");
      } else {
        setError(msg);
      }
    } finally {
      postingLockRef.current = false;
      setPosting(false);
    }
  }

  async function toggleLike(postId: string) {
    if (!meId) {
      setError("Please sign in to react.");
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
    const { data } = await supabase
      .from("market_social_comments")
      .select("id,post_id,user_id,body,created_at,profiles(username,full_name)")
      .eq("post_id", postId)
      .order("created_at", { ascending: false })
      .limit(120);

    setComments((data ?? []) as FeedComment[]);
  }

  async function openComments(post: FeedPost) {
    setCommentsOpenPost(post);
    setCommentText("");
    await loadComments(post.id);
  }

  async function submitComment() {
    if (!commentsOpenPost || !meId) return;
    const text = commentText.trim();
    if (!text) return;

    setCommentBusy(true);
    try {
      const { data: inserted } = await supabase
        .from("market_social_comments")
        .insert({ post_id: commentsOpenPost.id, user_id: meId, body: text })
        .select("id,post_id,user_id,body,created_at")
        .single();

      if (inserted) setComments((prev) => [inserted as FeedComment, ...prev]);
      setCommentText("");
    } finally {
      setCommentBusy(false);
    }
  }

  function openMediaPreview(media: FeedMedia) {
    const uri = safePublicUrl(SOCIAL_BUCKET, media.storage_path, media.public_url);
    if (!uri) return;

    setPreviewAsset({
      uri,
      mimeType: media.mime_type || "",
      kind: media.kind,
    });
  }

  function renderMediaCard(media: FeedMedia, height: number, overlayText?: string) {
    const uri = safePublicUrl(SOCIAL_BUCKET, media.storage_path, media.public_url);
    const isImage = media.kind === "image";

    return (
      <Pressable
        key={media.id}
        disabled={!uri}
        onPress={() => openMediaPreview(media)}
        style={{ flex: 1 }}
      >
        <View
          style={{
            height,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: BORDER,
            backgroundColor: CARD,
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {isImage && uri ? (
            <Image source={{ uri }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
          ) : (
            <View style={{ alignItems: "center", justifyContent: "center", paddingHorizontal: 14 }}>
              <Ionicons name={mediaIcon(media.kind)} size={30} color={TEXT} />
              <Text style={{ marginTop: 10, color: TEXT, fontWeight: "800", fontSize: 13 }}>
                {media.kind.toUpperCase()}
              </Text>
              <Text style={{ marginTop: 4, color: MUTED, fontSize: 11 }}>Tap to preview</Text>
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
                backgroundColor: "rgba(2,6,23,0.52)",
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

    if (visible.length === 0) return null;

    if (visible.length === 1) {
      return renderMediaCard(visible[0], isTablet ? 360 : 280, remainder > 0 ? `+${remainder}` : undefined);
    }

    if (visible.length === 3) {
      return (
        <View style={{ gap: 6 }}>
          {renderMediaCard(visible[0], isTablet ? 250 : 210)}
          <View style={{ flexDirection: "row", gap: 6 }}>
            {visible.slice(1).map((item, index) =>
              renderMediaCard(item, isTablet ? 170 : 135, index === 1 && remainder > 0 ? `+${remainder}` : undefined)
            )}
          </View>
        </View>
      );
    }

    if (visible.length === 2) {
      return (
        <View style={{ flexDirection: "row", gap: 6 }}>
          {visible.map((item, index) =>
            renderMediaCard(item, isTablet ? 250 : 210, index === 1 && remainder > 0 ? `+${remainder}` : undefined)
          )}
        </View>
      );
    }

    return (
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {visible.slice(0, 2).map((item) => renderMediaCard(item, isTablet ? 170 : 135))}
        </View>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {visible.slice(2).map((item, index) =>
            renderMediaCard(item, isTablet ? 170 : 135, index === 1 && remainder > 0 ? `+${remainder}` : undefined)
          )}
        </View>
      </View>
    );
  }

  function renderComposer() {
    const composerName = getDisplayName(myProfile);
    const avatarSize = isContained ? 48 : 44;

    return (
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: isContained ? 12 : 14,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: BORDER_SOFT,
          backgroundColor: "#000",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
          <View
            style={{
              width: avatarSize,
              height: avatarSize,
              borderRadius: avatarSize / 2,
              overflow: "hidden",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: isContained ? "rgba(255,255,255,0.10)" : ACCENT_BG,
            }}
          >
            {myAvatar ? (
              <Image source={{ uri: myAvatar }} style={{ width: avatarSize, height: avatarSize }} />
            ) : (
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: isContained ? 16 : 15 }}>
                {getInitial(composerName)}
              </Text>
            )}
          </View>

          <View style={{ flex: 1 }}>
            <TextInput
              value={body}
              onChangeText={setBody}
              multiline
              placeholder={profileUserId ? "Share an update with your audience" : "What's happening?"}
              placeholderTextColor="rgba(255,255,255,0.34)"
              textAlignVertical="top"
              style={{
                minHeight: isContained ? 64 : 72,
                color: TEXT,
                fontSize: isContained ? (isTablet ? 22 : 18) : 17,
                lineHeight: isContained ? (isTablet ? 30 : 24) : 24,
                paddingHorizontal: 0,
                paddingVertical: 6,
              }}
            />

            {assets.length ? (
              <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                {assets.map((asset, index) => (
                  <Pressable key={`${asset.uri}-${index}`} onPress={() => setPreviewAsset(asset)}>
                    <View
                      style={{
                        width: thumbSize,
                        height: thumbSize,
                        borderRadius: 18,
                        overflow: "hidden",
                        borderWidth: 1,
                        borderColor: BORDER,
                        backgroundColor: CARD,
                      }}
                    >
                      {asset.kind === "image" ? (
                        <Image source={{ uri: asset.uri }} style={{ width: thumbSize, height: thumbSize }} />
                      ) : (
                        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                          <Ionicons name="videocam-outline" size={24} color={TEXT} />
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
                paddingTop: 12,
                borderTopWidth: 1,
                borderTopColor: BORDER_SOFT,
                flexDirection: isTablet ? "row" : "column",
                alignItems: isTablet ? "center" : "stretch",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <Pressable
                  onPress={chooseMedia}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: ACCENT_BG,
                  }}
                >
                  <Ionicons name="image-outline" size={18} color={ACCENT} />
                </Pressable>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "rgba(255,255,255,0.06)",
                  }}
                >
                  <Ionicons name="sparkles-outline" size={18} color={ACCENT} />
                </View>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "rgba(255,255,255,0.06)",
                  }}
                >
                  <Ionicons name="location-outline" size={18} color={ACCENT} />
                </View>
                <Text style={{ color: MUTED, fontSize: 12 }}>
                  {assets.length ? `${assets.length}/4 attached` : "Photo or video"}
                </Text>
              </View>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: isTablet ? "flex-end" : "space-between",
                  gap: 12,
                }}
              >
                <View
                  style={{
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: "rgba(29,155,240,0.26)",
                    backgroundColor: "rgba(29,155,240,0.10)",
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                  }}
                >
                  <Text style={{ color: TEXT, fontWeight: "800", fontSize: 12 }}>
                    {profileUserId ? "Profile feed" : "Followers feed"}
                  </Text>
                </View>

                <Pressable
                  disabled={posting || (!body.trim() && assets.length === 0)}
                  onPress={submitPost}
                  style={{
                    minWidth: 96,
                    height: 40,
                    borderRadius: 20,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor:
                      posting || (!body.trim() && assets.length === 0) ? "rgba(255,255,255,0.18)" : "#FFFFFF",
                  }}
                >
                  <Text style={{ color: "#000", fontWeight: "900" }}>{posting ? "Posting..." : "Post"}</Text>
                </Pressable>
              </View>
            </View>

            {error ? <Text style={{ marginTop: 10, color: "#FCA5A5", fontSize: 12 }}>{error}</Text> : null}
          </View>
        </View>
      </View>
    );
  }

  function renderPost(post: FeedPost) {
    const author = profileMap[post.author_id];
    const authorName = getDisplayName(author);
    const authorHandle = getHandle(author);
    const isOwnedByMe = !!meId && post.author_id === meId;
    const authorAvatar = author?.logo_path
      ? supabase.storage.from("market-sellers").getPublicUrl(author.logo_path).data.publicUrl
      : null;
    const media = mediaMap[post.id] ?? [];

    return (
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: 14,
          borderBottomWidth: 1,
          borderBottomColor: BORDER_SOFT,
          backgroundColor: "#000",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
          <View
            style={{
              width: isContained ? 48 : 46,
              height: isContained ? 48 : 46,
              borderRadius: isContained ? 24 : 23,
              overflow: "hidden",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(255,255,255,0.08)",
            }}
          >
            {authorAvatar ? (
              <Image
                source={{ uri: authorAvatar }}
                style={{ width: isContained ? 48 : 46, height: isContained ? 48 : 46 }}
              />
            ) : (
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 16 }}>{getInitial(authorName)}</Text>
            )}
          </View>

          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: isTablet ? "row" : "column", alignItems: isTablet ? "center" : "flex-start", gap: 4 }}>
              <Pressable
                disabled={!author?.market_username}
                onPress={() => author?.market_username && router.push(`/market/profile/${author.market_username}` as any)}
                style={{ flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "100%" }}
              >
                <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 15 }}>
                  {authorName}
                </Text>
                <SellerBadge verified={author?.is_verified} />
              </Pressable>

              {isOwnedByMe ? (
                <View
                  style={{
                    borderRadius: 999,
                    backgroundColor: GOLD_BG,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                  }}
                >
                  <Text style={{ color: GOLD, fontWeight: "800", fontSize: 11 }}>Your post</Text>
                </View>
              ) : null}

              {media.length ? (
                <View
                  style={{
                    borderRadius: 999,
                    backgroundColor: ACCENT_BG,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                  }}
                >
                  <Text style={{ color: ACCENT, fontWeight: "800", fontSize: 11 }}>
                    {media.length > 1 ? `${media.length} media` : "Media drop"}
                  </Text>
                </View>
              ) : null}

              <Text numberOfLines={1} style={{ color: MUTED, fontSize: 13 }}>
                @{authorHandle} - {formatRelativeTime(post.created_at)}
              </Text>
            </View>

            {post.body ? (
              <Text
                style={{
                  marginTop: 8,
                  color: TEXT,
                  fontSize: isContained ? 16 : 15,
                  lineHeight: isContained ? 24 : 22,
                }}
              >
                {post.body}
              </Text>
            ) : null}

            {media.length ? <View style={{ marginTop: 12 }}>{renderMediaGrid(media)}</View> : null}

            <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <ActionButton
                icon="chatbubble-outline"
                label="Reply"
                count={commentCounts[post.id] ?? 0}
                onPress={() => openComments(post)}
              />

              <ActionButton
                icon={myLikes[post.id] ? "heart" : "heart-outline"}
                label="Like"
                count={reactionCounts[post.id] ?? 0}
                onPress={() => toggleLike(post.id)}
                highlighted={!!myLikes[post.id]}
                highlightColor={LIKE}
                highlightBackground={LIKE_BG}
              />

              <ActionButton
                icon="images-outline"
                label={media.length > 1 ? `${media.length} media` : "Media"}
                onPress={() => media[0] && openMediaPreview(media[0])}
                highlighted={media.length > 0}
                highlightColor={MEDIA}
                highlightBackground={MEDIA_BG}
                disabled={!media.length}
              />
            </View>
          </View>
        </View>
      </View>
    );
  }

  function renderLoadingState() {
    return (
      <View style={{ paddingVertical: 28, alignItems: "center" }}>
        <ActivityIndicator color={ACCENT} />
        <Text style={{ marginTop: 10, color: MUTED }}>Loading the timeline...</Text>
      </View>
    );
  }

  function renderEmptyState() {
    return (
      <View style={{ paddingHorizontal: 16, paddingVertical: 16 }}>
        <View
          style={{
            borderRadius: 24,
            borderWidth: 1,
            borderColor: BORDER_SOFT,
            backgroundColor: SURFACE_ALT,
            padding: 18,
          }}
        >
          <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>
            {profileUserId ? "No posts yet" : "Your timeline is quiet"}
          </Text>
          <Text style={{ marginTop: 6, color: MUTED, lineHeight: 20 }}>
            {profileUserId
              ? "This account has not shared an update yet."
              : "Follow more businesses or publish your first update to start filling this feed."}
          </Text>
        </View>
      </View>
    );
  }

  function renderInlineContent() {
    return (
      <View
        style={{
          marginTop: 12,
          borderRadius: 28,
          borderWidth: 1,
          borderColor: BORDER_SOFT,
          backgroundColor: "#000",
          overflow: "hidden",
        }}
      >
        {!hideComposer ? renderComposer() : null}
        {loading
          ? renderLoadingState()
          : posts.length === 0
            ? renderEmptyState()
            : posts.map((post) => <React.Fragment key={post.id}>{renderPost(post)}</React.Fragment>)}
      </View>
    );
  }

  function renderTimelineHeader() {
    if (isContained) {
      return !hideComposer ? renderComposer() : null;
    }

    return (
      <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
        <View
          style={{
            borderRadius: 28,
            borderWidth: 1,
            borderColor: BORDER,
            backgroundColor: SURFACE_ALT,
            padding: isTablet ? 18 : 16,
          }}
        >
          <View style={{ flexDirection: isTablet ? "row" : "column", alignItems: isTablet ? "center" : "flex-start", justifyContent: "space-between", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: ACCENT, fontWeight: "900", fontSize: 12, letterSpacing: 1 }}>LIVE FEED</Text>
              <Text style={{ marginTop: 8, color: TEXT, fontWeight: "900", fontSize: 24 }}>
                {profileUserId ? "Seller timeline" : "Marketplace updates in one scroll"}
              </Text>
              <Text style={{ marginTop: 6, color: MUTED, lineHeight: 20 }}>
                {profileUserId
                  ? "Every post from this seller, presented as a clean modern timeline."
                  : "A focused stream of posts from the businesses you follow, with media, reactions, and comments in one place."}
              </Text>
            </View>

            <View
              style={{
                borderRadius: 999,
                borderWidth: 1,
                borderColor: "rgba(29,155,240,0.28)",
                backgroundColor: ACCENT_BG,
                paddingHorizontal: 14,
                paddingVertical: 9,
              }}
            >
              <Text style={{ color: TEXT, fontWeight: "800", fontSize: 12 }}>
                {profileUserId ? "Profile posts" : "Following only"}
              </Text>
            </View>
          </View>

          <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <MetricChip icon="newspaper-outline" label={`${formatCount(posts.length)} posts`} />
            <MetricChip icon="images-outline" label={`${formatCount(totalMedia)} media items`} />
            <MetricChip icon="people-outline" label={`${formatCount(activeProfiles.length)} active sellers`} />
          </View>
        </View>

        {!hideComposer ? renderComposer() : null}
      </View>
    );
  }

  function renderDesktopRail() {
    if (!showRightRail) return null;

    return (
      <View style={{ width: 360, paddingHorizontal: 20, paddingTop: Math.max(12, insets.top + 10), gap: 16 }}>
        <View
          style={{
            height: 46,
            borderRadius: 23,
            borderWidth: 1,
            borderColor: BORDER_SOFT,
            backgroundColor: SURFACE_ALT,
            paddingHorizontal: 14,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Ionicons name="search" size={18} color={MUTED} />
          <Text style={{ color: MUTED }}>Search updates</Text>
        </View>

        <View
          style={{
            borderRadius: 28,
            borderWidth: 1,
            borderColor: BORDER_SOFT,
            backgroundColor: SURFACE_ALT,
            overflow: "hidden",
          }}
        >
          <View style={{ height: 5, backgroundColor: ACCENT }} />
          <View style={{ padding: 18, gap: 14 }}>
            <View>
              <Text style={{ color: ACCENT, fontWeight: "900", fontSize: 11, letterSpacing: 1 }}>MARKET PULSE</Text>
              <Text style={{ marginTop: 8, color: TEXT, fontWeight: "900", fontSize: 22 }}>Feed snapshot</Text>
              <Text style={{ marginTop: 6, color: MUTED, lineHeight: 20 }}>
                Keep your storefront alive with short updates, media drops, and fast replies.
              </Text>
            </View>

            <View style={{ flexDirection: "row", gap: 12 }}>
              {[
                { label: "Posts", value: formatCount(posts.length) },
                { label: "Media", value: formatCount(totalMedia) },
              ].map((item) => (
                <View key={item.label} style={{ flex: 1, borderRadius: 18, backgroundColor: "#0A0E13", padding: 14 }}>
                  <Text style={{ color: TEXT, fontWeight: "900", fontSize: 20 }}>{item.value}</Text>
                  <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>{item.label}</Text>
                </View>
              ))}
            </View>

            <View
              style={{
                borderRadius: 18,
                backgroundColor: "rgba(255,255,255,0.04)",
                paddingHorizontal: 14,
                paddingVertical: 12,
              }}
            >
              <Text style={{ color: MUTED, lineHeight: 20 }}>
                {posts[0] ? `Latest post landed ${formatRelativeTime(posts[0].created_at)} ago.` : "No posts loaded yet."}
              </Text>
            </View>
          </View>
        </View>

        <View
          style={{
            borderRadius: 28,
            borderWidth: 1,
            borderColor: BORDER_SOFT,
            backgroundColor: SURFACE_ALT,
            padding: 18,
            gap: 12,
          }}
        >
          <Text style={{ color: TEXT, fontWeight: "900", fontSize: 20 }}>Active sellers</Text>
          {activeProfiles.length ? (
            activeProfiles.map((profile) => {
              const avatar = profile.logo_path
                ? supabase.storage.from("market-sellers").getPublicUrl(profile.logo_path).data.publicUrl
                : null;
              const username = profile.market_username;
              const name = getDisplayName(profile);

              return (
                <Pressable
                  key={profile.user_id}
                  disabled={!username}
                  onPress={() => username && router.push(`/market/profile/${username}` as any)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
                >
                  <View
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 21,
                      overflow: "hidden",
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: "#0A0E13",
                    }}
                  >
                    {avatar ? (
                      <Image source={{ uri: avatar }} style={{ width: 42, height: 42 }} />
                    ) : (
                      <Text style={{ color: TEXT, fontWeight: "900" }}>{getInitial(name)}</Text>
                    )}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "800", flexShrink: 1 }}>
                        {name}
                      </Text>
                      <SellerBadge verified={profile.is_verified} />
                    </View>
                    <Text numberOfLines={1} style={{ marginTop: 2, color: MUTED, fontSize: 12 }}>
                      @{getHandle(profile)}
                    </Text>
                  </View>
                </Pressable>
              );
            })
          ) : (
            <Text style={{ color: MUTED, lineHeight: 20 }}>Follow sellers to populate this side column.</Text>
          )}
        </View>

        <View
          style={{
            borderRadius: 28,
            borderWidth: 1,
            borderColor: BORDER_SOFT,
            backgroundColor: SURFACE_ALT,
            padding: 18,
            gap: 10,
          }}
        >
          <Text style={{ color: TEXT, fontWeight: "900", fontSize: 20 }}>Post ideas</Text>
          {[
            "Share one clean product shot or a short demo clip.",
            "Drop quick updates when price or inventory changes.",
            "Reply to comments fast to keep momentum on your posts.",
          ].map((tip) => (
            <View key={tip} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
              <View
                style={{
                  marginTop: 6,
                  width: 7,
                  height: 7,
                  borderRadius: 3.5,
                  backgroundColor: ACCENT,
                }}
              />
              <Text style={{ flex: 1, color: MUTED, lineHeight: 20 }}>{tip}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  function renderContainedTimeline() {
    const railWidth = showRailLabels ? 232 : 88;
    const timelineWidth = showRightRail ? 760 : showLeftRail ? 860 : width;
    const navItems: Array<{ icon: IconName; label: string; active?: boolean }> = [
      { icon: "home", label: "Home", active: true },
      { icon: "search", label: "Explore" },
      { icon: "notifications-outline", label: "Alerts" },
      { icon: "mail-outline", label: "Messages" },
      { icon: "person-outline", label: "Profile" },
    ];

    return (
      <View style={{ flex: 1, width: "100%", flexDirection: "row", backgroundColor: TIMELINE_BG }}>
        {showLeftRail ? (
          <View
            style={{
              width: railWidth,
              borderRightWidth: 1,
              borderRightColor: BORDER_SOFT,
              paddingTop: Math.max(8, insets.top),
              paddingHorizontal: showRailLabels ? 14 : 0,
              alignItems: showRailLabels ? "stretch" : "center",
              gap: 10,
            }}
          >
            <View
              style={{
                alignSelf: showRailLabels ? "flex-start" : "center",
                marginLeft: showRailLabels ? 8 : 0,
                width: 56,
                height: 56,
                borderRadius: 28,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(29,155,240,0.12)",
              }}
            >
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 28 }}>M</Text>
            </View>

            {navItems.map((item) => (
              <View
                key={item.label}
                style={{
                  alignSelf: showRailLabels ? "stretch" : "center",
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: showRailLabels ? "flex-start" : "center",
                    gap: 14,
                    height: 52,
                    borderRadius: 26,
                    paddingHorizontal: showRailLabels ? 18 : 0,
                    backgroundColor: item.active ? "rgba(255,255,255,0.08)" : "transparent",
                  }}
                >
                  <Ionicons name={item.icon} size={26} color={TEXT} />
                  {showRailLabels ? (
                    <Text style={{ color: TEXT, fontWeight: item.active ? "900" : "700", fontSize: 18 }}>
                      {item.label}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}

            <View
              style={{
                marginTop: 6,
                width: showRailLabels ? "100%" : 54,
                height: 54,
                borderRadius: 27,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#FFFFFF",
              }}
            >
              {showRailLabels ? (
                <Text style={{ color: "#000", fontWeight: "900", fontSize: 17 }}>Post</Text>
              ) : (
                <Ionicons name="add" size={26} color="#000" />
              )}
            </View>
          </View>
        ) : null}

        <View
          style={{
            flex: 1,
            minHeight: 0,
            flexDirection: "row",
            justifyContent: showRightRail ? "space-between" : "center",
            backgroundColor: "#000",
          }}
        >
          <View style={{ flex: 1, minWidth: 0, alignItems: showRightRail ? "flex-start" : "center" }}>
            <View
              style={{
                flex: 1,
                minHeight: 0,
                width: "100%",
                maxWidth: timelineWidth,
                borderLeftWidth: showLeftRail ? 0 : isTablet ? 1 : 0,
                borderRightWidth: 1,
                borderColor: BORDER_SOFT,
                backgroundColor: "#000",
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  height: 56 + insets.top,
                  paddingTop: insets.top,
                  borderBottomWidth: 1,
                  borderBottomColor: BORDER_SOFT,
                  backgroundColor: "rgba(0,0,0,0.94)",
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <View style={{ flexDirection: "row", flex: 1, height: "100%" }}>
                  <Pressable
                    style={{
                      flex: 1,
                      alignItems: "center",
                      justifyContent: "center",
                      borderBottomWidth: 3,
                      borderBottomColor: "transparent",
                    }}
                  >
                    <Text style={{ color: "rgba(255,255,255,0.62)", fontWeight: "700", fontSize: 15 }}>For you</Text>
                  </Pressable>
                  <Pressable
                    style={{
                      flex: 1,
                      alignItems: "center",
                      justifyContent: "center",
                      borderBottomWidth: 3,
                      borderBottomColor: ACCENT,
                    }}
                  >
                    <Text style={{ color: TEXT, fontWeight: "800", fontSize: 15 }}>Following</Text>
                  </Pressable>
                </View>

                <Pressable onPress={fetchPosts} style={{ width: 54, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="sparkles-outline" size={20} color={TEXT} />
                </Pressable>
              </View>

              <FlatList
                data={posts}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => renderPost(item)}
                ListHeaderComponent={renderTimelineHeader()}
                ListEmptyComponent={!loading ? renderEmptyState() : null}
                ListFooterComponent={
                  loading && posts.length > 0 ? renderLoadingState() : <View style={{ height: Math.max(20, insets.bottom + 8) }} />
                }
                keyboardShouldPersistTaps="handled"
                refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchPosts} tintColor={ACCENT} />}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: Math.max(24, insets.bottom + 18) }}
              />
            </View>
          </View>

          {renderDesktopRail()}
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: isContained ? 1 : 0, width: "100%" }}>
      {isContained ? renderContainedTimeline() : renderInlineContent()}

      <Modal visible={!!previewAsset} transparent animationType="fade" onRequestClose={() => setPreviewAsset(null)}>
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(2,6,23,0.94)",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <Pressable onPress={() => setPreviewAsset(null)} style={{ position: "absolute", top: 42, right: 18, zIndex: 10 }}>
            <Ionicons name="close-circle" size={36} color={TEXT} />
          </Pressable>

          <View
            style={{
              width: "100%",
              maxWidth: isTablet ? 920 : "100%",
              borderRadius: 28,
              borderWidth: 1,
              borderColor: BORDER,
              backgroundColor: SURFACE_ALT,
              overflow: "hidden",
            }}
          >
            {previewAsset?.kind === "image" ? (
              <Image
                source={{ uri: previewAsset.uri }}
                style={{ width: "100%", height: isTablet ? 560 : 360 }}
                resizeMode="contain"
              />
            ) : (
              <View style={{ padding: 24 }}>
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: ACCENT_BG,
                  }}
                >
                  <Ionicons name={previewAsset ? mediaIcon(previewAsset.kind as FeedMedia["kind"]) : "document-outline"} size={28} color={TEXT} />
                </View>
                <Text style={{ marginTop: 16, color: TEXT, fontWeight: "900", fontSize: 18 }}>Media preview</Text>
                <Text style={{ marginTop: 8, color: MUTED, lineHeight: 20 }}>
                  Video, audio, and file previews are limited in this build. The attachment still keeps its cleaner card layout in the feed on mobile and web.
                </Text>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={!!commentsOpenPost} transparent animationType="fade" onRequestClose={() => setCommentsOpenPost(null)}>
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(2,6,23,0.72)",
            alignItems: "center",
            justifyContent: isTablet ? "center" : "flex-end",
            padding: 16,
          }}
        >
          <View
            style={{
              width: "100%",
              maxWidth: 720,
              maxHeight: isTablet ? "82%" : "90%",
              borderRadius: 28,
              borderWidth: 1,
              borderColor: BORDER,
              backgroundColor: TIMELINE_BG,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                paddingHorizontal: 18,
                paddingVertical: 16,
                borderBottomWidth: 1,
                borderBottomColor: BORDER_SOFT,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <View>
                <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>Comments</Text>
                <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>Join the conversation around this update.</Text>
              </View>

              <Pressable onPress={() => setCommentsOpenPost(null)}>
                <Ionicons name="close" size={24} color={TEXT} />
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 10 }}>
              {comments.length === 0 ? (
                <View
                  style={{
                    borderRadius: 20,
                    borderWidth: 1,
                    borderColor: BORDER,
                    backgroundColor: SURFACE_ALT,
                    padding: 16,
                  }}
                >
                  <Text style={{ color: TEXT, fontWeight: "800" }}>No comments yet</Text>
                  <Text style={{ marginTop: 6, color: MUTED }}>Be the first to reply to this post.</Text>
                </View>
              ) : (
                comments.map((comment) => (
                  <View
                    key={comment.id}
                    style={{
                      borderRadius: 20,
                      borderWidth: 1,
                      borderColor: BORDER,
                      backgroundColor: SURFACE_ALT,
                      padding: 14,
                    }}
                  >
                    <Text style={{ color: TEXT, fontWeight: "800" }}>
                      @{comment.profiles?.username || comment.profiles?.full_name || "user"}
                    </Text>
                    <Text style={{ marginTop: 6, color: TEXT, lineHeight: 20 }}>{comment.body}</Text>
                    <Text style={{ marginTop: 6, color: MUTED, fontSize: 11 }}>{new Date(comment.created_at).toLocaleString()}</Text>
                  </View>
                ))
              )}
            </ScrollView>

            <View
              style={{
                padding: 16,
                borderTopWidth: 1,
                borderTopColor: BORDER_SOFT,
                flexDirection: "row",
                alignItems: "flex-end",
                gap: 10,
              }}
            >
              <TextInput
                value={commentText}
                onChangeText={setCommentText}
                placeholder="Write a comment..."
                placeholderTextColor="rgba(226,232,240,0.34)"
                multiline
                style={{
                  flex: 1,
                  minHeight: 48,
                  maxHeight: 120,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: BORDER,
                  backgroundColor: "rgba(255,255,255,0.03)",
                  color: TEXT,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                }}
              />

              <Pressable
                disabled={commentBusy}
                onPress={submitComment}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 18,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: "rgba(29,155,240,0.35)",
                  backgroundColor: ACCENT_BG,
                }}
              >
                <Ionicons name="send" size={18} color={TEXT} />
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
