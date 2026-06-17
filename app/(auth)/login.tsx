import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import * as SecureStore from "@/utils/secureStore";
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
import { authenticateWithDevice, getLocalAuthInfo } from "@/utils/localAuth";

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

const KEY_EMAIL = "auth_email";
const KEY_PASS = "auth_password";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

function paramValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? "";
}

function isEmailConfirmationError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("email not confirmed") ||
    normalized.includes("confirm your email") ||
    normalized.includes("email confirmation")
  );
}

function TrustPill({ icon, label }: { icon: IconName; label: string }) {
  return (
    <View style={styles.trustPill}>
      <Ionicons name={icon} size={14} color={BRAND} />
      <Text style={styles.trustText}>{label}</Text>
    </View>
  );
}

export default function Login() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    email?: string | string[];
    fromSignup?: string | string[];
    reset?: string | string[];
  }>();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [noticeMsg, setNoticeMsg] = useState("");
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(true);

  const [biometricReady, setBiometricReady] = useState(false);
  const [biometricEnrolled, setBiometricEnrolled] = useState(false);
  const [biometricHardware, setBiometricHardware] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState("Use Face ID / Passcode");

  useEffect(() => {
    const incomingEmail = paramValue(params.email);
    const fromSignup = paramValue(params.fromSignup) === "1";
    const resetComplete = paramValue(params.reset) === "1";

    if (incomingEmail) setEmail(incomingEmail);
    if (resetComplete) {
      setNoticeMsg("Password updated. Sign in with your new password.");
    } else if (fromSignup) {
      setNoticeMsg("After confirming your email, sign in here to continue.");
    }
  }, [params.email, params.fromSignup, params.reset]);

  useEffect(() => {
    (async () => {
      try {
        const info = await getLocalAuthInfo();
        const hasHardware = info.hasHardware;
        const enrolled = info.enrolled;
        const hasFace = info.hasFace;
        const hasFinger = info.hasFinger;

        if (hasFace) setBiometricLabel("Use Face ID / Passcode");
        else if (hasFinger) setBiometricLabel("Use Fingerprint / Passcode");
        else setBiometricLabel("Use Device Passcode");

        setBiometricHardware(hasHardware);
        setBiometricEnrolled(enrolled);
        setBiometricReady(hasHardware && enrolled);
      } catch {
        setBiometricReady(false);
      }
    })();
  }, []);

  const normalizedEmail = email.trim().toLowerCase();
  const canSubmit = useMemo(() => !!normalizedEmail && !!password, [normalizedEmail, password]);

  async function handleLogin() {
    if (loading) return;
    if (!canSubmit) return setErrorMsg("Email and password are required");

    setLoading(true);
    setErrorMsg("");
    setNoticeMsg("");
    setNeedsConfirmation(false);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (error) throw error;

      if (rememberDevice) {
        await SecureStore.setItemAsync(KEY_EMAIL, normalizedEmail);
        await SecureStore.setItemAsync(KEY_PASS, password);
      } else {
        await SecureStore.deleteItemAsync(KEY_EMAIL);
        await SecureStore.deleteItemAsync(KEY_PASS);
      }

      router.replace("/market/wallet-setup" as any);
    } catch (err: any) {
      const message = err?.message ?? "Login failed";
      if (isEmailConfirmationError(message)) {
        setNeedsConfirmation(true);
        setErrorMsg("Please confirm your email before logging in. You can resend the confirmation email below.");
      } else {
        setErrorMsg(message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResendConfirmation() {
    if (!normalizedEmail) return setErrorMsg("Enter your email first so we can resend the confirmation link.");
    if (resending) return;

    setResending(true);
    setErrorMsg("");
    setNoticeMsg("");

    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: normalizedEmail,
        options: {
          emailRedirectTo: AUTH_CONFIRM_REDIRECT,
        },
      });
      if (error) throw error;
      setNeedsConfirmation(true);
      setNoticeMsg("Confirmation email sent. Check your inbox and spam folder.");
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Could not resend confirmation email");
    } finally {
      setResending(false);
    }
  }

  async function handleBiometricLogin() {
    setErrorMsg("");
    setNoticeMsg("");
    if (!biometricReady) return;

    try {
      const auth = await authenticateWithDevice("Unlock to sign in");

      if (!auth.success) return;

      const savedEmail = await SecureStore.getItemAsync(KEY_EMAIL);
      const savedPass = await SecureStore.getItemAsync(KEY_PASS);

      if (!savedEmail || !savedPass) {
        setErrorMsg("No saved login. Sign in once to enable quick unlock.");
        return;
      }

      setLoading(true);
      const { error } = await supabase.auth.signInWithPassword({
        email: savedEmail,
        password: savedPass,
      });
      if (error) throw error;

      router.replace("/market/wallet-setup" as any);
    } catch (err: any) {
      const message = err?.message ?? "Quick unlock failed";
      if (isEmailConfirmationError(message)) {
        setNeedsConfirmation(true);
        setErrorMsg("Please confirm your email before using quick unlock.");
      } else {
        setErrorMsg(message);
      }
    } finally {
      setLoading(false);
    }
  }

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
                <Text style={styles.title}>Welcome back</Text>
                <Text style={styles.subtitle}>Secure sign-in for marketplace, wallet, and escrow.</Text>
              </View>
            </View>

            <View style={styles.trustRow}>
              <TrustPill icon="shield-checkmark-outline" label="Protected login" />
              <TrustPill icon="wallet-outline" label="Wallet ready" />
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
                onChangeText={(value) => {
                  setEmail(value);
                  setNeedsConfirmation(false);
                }}
              />

              <Text style={styles.label}>Password</Text>
              <View style={styles.passwordWrap}>
                <TextInput
                  style={[styles.input, styles.passwordInput]}
                  placeholder="Your password"
                  placeholderTextColor={FAINT}
                  secureTextEntry={!passwordVisible}
                  textContentType="password"
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

              <View style={styles.row}>
                <Pressable onPress={() => setRememberDevice((value) => !value)} style={styles.remember}>
                  <View style={[styles.checkbox, rememberDevice && styles.checkboxOn]}>
                    {rememberDevice ? <Ionicons name="checkmark" size={14} color={INK} /> : null}
                  </View>
                  <Text style={styles.rememberText}>Remember this device</Text>
                </Pressable>
                <Link
                  href={{
                    pathname: "/(auth)/forgot",
                    params: normalizedEmail ? { email: normalizedEmail } : {},
                  } as any}
                  style={styles.linkText}
                >
                  Forgot password?
                </Link>
              </View>

              {needsConfirmation ? (
                <Pressable
                  onPress={handleResendConfirmation}
                  disabled={resending}
                  style={[styles.confirmationBtn, { opacity: resending ? 0.7 : 1 }]}
                >
                  {resending ? (
                    <ActivityIndicator color={BRAND} />
                  ) : (
                    <>
                      <Ionicons name="mail-outline" size={18} color={BRAND} />
                      <Text style={styles.confirmationText}>Resend confirmation email</Text>
                    </>
                  )}
                </Pressable>
              ) : null}

              <Pressable
                onPress={handleLogin}
                disabled={loading}
                style={[styles.primaryBtn, { opacity: loading ? 0.7 : 1 }]}
              >
                {loading ? <ActivityIndicator color={INK} /> : <Text style={styles.primaryText}>Login</Text>}
              </Pressable>

              {biometricReady ? (
                <Pressable onPress={handleBiometricLogin} style={styles.secondaryBtn}>
                  <Ionicons name="finger-print" size={18} color={BRAND} />
                  <Text style={styles.secondaryText}>{biometricLabel}</Text>
                </Pressable>
              ) : biometricHardware ? (
                <Pressable onPress={() => Linking.openSettings()} style={styles.secondaryBtn}>
                  <Ionicons name="lock-closed-outline" size={18} color={BRAND} />
                  <Text style={styles.secondaryText}>
                    {biometricEnrolled ? "Enable biometric login" : "Set up Face ID / Fingerprint"}
                  </Text>
                </Pressable>
              ) : null}

              {!biometricReady && biometricHardware ? (
                <Text style={styles.helperText}>
                  Set up Face ID, fingerprint, or device passcode in your phone settings to use quick unlock.
                </Text>
              ) : null}

              <View style={styles.footer}>
                <Text style={styles.footerText}>New here?</Text>
                <Link href="/(auth)/register" style={styles.footerLink}>
                  Create account
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 6,
  },
  remember: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
  checkbox: {
    width: 19,
    height: 19,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(204,251,241,0.42)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  checkboxOn: {
    backgroundColor: BRAND,
    borderColor: BRAND,
  },
  rememberText: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "800",
  },
  linkText: {
    color: BRAND,
    fontWeight: "900",
    fontSize: 12,
  },
  primaryBtn: {
    marginTop: 15,
    backgroundColor: BRAND,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: BRAND,
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
    fontWeight: "800",
    fontSize: 12,
  },
  confirmationBtn: {
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER_STRONG,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    backgroundColor: "rgba(45,212,191,0.1)",
  },
  confirmationText: {
    color: BRAND,
    fontWeight: "900",
    fontSize: 12,
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
  helperText: {
    marginTop: 9,
    color: FAINT,
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
  },
});
