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
  Text,
  TextInput,
  View,
} from "react-native";

import AppHeader from "@/components/common/AppHeader";
import { callFn } from "@/services/functions";
import { uploadToSupabaseStorage } from "@/services/market/storageUpload";
import { fetchWithTimeout } from "@/services/net";
import { supabase } from "@/services/supabase";
import { getCurrentLocationWithGeocode, syncManualLocationTextAddress, toProfileLocationAddress } from "@/utils/location";

const BG0 = "#05040B";
const BG1 = "#0A0620";
const PURPLE = "#7C3AED";
const CARD = "rgba(255,255,255,0.06)";
const BORDER = "rgba(255,255,255,0.10)";
const MUTED = "rgba(255,255,255,0.62)";
const DANGER = "#FCA5A5";
const SUCCESS = "rgba(187,247,208,0.95)";
const BUCKET_SELLERS = "market-sellers";

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

  const msg = e?.message || "Request failed";
  const code = e?.code ? ` (code: ${e.code})` : "";
  const details = e?.details ? `\n${e.details}` : "";
  const hint = e?.hint ? `\nHint: ${e.hint}` : "";
  return `${msg}${code}${details}${hint}`;
}

function isMissingBaseProfileError(e: any) {
  const msg = prettyErr(e).toLowerCase();
  return (
    msg.includes("failed to initialize account profile") ||
    msg.includes("failed to read account profile") ||
    ((msg.includes("foreign key") || msg.includes("market_seller_profiles_user_id_fkey")) &&
      msg.includes("profiles"))
  );
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

async function pickImage() {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.9,
    allowsEditing: true,
    aspect: [4, 3],
  });
  if (res.canceled) return null;
  return res.assets[0];
}

async function uploadImageToBucket(params: {
  userId: string;
  kind: "logo" | "banner";
  localUri: string;
}) {
  const { userId, kind, localUri } = params;

  // infer extension (best effort)
  const fileRes = await fetchWithTimeout(localUri, {}, 20000);
  if (!fileRes.ok) {
    const text = await fileRes.text().catch(() => "");
    console.log("[CreateMarketProfile] local file fetch failed", fileRes.status, text);
    throw new Error(`Failed to read local file (HTTP ${fileRes.status})`);
  }
  const blob = await fileRes.blob();
  const extGuess = blob.type?.split("/")?.[1] || "jpg";

  const fileName = `${kind}_${Date.now()}.${extGuess}`;
  const path = `${userId}/${kind}/${fileName}`;

  // IMPORTANT: uploadToSupabaseStorage must use the authenticated supabase client/session
  await uploadToSupabaseStorage({
    bucket: BUCKET_SELLERS,
    path,
    localUri,
    contentType: blob.type || "image/jpeg",
  });

  return path;
}

async function insertProfileDirect(params: {
  userId: string;
  marketUsername: string;
  displayName: string;
  businessName: string;
  bio: string;
  phone: string;
  locationText: string;
  address: any;
  socialLinks: Partial<SocialLinks>;
  offersRemote: boolean;
  offersInPerson: boolean;
}) {
  const basePayload = {
    user_id: params.userId,
    market_username: params.marketUsername,
    display_name: params.displayName.trim() || null,
    business_name: params.businessName.trim(),
    bio: params.bio.trim() || null,
    phone: params.phone.trim() || null,
    location_text: params.locationText.trim() || null,
    address: params.address || {},
    offers_remote: params.offersRemote,
    offers_in_person: params.offersInPerson,
    is_verified: false,
    payout_tier: "standard",
    active: true,
  };

  const tryInsert = async (payload: Record<string, any>) => {
    const { error } = await supabase.from("market_seller_profiles").insert(payload);
    if (error) throw error;
  };

  try {
    await tryInsert({
      ...basePayload,
      social_links: normalizeSocialLinks(params.socialLinks),
    });
  } catch (e: any) {
    const msg = prettyErr(e).toLowerCase();
    const missingSocialLinksColumn =
      msg.includes("social_links") && (msg.includes("column") || msg.includes("schema cache"));
    if (!missingSocialLinksColumn) throw e;
    await tryInsert(basePayload);
  }
}

async function updateProfileImagePathsDirect(userId: string, input: { logo_path?: string; banner_path?: string }) {
  const { error } = await supabase
    .from("market_seller_profiles")
    .update(input)
    .eq("user_id", userId);
  if (error) throw error;
}

