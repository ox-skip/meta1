import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";

import { useAuth } from "@/hooks/authentication/useAuth";
import { recordAuthSessionNotification } from "@/services/market/notifications";
import { uploadToSupabaseStorage } from "@/services/market/storageUpload";
import { supabase } from "@/services/supabase";
import { isNigeriaCountry, resolveUserCountry, type UserCountry } from "@/utils/country";

const PRIMARY = "#2DD4BF";
const BG0 = "#090D0B";
const BG1 = "#07141A";

type VA = { account_number: string; bank_name: string; account_name: string } | null;

export default function ProfileRoute() {
  const { user, profile, loading } = useAuth();
  const [va, setVa] = useState<VA>(null);
  const [vaLoading, setVaLoading] = useState(false);
  const [vaErr, setVaErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [publicName, setPublicName] = useState("");
  const [userCountry, setUserCountry] = useState<UserCountry | null | undefined>(undefined);
  const isNigeria = isNigeriaCountry(userCountry?.code || userCountry?.name);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const c = await resolveUserCountry({ prompt: true });
        if (mounted) setUserCountry(c);
      } catch {
        if (mounted) setUserCountry(null);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    (async () => {
      if (!user?.id) return;
      if (userCountry === undefined) return;
      if (!isNigeria) {
        setVa(null);
        setVaErr(null);
        setVaLoading(false);
        return;
      }
      setVaLoading(true);
      setVaErr(null);
      const res = await supabase
        .from("user_virtual_accounts")
        .select("account_number, bank_name, account_name, active")
        .eq("user_id", user.id)
        .eq("active", true)
        .maybeSingle();

      if (!res.error && res.data) setVa(res.data as any);
      else {
        setVa(null);
        if (res.error) setVaErr(res.error.message);
      }
      setVaLoading(false);
    })();
  }, [user?.id, isNigeria, userCountry]);

  const name = profile?.full_name || profile?.username || "Account";
  const email = profile?.email || user?.email || "-";
  const uid = profile?.public_uid || "-";

  useEffect(() => {
    (async () => {
      if (!user?.id) return;
      const { data } = await supabase.from("profiles").select("username,full_name,public_uid,avatar_url").eq("id", user.id).maybeSingle();
      if (!data) return;
      setUsername(data.username ?? "");
      setDisplayName(data.full_name ?? "");
      setPublicName(data.username ?? "");
      setAvatarUrl((data as any).avatar_url ?? null);
    })();
  }, [user?.id]);

  async function pickAvatar() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow photo access to upload your avatar.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!res.canceled && res.assets?.[0]?.uri) {
      setAvatarUri(res.assets[0].uri);
    }
  }

  async function saveProfile() {
    if (!user?.id) return;
    if (saving) return;
    if (!username.trim()) {
      Alert.alert("Username required", "Please set a public username.");
      return;
    }
    setSaving(true);
    try {
      let nextAvatarUrl = avatarUrl;
      if (avatarUri) {
        const ext = avatarUri.split(".").pop() || "jpg";
        const path = `avatars/${user.id}_${Date.now()}.${ext}`;
        const up = await uploadToSupabaseStorage({
          bucket: "avatars",
          path,
          localUri: avatarUri,
          contentType: "image/jpeg",
        });
        nextAvatarUrl = up.publicUrl ?? null;
      }

      const { error } = await supabase
        .from("profiles")
        .update({
          username: username.trim(),
          full_name: displayName.trim() || null,
          avatar_url: nextAvatarUrl,
        })
        .eq("id", user.id);

      if (error) throw error;
      setAvatarUrl(nextAvatarUrl);
      setAvatarUri(null);
      setPublicName(username.trim());
      Alert.alert("Saved", "Your public profile has been updated.");
    } catch (e: any) {
      Alert.alert("Failed", e?.message ?? "Could not save profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <LinearGradient colors={[BG1, BG0]} start={{ x: 0.15, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
        <Pressable
          style={styles.iconBtn}
          onPress={() =>
            router.push({ pathname: "./wallet", params: { action: isNigeria ? "history" : "crypto" } } as any)
          }
        >
          <Ionicons name="wallet-outline" size={20} color="#fff" />
        </Pressable>
      </View>

      {loading ? <Text style={styles.dim}>Loading...</Text> : null}

      <View style={styles.card}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.line}>{email}</Text>
        <Text style={styles.line}>UID: {uid}</Text>

        {userCountry === undefined ? (
          <>
            <View style={styles.divider} />
            <Text style={styles.line}>Checking region settings...</Text>
          </>
        ) : isNigeria ? (
          <>
            <View style={styles.divider} />
            <Text style={styles.section}>Virtual Account</Text>
            <Text style={styles.line}>
              {vaLoading
                ? "Loading virtual account..."
                : va?.account_number
                ? `${va.account_number} - ${va.bank_name}`
                : vaErr
                ? "Unable to load virtual account"
                : "Not available yet (Paystack DVA disabled)"}
            </Text>
          </>
        ) : (
          <>
            <View style={styles.divider} />
            <Text style={styles.section}>Region Access</Text>
            <Text style={styles.line}>You are on crypto-only mode outside Nigeria.</Text>
          </>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Public profile</Text>
        <Text style={styles.line}>This is how others see you.</Text>

        <Pressable onPress={pickAvatar} style={styles.avatarRow}>
          <View style={styles.avatarWrap}>
            {avatarUri || avatarUrl ? (
              <Image source={{ uri: avatarUri || avatarUrl || "" }} style={{ width: 64, height: 64 }} />
            ) : (
              <Ionicons name="person-circle-outline" size={36} color="rgba(255,255,255,0.7)" />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#fff", fontWeight: "900" }}>Profile image</Text>
            <Text style={{ color: "rgba(255,255,255,0.55)", marginTop: 4, fontSize: 12 }}>Tap to change</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.7)" />
        </Pressable>

        <Text style={styles.label}>Public username</Text>
        <TextInput
          value={username}
          onChangeText={setUsername}
          placeholder="username"
          placeholderTextColor="rgba(255,255,255,0.35)"
          autoCapitalize="none"
          style={styles.input}
        />

        <Text style={styles.label}>Display name</Text>
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Your name"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
        />

        <Pressable
          onPress={saveProfile}
          disabled={saving}
          style={[styles.saveBtn, { opacity: saving ? 0.7 : 1 }]}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save changes</Text>}
        </Pressable>
        <Text style={styles.hint}>Public profile: @{publicName || "username"}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Account</Text>

        <Pressable
          style={styles.row}
          onPress={() =>
            router.push({ pathname: "./wallet", params: { action: isNigeria ? "history" : "crypto" } } as any)
          }
        >
          <Text style={styles.rowText}>{isNigeria ? "Wallet history" : "Crypto wallet"}</Text>
          <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.7)" />
        </Pressable>

        <Pressable
          style={styles.row}
          onPress={async () => {
            if (!email || email === "-") return;
            try {
              await supabase.auth.resetPasswordForEmail(email);
              Alert.alert("Password reset", "A reset link was sent to your email.");
            } catch (e: any) {
              Alert.alert("Failed", e?.message ?? "Could not send reset link.");
            }
          }}
        >
          <Text style={styles.rowText}>Change password</Text>
          <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.7)" />
        </Pressable>

        <Pressable style={styles.row} onPress={() => {}}>
          <Text style={styles.rowText}>KYC verification (coming soon)</Text>
          <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.7)" />
        </Pressable>

        <Pressable style={styles.row} onPress={() => {}}>
          <Text style={styles.rowText}>Support (coming soon)</Text>
          <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.7)" />
        </Pressable>
      </View>

      <Pressable
        style={styles.dangerBtn}
        onPress={async () => {
          await recordAuthSessionNotification("signed_out").catch(() => undefined);
          await supabase.auth.signOut();
          router.replace("/(auth)/login");
        }}
      >
        <Text style={styles.dangerText}>Sign out</Text>
      </Pressable>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 16, paddingTop: 14 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  title: { color: "#fff", fontSize: 24, fontWeight: "900" },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  dim: { color: "rgba(255,255,255,0.65)", marginTop: 6 },

  card: {
    marginTop: 12,
    backgroundColor: "rgba(255,253,247,0.055)",
    borderWidth: 1,
    borderColor: "rgba(255,253,247,0.1)",
    borderRadius: 8,
    padding: 16,
  },
  name: { color: "#fff", fontWeight: "900", fontSize: 18 },
  line: { color: "rgba(255,255,255,0.7)", marginTop: 6 },
  section: { color: "#fff", fontWeight: "900", marginTop: 4 },
  divider: { height: 1, backgroundColor: "rgba(255,255,255,0.08)", marginVertical: 12 },
  label: { color: "rgba(255,255,255,0.7)", fontWeight: "800", marginTop: 12, marginBottom: 6, fontSize: 12 },
  input: {
    backgroundColor: "rgba(255,253,247,0.055)",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    color: "#fff",
    borderWidth: 1,
    borderColor: "rgba(255,253,247,0.12)",
  },
  avatarRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
  },
  avatarWrap: {
    width: 64,
    height: 64,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "rgba(45,212,191,0.12)",
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtn: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: PRIMARY,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  saveText: { color: "#061311", fontWeight: "900" },
  hint: { marginTop: 8, color: "rgba(255,255,255,0.55)", fontSize: 12 },

  row: {
    height: 52,
    borderRadius: 8,
    paddingHorizontal: 14,
    marginTop: 10,
    backgroundColor: "rgba(255,253,247,0.055)",
    borderWidth: 1,
    borderColor: "rgba(255,253,247,0.1)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowText: { color: "#fff", fontWeight: "900" },

  dangerBtn: {
    marginTop: 16,
    height: 52,
    borderRadius: 8,
    backgroundColor: "rgba(45,212,191,0.13)",
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.34)",
    alignItems: "center",
    justifyContent: "center",
  },
  dangerText: { color: "#fff", fontWeight: "900" },
});
