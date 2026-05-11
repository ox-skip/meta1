import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Link, useLocalSearchParams } from "expo-router";
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
const PASSWORD_RESET_REDIRECT =
  process.env.EXPO_PUBLIC_PASSWORD_RESET_REDIRECT_URL ?? "bestcitypay://reset";

function paramValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? "";
}

export default function ForgotPassword() {
  const params = useLocalSearchParams<{ email?: string | string[] }>();

  const [email, setEmail] = useState("");
  const [sentEmail, setSentEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  useEffect(() => {
    const incomingEmail = paramValue(params.email);
    if (incomingEmail) setEmail(incomingEmail);
  }, [params.email]);

  const normalizedEmail = email.trim().toLowerCase();
  const canSubmit = useMemo(() => !!normalizedEmail, [normalizedEmail]);

  const sendReset = async () => {
    if (!canSubmit) return setErrorMsg("Email is required");
    if (loading) return;

    setErrorMsg("");
    setSuccessMsg("");
    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: PASSWORD_RESET_REDIRECT,
      });
      if (error) throw error;
      setSentEmail(normalizedEmail);
      setSuccessMsg("Password reset email sent. Check your inbox and spam folder.");
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Could not send reset email");
    } finally {
      setLoading(false);
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
                <Text style={styles.title}>Reset password</Text>
                <Text style={styles.subtitle}>Get a secure recovery link for your market account.</Text>
              </View>
            </View>

            <View style={styles.card}>
              {!!errorMsg && (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle-outline" size={17} color="#FCA5A5" />
                  <Text style={styles.errorText}>{errorMsg}</Text>
                </View>
              )}
              {!!successMsg && (
                <View style={styles.successBox}>
                  <Ionicons name="checkmark-circle-outline" size={17} color={BRAND} />
                  <Text style={styles.successText}>{successMsg}</Text>
                </View>
              )}

              {sentEmail ? (
                <>
                  <View style={styles.confirmIcon}>
                    <Ionicons name="mail-unread-outline" size={30} color={BRAND} />
                  </View>
                  <Text style={styles.confirmTitle}>Check your email</Text>
                  <Text style={styles.confirmText}>
                    Follow the reset link we sent. For your security, the link is time limited.
                  </Text>
                  <View style={styles.emailPill}>
                    <Ionicons name="mail-outline" size={16} color={BRAND} />
                    <Text style={styles.emailPillText} numberOfLines={1}>
                      {sentEmail}
                    </Text>
                  </View>

                  <Pressable style={styles.primaryBtn} onPress={() => Linking.openURL("mailto:")}>
                    <Ionicons name="open-outline" size={18} color={INK} />
                    <Text style={styles.primaryText}>Open email app</Text>
                  </Pressable>

                  <Pressable
                    onPress={sendReset}
                    disabled={loading}
                    style={[styles.secondaryBtn, { opacity: loading ? 0.7 : 1 }]}
                  >
                    {loading ? (
                      <ActivityIndicator color={BRAND} />
                    ) : (
                      <>
                        <Ionicons name="refresh-outline" size={18} color={BRAND} />
                        <Text style={styles.secondaryText}>Send again</Text>
                      </>
                    )}
                  </Pressable>

                  <View style={styles.footer}>
                    <Link href="/(auth)/login" style={styles.footerLink}>
                      Back to login
                    </Link>
                  </View>
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

                  <View style={styles.hintBox}>
                    <Ionicons name="lock-closed-outline" size={16} color={BRAND} />
                    <Text style={styles.hintText}>
                      We will send the reset link only if this email is registered.
                    </Text>
                  </View>

                  <Pressable
                    onPress={sendReset}
                    disabled={loading}
                    style={[styles.primaryBtn, { opacity: loading ? 0.7 : 1 }]}
                  >
                    {loading ? (
                      <ActivityIndicator color={INK} />
                    ) : (
                      <>
                        <Ionicons name="mail-outline" size={18} color={INK} />
                        <Text style={styles.primaryText}>Send reset link</Text>
                      </>
                    )}
                  </Pressable>

                  <View style={styles.footer}>
                    <Text style={styles.footerText}>Remembered your password?</Text>
                    <Link href="/(auth)/login" style={styles.footerLink}>
                      Back to login
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
  hintBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 11,
    borderRadius: 14,
    backgroundColor: "rgba(45,212,191,0.08)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  hintText: {
    color: MUTED,
    fontWeight: "800",
    fontSize: 12,
    lineHeight: 17,
    flex: 1,
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
  successBox: {
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
  successText: {
    color: BRAND_SOFT,
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
