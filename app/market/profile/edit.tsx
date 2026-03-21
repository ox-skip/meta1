import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import AppHeader from "@/components/common/AppHeader";
import { uploadToSupabaseStorage } from "@/services/market/storageUpload";
import { supabase } from "@/services/supabase";
import { getCurrentLocationWithGeocode, syncManualLocationTextAddress, toProfileLocationAddress } from "@/utils/location";

const BG0 = "#05040B";
const BG1 = "#0A0620";
const PURPLE = "#7C3AED";
const CARD = "rgba(255,255,255,0.06)";
const BORDER = "rgba(255,255,255,0.10)";
const MUTED = "rgba(255,255,255,0.62)";
const BUCKET = "market-sellers";

type SocialKey =
  | "x"
  | "instagram"
  | "facebook"
  | "tiktok"
  | "linkedin"
  | "telegram"
  | "youtube"
  | "github"
  | "whatsapp"
  | "website";

type SocialLinks = Record<SocialKey, { enabled?: boolean; handle?: string }>;

const SOCIALS: { key: SocialKey; label: string; prefix: string; icon: string }[] = [
  { key: "x", label: "X (Twitter)", prefix: "https://x.com/", icon: "twitter" },
  { key: "instagram", label: "Instagram", prefix: "https://instagram.com/", icon: "instagram" },
  { key: "facebook", label: "Facebook", prefix: "https://facebook.com/", icon: "facebook" },
  { key: "tiktok", label: "TikTok", prefix: "https://tiktok.com/@", icon: "tiktok" },
  { key: "linkedin", label: "LinkedIn", prefix: "https://linkedin.com/in/", icon: "linkedin" },
  { key: "telegram", label: "Telegram", prefix: "https://t.me/", icon: "telegram" },
  { key: "youtube", label: "YouTube", prefix: "https://youtube.com/@", icon: "youtube" },
  { key: "github", label: "GitHub", prefix: "https://github.com/", icon: "github" },
  { key: "whatsapp", label: "WhatsApp", prefix: "https://wa.me/", icon: "whatsapp" },
  { key: "website", label: "Website", prefix: "https://", icon: "web" },
];

function cleanUsername(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 24);
}
function isValidUsername(u: string) {
  return /^[a-z0-9][a-z0-9_]{2,23}$/.test(u);
}
function prettyErr(e: any) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  return e?.message || "Request failed";
}

function normalizeSocialLinks(input: Partial<SocialLinks> | null | undefined) {
  const next: Partial<SocialLinks> = {};
  SOCIALS.forEach((s) => {
    const raw = (input as any)?.[s.key] ?? {};
    const handle = String(raw?.handle ?? "").trim();
    const enabled = !!raw?.enabled && handle.length > 0;
    if (handle.length) {
      (next as any)[s.key] = { enabled, handle };
    }
  });
  return next;
}

type NameStatus = "idle" | "invalid" | "checking" | "current" | "available" | "taken" | "error";

