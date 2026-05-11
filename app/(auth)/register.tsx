import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Link, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
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
const AUTH_CONFIRM_REDIRECT =
  process.env.EXPO_PUBLIC_AUTH_CONFIRM_REDIRECT_URL ?? "bestcitypay://login";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

function TrustPill({ icon, label }: { icon: IconName; label: string }) {
  return (
    <View style={styles.trustPill}>
      <Ionicons name={icon} size={14} color={BRAND} />
      <Text style={styles.trustText}>{label}</Text>
    </View>
  );
}

export default function Register() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [noticeMsg, setNoticeMsg] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");

  const normalizedEmail = email.trim().toLowerCase();
  const canSubmit = useMemo(
    () => !!normalizedEmail && !!password && !!confirm,
    [normalizedEmail, password, confirm],
  );

  const handleRegister = async () => {
    if (loading) return;
    if (!canSubmit) return setErrorMsg("All fields are required");
    if (password !== confirm) return setErrorMsg("Passwords do not match");
    if (password.length < 6) return setErrorMsg("Password must be at least 6 characters");

    setLoading(true);
    setErrorMsg("");
    setNoticeMsg("");

    try {
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: AUTH_CONFIRM_REDIRECT,
        },
      });

      if (error) throw error;
      if (!data.user) throw new Error("Account could not be created");

      if (data.session) {
        await supabase.auth.signOut();
      }

      setPendingEmail(normalizedEmail);
      setPassword("");
      setConfirm("");
      setNoticeMsg("Confirmation email sent. Check your inbox before logging in.");
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const resendConfirmation = async () => {
    const targetEmail = pendingEmail || normalizedEmail;
    if (!targetEmail) return setErrorMsg("Enter your email first.");
    if (resending) return;

    setResending(true);
    setErrorMsg("");
    setNoticeMsg("");

    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: targetEmail,
        options: {
          emailRedirectTo: AUTH_CONFIRM_REDIRECT,
        },
      });
      if (error) throw error;
      setPendingEmail(targetEmail);
      setNoticeMsg("Confirmation email sent again. Check your inbox and spam folder.");
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Could not resend confirmation email");
    } finally {
      setResending(false);
    }
  };

  const goToLogin = () => {
    router.replace({
      pathname: "/(auth)/login",
      params: { email: pendingEmail || normalizedEmail, fromSignup: "1" },
    } as any);
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
                <Text style={styles.title}>{pendingEmail ? "Check your email" : "Create your account"}</Text>
                <Text style={styles.subtitle}>
                  {pendingEmail
                    ? "Confirm your signup before using your market account."
                    : "Join the green market experience for buying, selling, and escrow."}
                </Text>
              </View>
            </View>

            <View style={styles.trustRow}>
              <TrustPill icon="shield-checkmark-outline" label="Email protected" />
              <TrustPill icon="storefront-outline" label="Market ready" />
            </View>

            <View style={styles.card}>
              {!!noticeMsg && (
                <View style={styles.noticeBox}>
                  <Ionicons name="mail-unread-outline" size={17} color={BRAND} />
                  <Text style={styles.noticeText}>{noticeMsg}</Text>
                </View>
              )}

              {!!errorMsg && (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle-outline" size={17} color="#FCA5A5" />
                  <Text style={styles.errorText}>{errorMsg}</Text>
                </View>
              )}

              {pendingEmail ? (
                <>
                  <View style={styles.confirmIcon}>
                    <Ionicons name="mail-open-outline" size={30} color={BRAND} />
                  </View>
                  <Text style={styles.confirmTitle}>Verify your email address</Text>
                  <Text style={styles.confirmText}>
                    We sent a confirmation link to this email. Open it, confirm your account, then return to login.
                  </Text>
                  <View style={styles.emailPill}>
                    <Ionicons name="mail-outline" size={16} color={BRAND} />
                    <Text style={styles.emailPillText} numberOfLines={1}>
                      {pendingEmail}
                    </Text>
                  </View>

                  <Pressable style={styles.primaryBtn} onPress={() => Linking.openURL("mailto:")}>
                    <Ionicons name="open-outline" size={18} color={INK} />
                    <Text style={styles.primaryText}>Open email app</Text>
                  </Pressable>

                  <Pressable
                    onPress={resendConfirmation}
                    disabled={resending}
                    style={[styles.secondaryBtn, { opacity: resending ? 0.7 : 1 }]}
                  >
                    {resending ? (
                      <ActivityIndicator color={BRAND} />
                    ) : (
                      <>
                        <Ionicons name="refresh-outline" size={18} color={BRAND} />
                        <Text style={styles.secondaryText}>Resend confirmation</Text>
                      </>
                    )}
                  </Pressable>

                  <Pressable style={styles.ghostBtn} onPress={goToLogin}>
                    <Text style={styles.ghostText}>I confirmed my email</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={styles.label}>Email</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="you@domain.com"
                    placeholderTextColor={FAINT}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    value={email}
                    onChangeText={setEmail}
                  />

                  <Text style={styles.label}>Password</Text>
                  <View style={styles.passwordWrap}>
                    <TextInput
                      style={[styles.input, styles.passwordInput]}
                      placeholder="Create a password"
                      placeholderTextColor={FAINT}
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
                      placeholder="Repeat your password"
                      placeholderTextColor={FAINT}
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

                  <View style={styles.hintRow}>
                    <Ionicons name="shield-checkmark-outline" size={15} color={BRAND} />
                    <Text style={styles.hintText}>Use at least 6 characters. Email confirmation is required.</Text>
                  </View>

                  <Pressable
                    onPress={handleRegister}
                    disabled={loading}
                    style={[styles.primaryBtn, { opacity: loading ? 0.7 : 1 }]}
                  >
                    {loading ? (
                      <ActivityIndicator color={INK} />
                    ) : (
                      <>
                        <Ionicons name="person-add-outline" size={18} color={INK} />
                        <Text style={styles.primaryText}>Create account</Text>
                      </>
                    )}
                  </Pressable>

                  <View style={styles.footer}>
                    <Text style={styles.footerText}>Already registered?</Text>
                    <Link href="/(auth)/login" style={styles.footerLink}>
                      Login
                    </Link>
                  </View>
                </>
              )}
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
  trustRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  trustPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(45,212,191,0.08)",
  },
  trustText: {
    color: BRAND_SOFT,
    fontSize: 12,
    fontWeight: "800",
  },
  card: {
    backgroundColor: CARD,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
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
  hintRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 6,
  },
  hintText: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "800",
    flex: 1,
    lineHeight: 16,
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
  secondaryBtn: {
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    backgroundColor: "rgba(255,253,247,0.055)",
  },
  secondaryText: {
    color: "#FFFDF7",
    fontWeight: "900",
    fontSize: 12,
  },
  ghostBtn: {
    marginTop: 12,
    alignItems: "center",
    paddingVertical: 10,
  },
  ghostText: {
    color: BRAND,
    fontWeight: "900",
    fontSize: 13,
  },
  confirmIcon: {
    width: 60,
    height: 60,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    backgroundColor: "rgba(45,212,191,0.1)",
    borderWidth: 1,
    borderColor: BORDER_STRONG,
    marginTop: 4,
    marginBottom: 14,
  },
  confirmTitle: {
    color: "#FFFDF7",
    fontWeight: "900",
    fontSize: 20,
    textAlign: "center",
  },
  confirmText: {
    color: MUTED,
    marginTop: 8,
    textAlign: "center",
    lineHeight: 20,
    fontWeight: "700",
  },
  emailPill: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: BORDER_STRONG,
    backgroundColor: "rgba(45,212,191,0.08)",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  emailPillText: {
    color: BRAND_SOFT,
    fontWeight: "900",
    flex: 1,
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
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 17,
    gap: 6,
  },
  footerText: {
    color: MUTED,
  },
  footerLink: {
    color: BRAND,
    fontWeight: "900",
  },
});