type NameStatus = "idle" | "invalid" | "checking" | "available" | "taken" | "error";

export default function CreateMarketProfile() {
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<string | null>(null);

  const [marketUsername, setMarketUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [bio, setBio] = useState("");
  const [phone, setPhone] = useState("");
  const [locationText, setLocationText] = useState("");
  const [address, setAddress] = useState<any>({});
  const [locatingAddress, setLocatingAddress] = useState(false);
  const [socialLinks, setSocialLinks] = useState<Partial<SocialLinks>>({});

  const [offersRemote, setOffersRemote] = useState(false);
  const [offersInPerson, setOffersInPerson] = useState(false);

  const [logoUri, setLogoUri] = useState<string | null>(null);
  const [bannerUri, setBannerUri] = useState<string | null>(null);

  const usernameClean = useMemo(() => cleanUsername(marketUsername), [marketUsername]);
  const usernameOk = useMemo(() => isValidUsername(usernameClean), [usernameClean]);

  const [nameStatus, setNameStatus] = useState<NameStatus>("idle");
  const [nameHint, setNameHint] = useState("Type a username to check availability");
  const lastReq = useRef(0);

  // ✅ Live availability check (OLD WAY - no RPC)
  useEffect(() => {
    if (!marketUsername.trim()) {
      setNameStatus("idle");
      setNameHint("Type a username to check availability");
      return;
    }

    if (!usernameOk) {
      setNameStatus("invalid");
      setNameHint("Use 3–24 chars: a–z, 0–9, underscore. Start with letter/number.");
      return;
    }

    setNameStatus("checking");
    setNameHint("Checking availability…");

    const reqId = ++lastReq.current;
    const t = setTimeout(async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        if (!sess.session) {
          setNameStatus("error");
          setNameHint("Session missing. Please sign in again.");
          return;
        }

        const { data, error } = await supabase
          .from("market_seller_profiles")
          .select("user_id")
          .eq("market_username", usernameClean)
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
  }, [marketUsername, usernameClean, usernameOk]);

  const canSubmit =
    !loading &&
    usernameOk &&
    nameStatus !== "taken" &&
    nameStatus !== "checking" &&
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

  async function submit() {
    if (loading) return;

    if (!usernameOk) {
      Alert.alert("Invalid username", "Use 3–24 chars: lowercase letters, numbers, underscore.");
      return;
    }
    if (nameStatus === "taken") {
      Alert.alert("Username not available", "Choose a different username before creating.");
      return;
    }
    if (nameStatus === "checking") {
      Alert.alert("Checking username", "Wait a moment for username availability to finish checking.");
      return;
    }
    if (!businessName.trim()) {
      Alert.alert("Business name required", "Add your business/store name.");
      return;
    }

    setLoading(true);
    setStage(null);
    console.log("[CreateMarketProfile] submit start");

    try {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      const user = auth?.user;
      if (!user) throw new Error("You are not logged in");

      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) throw new Error("Session missing. Please sign in again.");

      // 1) Existing profile?
      setStage("Checking existing profile…");
      let existing: { user_id: string } | null = null;
      try {
        const { data, error: exErr } = await supabase
          .from("market_seller_profiles")
          .select("user_id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (exErr) throw exErr;
        existing = data;
      } catch (e: any) {
        console.log("[CreateMarketProfile] existing profile check skipped", prettyErr(e));
      }

      if (existing?.user_id) {
        Alert.alert("Profile exists", "You already have a market profile. Redirecting…");
        router.replace("/market/(tabs)/account" as any);
        return;
      }

      // 2) Create profile FIRST (so Storage RLS doesn’t block profile creation)
      setStage("Creating profile…");
      try {
        await callFn("market-seller-profile-upsert", {
          market_username: usernameClean,
          display_name: displayName.trim() || null,
          business_name: businessName.trim(),
          bio: bio.trim() || null,
          phone: phone.trim() || null,
          location_text: locationText.trim() || null,
          address: address || {},
          social_links: normalizeSocialLinks(socialLinks),
          offers_remote: offersRemote,
          offers_in_person: offersInPerson,
          active: true,
        });
      } catch (e: any) {
        const msg = prettyErr(e).toLowerCase();
        if (msg.includes("duplicate key") || msg.includes("market_username")) {
          throw new Error("Username already taken. Please choose another one.");
        }
        if (isMissingBaseProfileError(e)) {
          throw new Error("Your account profile could not be initialized. Please sign out, sign back in, and try again.");
        }
        console.log("[CreateMarketProfile] function create failed, trying direct insert", prettyErr(e));
        try {
          await insertProfileDirect({
            userId: user.id,
            marketUsername: usernameClean,
            displayName,
            businessName,
            bio,
            phone,
            locationText,
            address,
            socialLinks,
            offersRemote,
            offersInPerson,
          });
        } catch (fallbackErr: any) {
          const fallbackMsg = prettyErr(fallbackErr).toLowerCase();
          if (fallbackMsg.includes("duplicate key") || fallbackMsg.includes("market_username")) {
            throw new Error("Username already taken. Please choose another one.");
          }
          if (isMissingBaseProfileError(fallbackErr)) {
            throw new Error("Your account profile is missing. Please sign out, sign back in, and try again.");
          }
          throw fallbackErr;
        }
      }

      // 3) Upload images AFTER profile (optional)
      let logo_path: string | null = null;
      let banner_path: string | null = null;

      let uploadFailed: string | null = null;

      if (logoUri) {
        setStage("Uploading logo…");
        try {
          logo_path = await uploadImageToBucket({ userId: user.id, kind: "logo", localUri: logoUri });
        } catch (e: any) {
          uploadFailed = "Logo upload failed.\n" + prettyErr(e);
        }
      }

      if (bannerUri) {
        setStage("Uploading banner…");
        try {
          banner_path = await uploadImageToBucket({ userId: user.id, kind: "banner", localUri: bannerUri });
        } catch (e: any) {
          uploadFailed = (uploadFailed ? uploadFailed + "\n\n" : "") + "Banner upload failed.\n" + prettyErr(e);
        }
      }

      // 4) Update profile with uploaded paths (if any)
      if (logo_path || banner_path) {
        setStage("Saving images…");
        try {
          await callFn("market-seller-profile-upsert", {
            ...(logo_path ? { logo_path } : {}),
            ...(banner_path ? { banner_path } : {}),
          });
        } catch (e: any) {
          console.log("[CreateMarketProfile] function image save failed, trying direct update", prettyErr(e));
          try {
            await updateProfileImagePathsDirect(user.id, {
              ...(logo_path ? { logo_path } : {}),
              ...(banner_path ? { banner_path } : {}),
            });
          } catch (fallbackErr: any) {
            uploadFailed =
              (uploadFailed ? uploadFailed + "\n\n" : "") +
              "Saving image paths failed.\n" +
              prettyErr(fallbackErr);
          }
        }
      }

      setStage(null);

      if (uploadFailed) {
        Alert.alert(
          "Profile created ✅",
          "Your profile was created, but image upload failed.\n\nThis is usually Storage RLS or missing auth token in upload.\n\n" +
            uploadFailed
        );
      } else {
        Alert.alert("Done ✅", "Your market profile has been created.");
      }

      router.replace("/market/(tabs)/account" as any);
    } catch (e: any) {
      setStage(null);
      Alert.alert("Failed", prettyErr(e));
    } finally {
      setLoading(false);
      console.log("[CreateMarketProfile] submit end");
    }
  }

  return (
    <LinearGradient
      colors={[BG1, BG0]}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={{ flex: 1 }}
    >
      <AppHeader title="Create Market Profile" subtitle="Username is public. Your store page becomes searchable." />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 130 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 }}>
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
              <Text style={{ color: "#fff", fontSize: 22, fontWeight: "900" }}>
                Create Market Profile
              </Text>
              <Text style={{ color: MUTED, marginTop: 4, fontSize: 12 }}>
                Username is public. Your store page becomes searchable.
              </Text>
            </View>
          </View>

          {/* Banner */}
          <View style={{ borderRadius: 22, overflow: "hidden", borderWidth: 1, borderColor: BORDER, backgroundColor: CARD }}>
            <Pressable
              onPress={async () => {
                const a = await pickImage();
                if (a?.uri) setBannerUri(a.uri);
              }}
              style={{
                height: 160,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {bannerUri ? (
                <Image source={{ uri: bannerUri }} style={{ width: "100%", height: "100%" }} />
              ) : (
                <View style={{ alignItems: "center", paddingHorizontal: 14 }}>
                  <Ionicons name="images-outline" size={26} color="rgba(255,255,255,0.75)" />
                  <Text style={{ marginTop: 8, color: "rgba(255,255,255,0.9)", fontWeight: "900" }}>
                    Tap to add banner (optional)
                  </Text>
                  <Text style={{ marginTop: 4, color: MUTED, fontSize: 12, textAlign: "center" }}>
                    Shows at the top of your store page
                  </Text>
                </View>
              )}
            </Pressable>

            {/* Logo row */}
            <View style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Pressable
                onPress={async () => {
                  const a = await pickImage();
                  if (a?.uri) setLogoUri(a.uri);
                }}
                style={{
                  width: 78,
                  height: 78,
                  borderRadius: 24,
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.12)",
                  backgroundColor: "rgba(255,255,255,0.06)",
                  overflow: "hidden",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {logoUri ? (
                  <Image source={{ uri: logoUri }} style={{ width: 78, height: 78 }} />
                ) : (
                  <Ionicons name="image-outline" size={22} color="rgba(255,255,255,0.75)" />
                )}
              </Pressable>

              <View style={{ flex: 1 }}>
                <Text style={{ color: "#fff", fontWeight: "900" }}>Logo (optional)</Text>
                <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>
                  Helps buyers recognize your store.
                </Text>

                {(logoUri || bannerUri) ? (
                  <View style={{ marginTop: 10, flexDirection: "row", gap: 10 }}>
                    {logoUri ? (
                      <Pressable
                        onPress={() => setLogoUri(null)}
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 8,
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: "rgba(255,255,255,0.14)",
                          backgroundColor: "rgba(255,255,255,0.06)",
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <Ionicons name="trash-outline" size={16} color="rgba(255,255,255,0.85)" />
                        <Text style={{ color: "rgba(255,255,255,0.85)", fontWeight: "900", fontSize: 12 }}>
                          Remove logo
                        </Text>
                      </Pressable>
                    ) : null}

                    {bannerUri ? (
                      <Pressable
                        onPress={() => setBannerUri(null)}
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 8,
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: "rgba(255,255,255,0.14)",
                          backgroundColor: "rgba(255,255,255,0.06)",
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <Ionicons name="trash-outline" size={16} color="rgba(255,255,255,0.85)" />
                        <Text style={{ color: "rgba(255,255,255,0.85)", fontWeight: "900", fontSize: 12 }}>
                          Remove banner
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </View>
          </View>

          {/* Section: Identity */}
          <SectionTitle title="Store identity" />

          <UsernameField
            value={marketUsername}
            onChangeText={setMarketUsername}
            usernameClean={usernameClean}
            nameStatus={nameStatus}
            nameHint={nameHint}
            invalid={!usernameOk && marketUsername.trim().length > 0}
          />

          <Field
            label="Business name"
            hint="This is your store name (required)"
            value={businessName}
            onChangeText={setBusinessName}
            icon="storefront-outline"
            placeholder="e.g. Best City Electronics"
            invalid={businessName.trim().length === 0 && loading}
          />

          <Field
            label="Display name (optional)"
            hint="Your personal name (optional)"
            value={displayName}
            onChangeText={setDisplayName}
            icon="person-outline"
            placeholder="e.g. Ayo"
          />

          {/* Section: Contact */}
          <SectionTitle title="Contact" />

          <Field
            label="Phone (optional)"
            hint="For customer contact"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            icon="call-outline"
            placeholder="+234..."
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

          {/* Section: About */}
          <SectionTitle title="About your store" />

          <Field
            label="Bio (optional)"
            hint="A short description (what you sell / offer)"
            value={bio}
            onChangeText={setBio}
            multiline
            icon="document-text-outline"
            placeholder="We sell phones, accessories, and repairs…"
          />

          <View style={{ borderRadius: 22, padding: 14, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD }}>
            <Text style={{ color: "#fff", fontWeight: "900" }}>Service options (optional)</Text>
            <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>
              If you offer services, choose how you deliver them.
            </Text>

            <ToggleRow label="Remote service" value={offersRemote} onToggle={() => setOffersRemote((v) => !v)} />
            <ToggleRow label="In-person service" value={offersInPerson} onToggle={() => setOffersInPerson((v) => !v)} />
          </View>

          {stage ? (
            <View style={{ marginTop: 12, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(255,255,255,0.06)", flexDirection: "row", alignItems: "center", gap: 10 }}>
              <ActivityIndicator color="#fff" />
              <Text style={{ color: "rgba(255,255,255,0.9)", fontWeight: "900" }}>{stage}</Text>
            </View>
          ) : null}

          <Text style={{ marginTop: 12, color: "rgba(255,255,255,0.55)", fontSize: 12, lineHeight: 18 }}>
            By creating a profile, you agree to follow marketplace rules. Verification comes later.
          </Text>
        </ScrollView>

        {/* Sticky footer button */}
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            paddingHorizontal: 16,
            paddingTop: 10,
            paddingBottom: Platform.OS === "ios" ? 24 : 16,
            backgroundColor: "rgba(5,4,11,0.92)",
            borderTopWidth: 1,
            borderTopColor: "rgba(255,255,255,0.08)",
          }}
        >
          <Pressable
            onPress={submit}
            disabled={!canSubmit}
            style={{
              borderRadius: 18,
              paddingVertical: 14,
              alignItems: "center",
              backgroundColor: PURPLE,
              borderWidth: 1,
              borderColor: PURPLE,
              opacity: canSubmit ? 1 : 0.55,
            }}
          >
            {loading ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <ActivityIndicator color="#fff" />
                <Text style={{ color: "#fff", fontWeight: "900" }}>Creating…</Text>
              </View>
            ) : (
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 15 }}>
                Create Profile
              </Text>
            )}
          </Pressable>

          {!canSubmit ? (
            <Text style={{ marginTop: 10, color: MUTED, fontSize: 12, textAlign: "center" }}>
              Enter a valid username and business name to continue.
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
    <View style={{ borderRadius: 22, padding: 14, borderWidth: 1, borderColor: border, backgroundColor: CARD }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
          <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="at-outline" size={18} color="rgba(255,255,255,0.85)" />
          </View>

          <View style={{ flex: 1 }}>
            <Text style={{ color: "#fff", fontWeight: "900" }}>Username</Text>
            <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.55)", fontSize: 12 }}>
              Lowercase, no spaces. We check availability automatically.
            </Text>
          </View>
        </View>

        <UsernameBadge status={props.nameStatus} />
      </View>

      <View
        style={{
          marginTop: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 12,
          borderRadius: 16,
          backgroundColor: "rgba(255,255,255,0.06)",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.10)",
        }}
      >
        <Text style={{ color: "rgba(255,255,255,0.65)", fontWeight: "900" }}>@</Text>
        <TextInput
          value={props.value}
          onChangeText={props.onChangeText}
          placeholder="bestcity_store"
          placeholderTextColor="rgba(255,255,255,0.35)"
          autoCapitalize="none"
          style={{
            flex: 1,
            color: "#fff",
            fontWeight: "900",
            fontSize: 14,
            paddingVertical: 12,
          }}
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
    available: { text: "Available", icon: "checkmark-circle-outline", border: "rgba(34,197,94,0.55)", bg: "rgba(34,197,94,0.12)", color: SUCCESS },
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
  invalid?: boolean;
}) {
  const border = props.invalid ? "rgba(239,68,68,0.55)" : BORDER;

  return (
    <View style={{ borderRadius: 22, padding: 14, borderWidth: 1, borderColor: border, backgroundColor: CARD }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {props.icon ? (
          <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" }}>
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
        style={{
          marginTop: 10,
          color: "#fff",
          fontWeight: "800",
          fontSize: 14,
          paddingVertical: 12,
          paddingHorizontal: 12,
          borderRadius: 16,
          backgroundColor: "rgba(255,255,255,0.06)",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.10)",
          minHeight: props.multiline ? 92 : undefined,
          textAlignVertical: props.multiline ? "top" : "auto",
        }}
      />
    </View>
  );
}

function ToggleRow(props: { label: string; value: boolean; onToggle: () => void }) {
  return (
    <Pressable
      onPress={props.onToggle}
      style={{
        marginTop: 12,
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
        backgroundColor: "rgba(255,255,255,0.04)",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <Text style={{ color: "#fff", fontWeight: "900" }}>{props.label}</Text>
      <View
        style={{
          width: 46,
          height: 28,
          borderRadius: 999,
          backgroundColor: props.value ? "rgba(124,58,237,0.65)" : "rgba(255,255,255,0.15)",
          borderWidth: 1,
          borderColor: props.value ? "rgba(124,58,237,0.85)" : "rgba(255,255,255,0.18)",
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
            alignSelf: props.value ? "flex-end" : "flex-start",
          }}
        />
      </View>
    </Pressable>
  );
}

