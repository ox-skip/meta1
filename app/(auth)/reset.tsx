import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Link, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { supabase } from "@/services/supabase";

const BG0 = "#060807";
const BG1 = "#10130E";
const BG2 = "#171A13";
const BRAND = "#2DD4BF";
const BRAND_SOFT = "#CCFBF1";
const INK = "#04130F";
const CARD = "rgba(255,253,247,0.075)";
const CARD_STRONG = "rgba(255,253,247,0.12)";
const BORDER = "rgba(204,251,241,0.16)";
const BORDER_STRONG = "rgba(45,212,191,0.36)";
const MUTED = "rgba(255,253,247,0.68)";
const FAINT = "rgba(255,253,247,0.48)";

function tokenParamsFromUrl(url: string) {
  const params = new URLSearchParams();
  const [, hash = ""] = url.split("#");
  const query = url.includes("?") ? url.split("?")[1]?.split("#")[0] ?? "" : "";

  new URLSearchParams(query).forEach((value, key) => params.set(key, value));
  new URLSearchParams(hash).forEach((value, key) => params.set(key, value));

  return params;
}

export default function ResetPassword() {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const [checkingLink, setCheckingLink] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [noticeMsg, setNoticeMsg] = useState("");

  const canSubmit = useMemo(() => !!password && !!confirm, [password, confirm]);

  useEffect(() => {
    let mounted = true;

    async function hydrateRecoverySession(url: string | null) {
      if (!mounted) return;
      setCheckingLink(true);
      setErrorMsg("");

      try {
        if (url) {
          const params = tokenParamsFromUrl(url);
          const accessToken = params.get("access_token");
          const refreshToken = params.get("refresh_token");
          const code = params.get("code");

          if (code) {
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) throw error;
            if (mounted) {
              setReady(true);
              setNoticeMsg("Reset link verified. Create a new password.");
            }
            return;
          }

          if (accessToken && refreshToken) {
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (error) throw error;
            if (mounted) {
              setReady(true);
              setNoticeMsg("Reset link verified. Create a new password.");
            }
            return;
          }
        }

        const { data } = await supabase.auth.getSession();
        if (mounted && data.session) {
          setReady(true);
          setNoticeMsg("Create a new password for your account.");
          return;
        }

        if (mounted) {
          setReady(false);
          setErrorMsg("Open the password reset link from your email to continue.");
        }
      } catch (err: any) {
        if (mounted) {
          setReady(false);
          setErrorMsg(err?.message ?? "Could not verify reset link");
        }
      } finally {
        if (mounted) setCheckingLink(false);
      }
    }

    Linking.getInitialURL()
      .then((url) => hydrateRecoverySession(url))
      .catch(() => hydrateRecoverySession(null));

    const linkSubscription = Linking.addEventListener("url", ({ url }) => {
      void hydrateRecoverySession(url);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true);
        setCheckingLink(false);
        setNoticeMsg("Reset link verified. Create a new password.");
      }
    });

    return () => {
      mounted = false;
      linkSubscription.remove();
      authListener.subscription.unsubscribe();
    };
  }, []);

  const updatePassword = async () => {
    if (saving) return;
    if (!ready) return setErrorMsg("Open the password reset link from your email first.");
    if (!canSubmit) return setErrorMsg("New password and confirmation are required");
    if (password !== confirm) return setErrorMsg("Passwords do not match");
    if (password.length < 6) return setErrorMsg("Password must be at least 6 characters");

    setSaving(true);
    setErrorMsg("");
    setNoticeMsg("");

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      await supabase.auth.signOut();
      router.replace({
        pathname: "/(auth)/login",
        params: { reset: "1" },
      } as any);
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Could not update password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <LinearGradient colors={[BG0, BG1, BG2]} style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboard}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.shell}>
            <View style={styles.brandBlock}>
              <Image source={require("../../assets/images/icon.png")} style={styles.logo} />
              <View style={styles.brandCopy}>
                <Text style={styles.eyebrow}>Best City Market</Text>
                <Text style={styles.title}>Create new password</Text>
                <Text style={styles.subtitle}>Finish your secure account recovery.</Text>
              </View>
            </View>

            <View style={styles.card}>
              {checkingLink ? (
                <View style={styles.loadingBox}>
                  <ActivityIndicator color={BRAND} />
                  <Text style={styles.loadingText}>Verifying reset link...</Text>
                </View>
              ) : null}

              {!!noticeMsg && (
                <View style={styles.noticeBox}>
                  <Ionicons name="checkmark-circle-outline" size={17} color={BRAND} />
                  <Text style={styles.noticeText}>{noticeMsg}</Text>
                </View>
              )}

              {!!errorMsg && (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle-outline" size={17} color="#FCA5A5" />
                  <Text style={styles.errorText}>{errorMsg}</Text>
                </View>
              )}

              <Text style={styles.label}>New password</Text>
              <View style={styles.passwordWrap}>
                <TextInput
                  style={[styles.input, styles.passwordInput]}
                  placeholder="Create a new password"
                  placeholderTextColor={FAINT}
                  editable={ready && !checkingLink}
                  secureTextEntry={!passwordVisible}
                  textContentType="newPassword"
                  value={password}
                  onChangeText={setPassword}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={passwordVisible ? "Hide password" : "Show password"}
                  style={styles.eye}
                  onPress={() => setPasswordVisible((value) => !value)}
                >
                  <Ionicons name={passwordVisible ? "eye-off" : "eye"} size={18} color={BRAND_SOFT} />
                </Pressable>
              </View>

              <Text style={styles.label}>Confirm password</Text>
              <View style={styles.passwordWrap}>
                <TextInput
                  style={[styles.input, styles.passwordInput]}
                  placeholder="Repeat new password"
                  placeholderTextColor={FAINT}
                  editable={ready && !checkingLink}
                  secureTextEntry={!confirmVisible}
                  textContentType="newPassword"
                  value={confirm}
                  onChangeText={setConfirm}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={confirmVisible ? "Hide password" : "Show password"}
                  style={styles.eye}
                  onPress={() => setConfirmVisible((value) => !value)}
                >
                  <Ionicons name={confirmVisible ? "eye-off" : "eye"} size={18} color={BRAND_SOFT} />
                </Pressable>
              </View>

              <Pressable
                onPress={updatePassword}
                disabled={saving || checkingLink}
                style={[styles.primaryBtn, { opacity: saving || checkingLink ? 0.7 : 1 }]}
              >
                {saving ? (
                  <ActivityIndicator color={INK} />
                ) : (
                  <>
                    <Ionicons name="key-outline" size={18} color={INK} />
                    <Text style={styles.primaryText}>Update password</Text>
                  </>
                )}
              </Pressable>

              <View style={styles.footer}>
                <Link href="/(auth)/forgot" style={styles.footerLink}>
                  Request a new link
                </Link>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  keyboard: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 28,
  },
  shell: {
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
  },
  brandBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 16,
  },
  logo: {
    width: 58,
    height: 58,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER_STRONG,
  },
  brandCopy: {
    flex: 1,
  },
  eyebrow: {
    color: BRAND,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  title: {
    color: "#FFFDF7",
    fontSize: 27,
    fontWeight: "900",
    marginTop: 4,
  },
  subtitle: {
    color: MUTED,
    marginTop: 5,
    fontSize: 13,
    lineHeight: 18,
  },
  card: {
    backgroundColor: CARD,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
  },
  loadingBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    padding: 11,
    borderRadius: 14,
    backgroundColor: "rgba(45,212,191,0.08)",
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 10,
  },
  loadingText: {
    color: BRAND_SOFT,
    fontWeight: "800",
    fontSize: 12,
  },
  label: {
    color: BRAND_SOFT,
    fontWeight: "900",
    marginTop: 10,
    marginBottom: 7,
    fontSize: 12,
  },
  input: {
    minHeight: 48,
    backgroundColor: CARD_STRONG,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    color: "#FFFDF7",
    borderWidth: 1,
    borderColor: "rgba(255,253,247,0.12)",
    marginBottom: 12,
  },
  passwordWrap: {
    position: "relative",
  },
  passwordInput: {
    paddingRight: 46,
  },
  eye: {
    position: "absolute",
    right: 12,
    top: 13,
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtn: {
    marginTop: 15,
    backgroundColor: BRAND,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: BRAND,
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  primaryText: {
    color: INK,
    fontWeight: "900",
    fontSize: 15,
  },
  noticeBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 11,
    borderRadius: 14,
    backgroundColor: "rgba(45,212,191,0.11)",
    borderWidth: 1,
    borderColor: BORDER_STRONG,
    marginBottom: 10,
  },
  noticeText: {
    color: BRAND_SOFT,
    fontWeight: "800",
    fontSize: 12,
    lineHeight: 17,
    flex: 1,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 11,
    borderRadius: 14,
    backgroundColor: "rgba(239,68,68,0.12)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.25)",
    marginBottom: 10,
  },
  errorText: {
    color: "#FCA5A5",
    fontWeight: "800",
    fontSize: 12,
    lineHeight: 17,
    flex: 1,
  },
  footer: {
    alignItems: "center",
    marginTop: 17,
  },
  footerLink: {
    color: BRAND,
    fontWeight: "900",
  },
});
