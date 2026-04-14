import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { supabase } from "@/services/supabase";
import { clearAdminSessionToken, hasStoredAdminSession, loadAdminOverview, loginAdmin, logoutAdmin, type MarketAdminOverview } from "@/services/market/admin";

const BG0 = "#0A0F1A";
const BG1 = "#122033";
const PANEL = "rgba(12,18,30,0.92)";
const PANEL_ALT = "rgba(255,255,255,0.05)";
const BORDER = "rgba(96,165,250,0.24)";
const TEXT = "#EAF2FF";
const MUTED = "rgba(234,242,255,0.7)";
const ACCENT = "#60A5FA";
const SUCCESS = "#34D399";
const WARNING = "#FBBF24";
const DANGER = "#F87171";

function ActionButton({
  icon,
  label,
  color,
  onPress,
  loading,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
  loading?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 12,
        backgroundColor: `${color}18`,
        borderWidth: 1,
        borderColor: `${color}30`,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      }}
    >
      {loading ? <ActivityIndicator color={color} /> : <Ionicons name={icon} size={16} color={color} />}
      <Text style={{ color, fontWeight: "900", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export default function MarketAdminIndex() {
  const insets = useSafeAreaInsets();
  const [booting, setBooting] = useState(true);
  const [checkingSession, setCheckingSession] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [membershipOk, setMembershipOk] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<MarketAdminOverview | null>(null);

  const visibleModules = useMemo(() => {
    const permissions = overview?.admin.permissions ?? [];
    return (overview?.modules ?? []).filter((module) => permissions.includes(module.permission) || overview?.admin.role_key === "super_admin");
  }, [overview]);

  async function checkMembershipAndMaybeLoad() {
    setError(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) {
        router.replace("/(auth)/login" as any);
        return;
      }

      const { data: member, error: memberErr } = await supabase
        .from("market_admin_users")
        .select("user_id,role_key,is_active")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (memberErr || !member) {
        setMembershipOk(false);
        setOverview(null);
        await clearAdminSessionToken();
        return;
      }

      setMembershipOk(true);
      if (!(await hasStoredAdminSession())) {
        setOverview(null);
        return;
      }

      setCheckingSession(true);
      const nextOverview = await loadAdminOverview();
      setOverview(nextOverview);
    } catch (e: any) {
      setError(String(e?.message || e || "Unable to load admin dashboard."));
      setOverview(null);
    } finally {
      setCheckingSession(false);
      setBooting(false);
    }
  }

  useEffect(() => {
    checkMembershipAndMaybeLoad();
  }, []);

  async function onUnlock() {
    setSubmitting(true);
    setError(null);
    try {
      await loginAdmin(password);
      setPassword("");
      const nextOverview = await loadAdminOverview();
      setOverview(nextOverview);
    } catch (e: any) {
      setError(String(e?.message || e || "Admin login failed."));
    } finally {
      setSubmitting(false);
    }
  }

  async function onLogout() {
    setCheckingSession(true);
    setError(null);
    try {
      await logoutAdmin();
      setOverview(null);
    } catch (e: any) {
      setError(String(e?.message || e || "Admin logout failed."));
    } finally {
      setCheckingSession(false);
    }
  }

  if (booting) {
    return (
      <LinearGradient colors={[BG1, BG0]} style={{ flex: 1 }}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <ActivityIndicator color={ACCENT} />
          <Text style={{ marginTop: 14, color: TEXT, fontWeight: "900", fontSize: 18 }}>Loading admin</Text>
        </View>
      </LinearGradient>
    );
  }

  if (!membershipOk) {
    return (
      <LinearGradient colors={[BG1, BG0]} style={{ flex: 1 }}>
        <View style={{ flex: 1, paddingTop: insets.top + 22, paddingHorizontal: 18 }}>
          <Pressable onPress={() => router.back()} style={{ alignSelf: "flex-start", paddingVertical: 10 }}>
            <Text style={{ color: ACCENT, fontWeight: "900" }}>Back</Text>
          </Pressable>
          <View style={{ marginTop: 36, borderRadius: 28, padding: 22, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER }}>
            <Ionicons name="lock-closed-outline" size={28} color={DANGER} />
            <Text style={{ marginTop: 16, color: TEXT, fontWeight: "900", fontSize: 24 }}>Admin access blocked</Text>
            <Text style={{ marginTop: 8, color: MUTED, fontSize: 14, lineHeight: 22 }}>
              This route only opens for accounts added to `market_admin_users` in Supabase.
            </Text>
          </View>
        </View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={[BG1, BG0]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 18, paddingHorizontal: 16, paddingBottom: 120 }}>
        <View style={{ maxWidth: 1180, width: "100%", alignSelf: "center" }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <View style={{ flex: 1, minWidth: 240 }}>
              <Text style={{ color: ACCENT, fontSize: 12, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.5 }}>Admin</Text>
              <Text style={{ marginTop: 10, color: TEXT, fontSize: 30, fontWeight: "900" }}>Marketplace control room</Text>
              <Text style={{ marginTop: 8, color: MUTED, fontSize: 13, lineHeight: 20 }}>
                Internal console for moderation, disputes, escrow operations, verification, and audit review.
              </Text>
            </View>

            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              <ActionButton icon="refresh" label={checkingSession ? "Syncing" : "Refresh"} color={ACCENT} loading={checkingSession} onPress={checkMembershipAndMaybeLoad} />
              {overview ? <ActionButton icon="log-out-outline" label="Lock" color={DANGER} onPress={onLogout} /> : null}
            </View>
          </View>

          {error ? (
            <View style={{ marginTop: 18, borderRadius: 20, padding: 16, backgroundColor: "rgba(248,113,113,0.12)", borderWidth: 1, borderColor: "rgba(248,113,113,0.25)" }}>
              <Text style={{ color: "#FECACA", fontWeight: "800" }}>{error}</Text>
            </View>
          ) : null}

          {!overview ? (
            <View style={{ marginTop: 20, borderRadius: 28, padding: 22, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER }}>
              <Text style={{ color: TEXT, fontSize: 23, fontWeight: "900" }}>Unlock admin session</Text>
              <Text style={{ marginTop: 8, color: MUTED, fontSize: 14, lineHeight: 22 }}>
                Your normal Supabase sign-in proves who you are. The second admin password in the database unlocks sensitive control actions.
              </Text>

              <View style={{ marginTop: 18, gap: 12 }}>
                <TextInput
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Enter admin password"
                  placeholderTextColor="rgba(234,242,255,0.38)"
                  style={{
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.12)",
                    backgroundColor: PANEL_ALT,
                    color: TEXT,
                    paddingHorizontal: 14,
                    paddingVertical: 14,
                    fontSize: 15,
                  }}
                />
                <ActionButton icon="shield-checkmark-outline" label={submitting ? "Unlocking" : "Unlock admin"} color={SUCCESS} loading={submitting} onPress={onUnlock} />
              </View>
            </View>
          ) : (
            <>
              <View style={{ marginTop: 20, borderRadius: 28, padding: 20, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER }}>
                <Text style={{ color: TEXT, fontSize: 22, fontWeight: "900" }}>{overview.admin.role_name}</Text>
                <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>
                  Role key: `{overview.admin.role_key}`. Access is controlled by `market_admin_users`, role grants come from `market_admin_roles`, and this unlocked session lives in `market_admin_sessions`.
                </Text>
              </View>

              <View style={{ marginTop: 16, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                {Object.entries(overview.metrics).map(([key, value]) => (
                  <View
                    key={key}
                    style={{
                      minWidth: 160,
                      flexGrow: 1,
                      borderRadius: 20,
                      padding: 16,
                      backgroundColor: PANEL_ALT,
                      borderWidth: 1,
                      borderColor: "rgba(255,255,255,0.08)",
                    }}
                  >
                    <Text style={{ color: TEXT, fontWeight: "900", fontSize: 24 }}>{value}</Text>
                    <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>{key.replace(/_/g, " ")}</Text>
                  </View>
                ))}
              </View>

              <View style={{ marginTop: 18, gap: 14 }}>
                {visibleModules.map((module) => (
                  <View
                    key={module.key}
                    style={{
                      borderRadius: 22,
                      padding: 18,
                      backgroundColor: PANEL,
                      borderWidth: 1,
                      borderColor: BORDER,
                    }}
                  >
                    <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>{module.title}</Text>
                    <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>{module.description}</Text>
                    <Text style={{ marginTop: 10, color: WARNING, fontWeight: "800", fontSize: 12 }}>
                      Required permission: {module.permission}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </LinearGradient>
  );
}