export default function EditMarketProfile() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [stage, setStage] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [originalUsername, setOriginalUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [bio, setBio] = useState("");
  const [locationText, setLocationText] = useState("");
  const [address, setAddress] = useState<any>({});
  const [locatingAddress, setLocatingAddress] = useState(false);
  const [socialLinks, setSocialLinks] = useState<Partial<SocialLinks>>({});

  const [logoUri, setLogoUri] = useState<string | null>(null);
  const [bannerUri, setBannerUri] = useState<string | null>(null);
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [bannerPath, setBannerPath] = useState<string | null>(null);

  const [removeLogo, setRemoveLogo] = useState(false);
  const [removeBanner, setRemoveBanner] = useState(false);

  const usernameClean = useMemo(() => cleanUsername(username), [username]);
  const usernameOk = useMemo(() => isValidUsername(usernameClean), [usernameClean]);

  // username availability
  const [nameStatus, setNameStatus] = useState<NameStatus>("idle");
  const [nameHint, setNameHint] = useState("Type a username to check availability");
  const lastReq = useRef(0);

  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      console.log("[EditMarketProfile] load start");
      setLoading(true);

      try {
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;
        const user = auth?.user;
        if (!user) throw new Error("Not signed in");
        setUserId(user.id);

        const { data, error } = await supabase
          .from("market_seller_profiles")
          .select("market_username,display_name,business_name,bio,logo_path,banner_path,location_text,address,social_links")
          .eq("user_id", user.id)
          .maybeSingle();

        if (!mounted) return;

        if (error || !data) {
          Alert.alert("No profile", "Create your market profile first.");
          router.replace("/market/profile/create" as any);
          return;
        }

        setUsername(data.market_username || "");
        setOriginalUsername(data.market_username || "");
        setDisplayName(data.display_name || "");
        setBusinessName(data.business_name || "");
        setBio(data.bio || "");
        setLocationText(data.location_text || "");
        setAddress((data as any).address || {});
        setSocialLinks((data as any).social_links || {});
        setLogoPath(data.logo_path || null);
        setBannerPath(data.banner_path || null);
      } catch (e: any) {
        if (!mounted) return;
        Alert.alert("Auth error", e?.message ?? "Please log in again.");
      } finally {
        if (!mounted) return;
        setLoading(false);
        console.log("[EditMarketProfile] load end");
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  // live availability (no RPC)
  useEffect(() => {
    if (!userId) return;

    if (!username.trim()) {
      setNameStatus("idle");
      setNameHint("Type a username to check availability");
      return;
    }
    if (!usernameOk) {
      setNameStatus("invalid");
      setNameHint("Use 3–24 chars: a–z, 0–9, underscore. Start with letter/number.");
      return;
    }

    if (usernameClean === originalUsername) {
      setNameStatus("current");
      setNameHint("This is your current username.");
      return;
    }

    setNameStatus("checking");
    setNameHint("Checking availability…");

    const reqId = ++lastReq.current;
    const t = setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from("market_seller_profiles")
          .select("user_id")
          .eq("market_username", usernameClean)
          .neq("user_id", userId)
          .maybeSingle();

        if (reqId !== lastReq.current) return;

        if (error) {
          setNameStatus("error");
          setNameHint(error.message || "Could not check username.");
          return;
        }

        if (data?.user_id) {
          setNameStatus("taken");
          setNameHint("Taken — choose another username.");
        } else {
          setNameStatus("available");
          setNameHint("Available ✅");
        }
      } catch {
        if (reqId !== lastReq.current) return;
        setNameStatus("error");
        setNameHint("Could not check username. Try again.");
      }
    }, 450);

    return () => clearTimeout(t);
  }, [username, usernameClean, usernameOk, originalUsername, userId]);

  async function pickImage(setter: (v: string | null) => void) {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow photo access to upload images.");
      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.88,
      aspect: [4, 3],
    });

    if (!res.canceled && res.assets?.[0]?.uri) {
      setter(res.assets[0].uri);
    }
  }

  const canSave =
    !submitting &&
    !!userId &&
    usernameOk &&
    (nameStatus === "current" || nameStatus === "available") &&
    businessName.trim().length > 0;

  function onChangeLocationText(next: string) {
    setLocationText(next);
    setAddress((prev: any) => syncManualLocationTextAddress(prev, next));
  }

  async function useCurrentLocation() {
    setLocatingAddress(true);
    try {
      const res = await getCurrentLocationWithGeocode();
      setLocationText(res.label);
      setAddress(toProfileLocationAddress({ coords: res.coords, geo: res.geo, label: res.label }));
    } catch (e: any) {
      Alert.alert("Location error", e?.message || "Could not access location.");
    } finally {
      setLocatingAddress(false);
    }
  }

  async function onSave() {
    if (!userId) return;

    if (!usernameOk) return Alert.alert("Fix username", "Use 3–24 chars: letters, numbers, underscore.");
    if (!(nameStatus === "current" || nameStatus === "available")) {
      return Alert.alert("Username not available", "Choose an available username first.");
    }
    if (!businessName.trim()) return Alert.alert("Missing", "Business name is required.");

    setSubmitting(true);
    setStage(null);

    try {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      const user = auth?.user;
      if (!user) throw new Error("Not logged in");

      let nextLogo = removeLogo ? null : logoPath;
      let nextBanner = removeBanner ? null : bannerPath;

      // Upload new logo (optional)
      if (logoUri) {
        setStage("Uploading logo…");
        const up = await uploadToSupabaseStorage({
          bucket: BUCKET,
          path: `${user.id}/logo/logo_${Date.now()}.jpg`,
          localUri: logoUri,
          contentType: "image/jpeg",
          upsert: false, // ✅ reduces policy requirements
        });
        nextLogo = up.storagePath;
      }

      // Upload new banner (optional)
      if (bannerUri) {
        setStage("Uploading banner…");
        const up = await uploadToSupabaseStorage({
          bucket: BUCKET,
          path: `${user.id}/banner/banner_${Date.now()}.jpg`,
          localUri: bannerUri,
          contentType: "image/jpeg",
          upsert: false, // ✅ reduces policy requirements
        });
        nextBanner = up.storagePath;
      }

      setStage("Saving profile…");
      const { error } = await supabase
        .from("market_seller_profiles")
        .update({
          market_username: usernameClean,
          display_name: displayName.trim() || null,
          business_name: businessName.trim(),
          bio: bio.trim() || null,
          location_text: locationText.trim() || null,
          address: address || {},
          social_links: normalizeSocialLinks(socialLinks),
          logo_path: nextLogo,
          banner_path: nextBanner,
        })
        .eq("user_id", user.id);

      if (error) throw error;

      Alert.alert("Saved ✅", "Profile updated.");
      router.back();
    } catch (e: any) {
      // Make Storage RLS obvious
      const msg = prettyErr(e);
      if (msg.toLowerCase().includes("row level security")) {
        Alert.alert(
          "Upload blocked by Storage RLS",
          "Your profile update is allowed, but Storage upload is blocked.\n\nFix storage.objects INSERT policy for bucket 'market-sellers' and ensure it targets role 'authenticated'.\n\nError:\n" +
            msg
        );
      } else {
        Alert.alert("Failed", msg);
      }
    } finally {
      setSubmitting(false);
      setStage(null);
    }
  }

  if (loading) {
    return (
      <LinearGradient colors={[BG1, BG0]} style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <AppHeader title="Edit Market Profile" subtitle="Update your store details and images." />
        <ActivityIndicator color="#fff" />
        <Text style={{ marginTop: 10, color: MUTED, fontWeight: "800" }}>Loading…</Text>
      </LinearGradient>
    );
  }

  const logoPreview = logoUri
    ? logoUri
    : logoPath
      ? supabase.storage.from(BUCKET).getPublicUrl(logoPath).data.publicUrl
      : null;

  const bannerPreview = bannerUri
    ? bannerUri
    : bannerPath
      ? supabase.storage.from(BUCKET).getPublicUrl(bannerPath).data.publicUrl
      : null;

  return (
    <LinearGradient colors={[BG1, BG0]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ flex: 1 }}>
      <AppHeader title="Edit Market Profile" subtitle="Update your store details and images." />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 130 }} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Edit Market Profile</Text>
              <Text style={styles.subtitle}>Update your store details and images.</Text>
            </View>
          </View>

          {/* Banner */}
          <View style={styles.card}>
            <Pressable onPress={() => pickImage(setBannerUri)} style={styles.bannerBox}>
              {bannerPreview ? (
                <Image source={{ uri: bannerPreview }} style={{ width: "100%", height: "100%" }} />
              ) : (
                <View style={{ alignItems: "center" }}>
                  <Ionicons name="images-outline" size={26} color="rgba(255,255,255,0.75)" />
                  <Text style={styles.imageHintMain}>Tap to change banner</Text>
                  <Text style={styles.imageHintSub}>Optional • appears at the top</Text>
                </View>
              )}
            </Pressable>

            <View style={styles.logoRow}>
              <Pressable onPress={() => pickImage(setLogoUri)} style={styles.logoBox}>
                {logoPreview ? (
                  <Image source={{ uri: logoPreview }} style={{ width: 78, height: 78 }} />
                ) : (
                  <Ionicons name="image-outline" size={22} color="rgba(255,255,255,0.75)" />
                )}
              </Pressable>

              <View style={{ flex: 1 }}>
                <Text style={{ color: "#fff", fontWeight: "900" }}>Logo</Text>
                <Text style={{ color: MUTED, marginTop: 4, fontSize: 12 }}>
                  Optional • helps buyers recognize you
                </Text>

                <View style={{ flexDirection: "row", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                  <Chip onPress={() => pickImage(setLogoUri)} icon="image-outline" text="Change logo" />
                  <Chip
                    onPress={() => {
                      setLogoUri(null);
                      setRemoveLogo(true);
                    }}
                    icon="trash-outline"
                    text="Remove logo"
                  />
                  <Chip onPress={() => pickImage(setBannerUri)} icon="images-outline" text="Change banner" />
                  <Chip
                    onPress={() => {
                      setBannerUri(null);
                      setRemoveBanner(true);
                    }}
                    icon="trash-outline"
                    text="Remove banner"
                  />
                </View>
              </View>
            </View>
          </View>

          <SectionTitle title="Store identity" />

          <UsernameField
            value={username}
            onChangeText={(v) => {
              setUsername(v);
              // if user starts typing again, undo "remove"
              // (optional behavior)
            }}
            usernameClean={usernameClean}
            nameStatus={nameStatus}
            nameHint={nameHint}
            invalid={!usernameOk && username.trim().length > 0}
          />

          <Field
            label="Business name"
            hint="Required"
            value={businessName}
            onChangeText={setBusinessName}
            icon="storefront-outline"
            placeholder="e.g. Best City Electronics"
          />

          <Field
            label="Display name (optional)"
            hint="Shown on your store page"
            value={displayName}
            onChangeText={setDisplayName}
            icon="person-outline"
            placeholder="e.g. Ayo"
          />

          <Field
            label="Location (optional)"
            hint="Helps buyers know where you operate"
            value={locationText}
            onChangeText={onChangeLocationText}
            icon="location-outline"
            placeholder="Lagos, Abuja..."
          />

          <Pressable
            onPress={useCurrentLocation}
            disabled={locatingAddress}
            style={{
              marginTop: 10,
              borderRadius: 14,
              paddingVertical: 12,
              alignItems: "center",
              backgroundColor: "rgba(255,255,255,0.06)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.12)",
              flexDirection: "row",
              gap: 8,
              justifyContent: "center",
              opacity: locatingAddress ? 0.7 : 1,
            }}
          >
            {locatingAddress ? <ActivityIndicator color="#fff" /> : <Ionicons name="locate-outline" size={18} color="#fff" />}
            <Text style={{ color: "#fff", fontWeight: "900" }}>Use my current location</Text>
          </Pressable>

          <SectionTitle title="Social links" />
          <SocialLinksEditor value={socialLinks} onChange={setSocialLinks} />

          <SectionTitle title="About" />

          <Field
            label="Bio (optional)"
            hint="What do you sell / offer?"
            value={bio}
            onChangeText={setBio}
            icon="document-text-outline"
            placeholder="We sell phones, accessories, and repairs…"
            multiline
          />

          {stage ? (
            <View style={styles.stage}>
              <ActivityIndicator color="#fff" />
              <Text style={{ color: "rgba(255,255,255,0.9)", fontWeight: "900" }}>{stage}</Text>
            </View>
          ) : null}
        </ScrollView>

        {/* Sticky Save */}
        <View style={styles.footer}>
          <Pressable
            onPress={onSave}
            disabled={!canSave}
            style={[styles.saveBtn, { opacity: canSave ? 1 : 0.55 }]}
          >
            {submitting ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <ActivityIndicator color="#fff" />
                <Text style={{ color: "#fff", fontWeight: "900" }}>Saving…</Text>
              </View>
            ) : (
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 15 }}>Save Changes</Text>
            )}
          </Pressable>

          {!canSave ? (
            <Text style={{ marginTop: 10, color: MUTED, fontSize: 12, textAlign: "center" }}>
              Ensure username is valid/available and business name is filled.
            </Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <Text style={{ marginTop: 14, marginBottom: 8, color: "rgba(255,255,255,0.85)", fontWeight: "900", fontSize: 13 }}>
      {title.toUpperCase()}
    </Text>
  );
}

function SocialLinksEditor(props: {
  value: Partial<SocialLinks>;
  onChange: (v: Partial<SocialLinks>) => void;
}) {
  const update = (key: SocialKey, patch: { enabled?: boolean; handle?: string }) => {
    const current = (props.value as any)?.[key] ?? {};
    props.onChange({ ...props.value, [key]: { ...current, ...patch } });
  };

  return (
    <View style={{ borderRadius: 22, padding: 14, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD }}>
      <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, marginBottom: 8 }}>
        Toggle a platform and enter a username or number. Public profiles show only enabled links.
      </Text>

      {SOCIALS.map((s) => {
        const entry = (props.value as any)?.[s.key] ?? {};
        const enabled = !!entry.enabled;
        const handle = String(entry.handle ?? "");
        return (
          <View key={s.key} style={{ marginTop: 12 }}>
            <Pressable
              onPress={() => update(s.key, { enabled: !enabled })}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.10)",
                backgroundColor: "rgba(255,255,255,0.04)",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" }}>
                  <MaterialCommunityIcons name={s.icon as any} size={16} color="rgba(255,255,255,0.8)" />
                </View>
                <Text style={{ color: "#fff", fontWeight: "900" }}>{s.label}</Text>
              </View>

              <View
                style={{
                  width: 46,
                  height: 28,
                  borderRadius: 999,
                  backgroundColor: enabled ? "rgba(124,58,237,0.65)" : "rgba(255,255,255,0.15)",
                  borderWidth: 1,
                  borderColor: enabled ? "rgba(124,58,237,0.85)" : "rgba(255,255,255,0.18)",
                  padding: 3,
                  justifyContent: "center",
                }}
              >
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 999,
                    backgroundColor: "#fff",
                    alignSelf: enabled ? "flex-end" : "flex-start",
                  }}
                />
              </View>
            </Pressable>

            {enabled ? (
              <View style={{ marginTop: 8, borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(255,255,255,0.06)" }}>
                <Text style={{ color: "rgba(255,255,255,0.55)", fontSize: 12, paddingHorizontal: 12, paddingTop: 10 }}>
                  {s.prefix}
                </Text>
                <TextInput
                  value={handle}
                  onChangeText={(v) => update(s.key, { handle: v })}
                  placeholder={s.key === "whatsapp" ? "2348012345678" : "username"}
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  autoCapitalize="none"
                  style={{ color: "#fff", fontWeight: "800", paddingHorizontal: 12, paddingBottom: 12 }}
                />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function Chip({ onPress, icon, text }: { onPress: () => void; icon: any; text: string }) {
  return (
    <Pressable onPress={onPress} style={styles.chip}>
      <Ionicons name={icon} size={16} color="rgba(255,255,255,0.85)" />
      <Text style={{ color: "rgba(255,255,255,0.9)", fontWeight: "900", fontSize: 12 }}>{text}</Text>
    </Pressable>
  );
}

function UsernameField(props: {
  value: string;
  onChangeText: (v: string) => void;
  usernameClean: string;
  nameStatus: NameStatus;
  nameHint: string;
  invalid: boolean;
}) {
  const border =
    props.invalid || props.nameStatus === "taken"
      ? "rgba(239,68,68,0.55)"
      : "rgba(255,255,255,0.10)";

  return (
    <View style={[styles.fieldCard, { borderColor: border }]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
          <View style={styles.iconBox}>
            <Ionicons name="at-outline" size={18} color="rgba(255,255,255,0.85)" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#fff", fontWeight: "900" }}>Username</Text>
            <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.55)", fontSize: 12 }}>
              Lowercase, no spaces. We check availability.
            </Text>
          </View>
        </View>
        <UsernameBadge status={props.nameStatus} />
      </View>

      <View style={styles.usernameInputRow}>
        <Text style={{ color: "rgba(255,255,255,0.65)", fontWeight: "900" }}>@</Text>
        <TextInput
          value={props.value}
          onChangeText={props.onChangeText}
          placeholder="bestcity_store"
          placeholderTextColor="rgba(255,255,255,0.35)"
          autoCapitalize="none"
          style={styles.usernameInput}
        />
        <Text style={{ color: "rgba(255,255,255,0.45)", fontWeight: "800", fontSize: 12 }}>
          {props.usernameClean.length}/24
        </Text>
      </View>

      <Text style={{ marginTop: 10, color: props.invalid || props.nameStatus === "taken" ? "#FCA5A5" : MUTED, fontSize: 12 }}>
        Handle: <Text style={{ color: "#C4B5FD", fontWeight: "900" }}>@{props.usernameClean || "yourstore"}</Text>
        {"  "}•{" "}
        <Text style={{ fontWeight: "800" }}>{props.nameHint}</Text>
      </Text>
    </View>
  );
}

function UsernameBadge({ status }: { status: NameStatus }) {
  const base = { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1 } as const;

  if (status === "checking") {
    return (
      <View style={{ ...base, borderColor: "rgba(255,255,255,0.18)", backgroundColor: "rgba(255,255,255,0.06)", flexDirection: "row", alignItems: "center", gap: 8 }}>
        <ActivityIndicator size="small" color="#fff" />
        <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>Checking</Text>
      </View>
    );
  }

  const map: Record<string, { text: string; icon: any; border: string; bg: string; color: string }> = {
    current: { text: "Current", icon: "checkmark-circle-outline", border: "rgba(99,102,241,0.55)", bg: "rgba(99,102,241,0.12)", color: "rgba(199,210,254,0.95)" },
    available: { text: "Available", icon: "checkmark-circle-outline", border: "rgba(34,197,94,0.55)", bg: "rgba(34,197,94,0.12)", color: "rgba(187,247,208,0.95)" },
    taken: { text: "Taken", icon: "close-circle-outline", border: "rgba(239,68,68,0.55)", bg: "rgba(239,68,68,0.10)", color: "rgba(254,202,202,0.95)" },
    invalid: { text: "Invalid", icon: "alert-circle-outline", border: "rgba(251,191,36,0.55)", bg: "rgba(251,191,36,0.10)", color: "rgba(254,243,199,0.95)" },
    error: { text: "Error", icon: "warning-outline", border: "rgba(255,255,255,0.22)", bg: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.85)" },
    idle: { text: "Type", icon: "pencil-outline", border: "rgba(255,255,255,0.18)", bg: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.85)" },
  };

  const v = map[status] ?? map.idle;

  return (
    <View style={{ ...base, borderColor: v.border, backgroundColor: v.bg, flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Ionicons name={v.icon} size={16} color={v.color} />
      <Text style={{ color: v.color, fontWeight: "900", fontSize: 12 }}>{v.text}</Text>
    </View>
  );
}

function Field(props: {
  label: string;
  hint?: string;
  value: string;
  onChangeText: (v: string) => void;
  multiline?: boolean;
  keyboardType?: any;
  autoCapitalize?: any;
  icon?: any;
  placeholder?: string;
}) {
  return (
    <View style={styles.fieldCard}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {props.icon ? (
          <View style={styles.iconBox}>
            <Ionicons name={props.icon} size={18} color="rgba(255,255,255,0.85)" />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={{ color: "#fff", fontWeight: "900" }}>{props.label}</Text>
          {!!props.hint && <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.55)", fontSize: 12 }}>{props.hint}</Text>}
        </View>
      </View>

      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder ?? ""}
        placeholderTextColor="rgba(255,255,255,0.35)"
        multiline={props.multiline}
        keyboardType={props.keyboardType}
        autoCapitalize={props.autoCapitalize ?? "sentences"}
        style={[
          styles.input,
          props.multiline ? { minHeight: 110, textAlignVertical: "top" } : null,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  backBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: "center", justifyContent: "center" },
  title: { color: "#fff", fontSize: 22, fontWeight: "900" },
  subtitle: { color: MUTED, marginTop: 4, fontSize: 12 },

  card: { borderRadius: 22, overflow: "hidden", borderWidth: 1, borderColor: BORDER, backgroundColor: CARD },
  bannerBox: { height: 160, alignItems: "center", justifyContent: "center" },
  imageHintMain: { marginTop: 8, color: "rgba(255,255,255,0.9)", fontWeight: "900" },
  imageHintSub: { marginTop: 4, color: MUTED, fontSize: 12 },

  logoRow: { padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  logoBox: { width: 78, height: 78, borderRadius: 24, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.06)", overflow: "hidden", alignItems: "center", justifyContent: "center" },

  chip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", backgroundColor: "rgba(255,255,255,0.06)", flexDirection: "row", alignItems: "center", gap: 6 },

  fieldCard: { borderRadius: 22, padding: 14, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD, marginTop: 10 },
  iconBox: { width: 34, height: 34, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" },
  input: { marginTop: 10, color: "#fff", fontWeight: "800", fontSize: 14, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },

  usernameInputRow: { marginTop: 10, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  usernameInput: { flex: 1, color: "#fff", fontWeight: "900", fontSize: 14, paddingVertical: 12 },

  stage: { marginTop: 12, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(255,255,255,0.06)", flexDirection: "row", alignItems: "center", gap: 10 },

  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, paddingBottom: Platform.OS === "ios" ? 24 : 16, backgroundColor: "rgba(5,4,11,0.92)", borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" },
  saveBtn: { borderRadius: 18, paddingVertical: 14, alignItems: "center", backgroundColor: PURPLE, borderWidth: 1, borderColor: PURPLE },
});
