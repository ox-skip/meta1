import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, usePathname } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { useOnboardingState } from "@/components/onboarding/InAppTutorial";
import {
  clearMarketProfileCompletionReminder,
  getMarketProfileCompletionReminderLabel,
  getMarketProfileCompletionStage,
  loadMarketProfileCompletionReminder,
  scheduleMarketProfileCompletionReminder,
  shouldShowMarketProfileCompletionPrompt,
  type MarketProfileCompletionReminderOption,
  type MarketProfileCompletionStage,
} from "@/services/market/profileCompletionPrompt";
import { supabase } from "@/services/supabase";

type SellerProfileStatus = {
  user_id: string;
  is_verified: boolean;
} | null;

const REMINDER_OPTIONS: MarketProfileCompletionReminderOption[] = ["3_days", "1_week", "1_month"];

function isPromptEligibleRoute(pathname: string) {
  return (
    pathname === "/market" ||
    pathname === "/market/account" ||
    pathname === "/market/sell" ||
    pathname === "/market/orders" ||
    pathname === "/market/category" ||
    pathname === "/market/menu"
  );
}

function isStageSuppressedOnRoute(stage: MarketProfileCompletionStage, pathname: string) {
  if (stage === "create_profile") return pathname.includes("/market/profile/create");
  if (stage === "verify_profile") return pathname.includes("/market/verification");
  return false;
}

export default function MarketProfileCompletionPrompt() {
  const pathname = usePathname();
  const { activeFlowKey, hydrated } = useOnboardingState();

  const [visible, setVisible] = useState(false);
  const [stage, setStage] = useState<MarketProfileCompletionStage | null>(null);
  const [busyAction, setBusyAction] = useState<"primary" | MarketProfileCompletionReminderOption | null>(null);

  const refreshNonceRef = useRef(0);

  const content = useMemo(() => {
    if (stage === "create_profile") {
      return {
        pill: "Market setup",
        title: "Create your market profile",
        body:
          "You do not have a seller profile yet. Create one now so buyers can find you and you can start listing in the market.",
        primaryLabel: "Create profile",
        primaryRoute: "/market/profile/create",
        icon: "storefront-outline" as const,
        accent: "#2DD4BF",
      };
    }

    if (stage === "verify_profile") {
      return {
        pill: "Verification",
        title: "Verify your seller profile",
        body:
          "Your market profile is live, but it is not verified yet. Start verification now or we can remind you again later.",
        primaryLabel: "Verify now",
        primaryRoute: "/market/verification/apply",
        icon: "shield-checkmark-outline" as const,
        accent: "#2DD4BF",
      };
    }

    return null;
  }, [stage]);

  const refreshPromptState = useCallback(async () => {
    if (!hydrated) {
      setVisible(false);
      return;
    }

    const refreshId = ++refreshNonceRef.current;

    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;

      if (!user) {
        if (refreshId !== refreshNonceRef.current) return;
        setStage(null);
        setVisible(false);
        return;
      }

      const { data, error } = await supabase
        .from("market_seller_profiles")
        .select("user_id,is_verified")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        if (refreshId !== refreshNonceRef.current) return;
        setStage(null);
        setVisible(false);
        return;
      }

      const profile = (data as SellerProfileStatus) ?? null;
      const nextStage = getMarketProfileCompletionStage(profile);

      if (!nextStage) {
        await clearMarketProfileCompletionReminder(user.id).catch(() => undefined);
        if (refreshId !== refreshNonceRef.current) return;
        setStage(null);
        setVisible(false);
        return;
      }

      const reminder = await loadMarketProfileCompletionReminder(user.id);
      const due = shouldShowMarketProfileCompletionPrompt({
        stage: nextStage,
        reminder,
      });
      const blockedByRoute = !isPromptEligibleRoute(pathname) || isStageSuppressedOnRoute(nextStage, pathname);
      const blockedByOnboarding = Boolean(activeFlowKey);

      if (refreshId !== refreshNonceRef.current) return;

      setStage(nextStage);
      setVisible(due && !blockedByRoute && !blockedByOnboarding);
    } catch {
      if (refreshId !== refreshNonceRef.current) return;
      setStage(null);
      setVisible(false);
    }
  }, [activeFlowKey, hydrated, pathname]);

  useEffect(() => {
    void refreshPromptState();
  }, [refreshPromptState]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void refreshPromptState();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [refreshPromptState]);

  async function handlePrimary() {
    if (!content || busyAction) return;
    setBusyAction("primary");
    setVisible(false);
    router.push(content.primaryRoute as any);
    setBusyAction(null);
  }

  async function handleRemind(option: MarketProfileCompletionReminderOption) {
    if (!stage || busyAction) return;
    setBusyAction(option);

    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) return;

      await scheduleMarketProfileCompletionReminder({
        userId: user.id,
        stage,
        option,
      });
      setVisible(false);
    } catch (error: any) {
      Alert.alert("Could not save reminder", String(error?.message || "Please try again."));
    } finally {
      setBusyAction(null);
    }
  }

  if (!visible || !content) return null;

  return (
    <Modal animationType="fade" onRequestClose={() => undefined} transparent visible={visible}>
      <View style={styles.backdrop}>
        <LinearGradient
          colors={["#171A13", "#10130E", "#060807"]}
          start={{ x: 0.12, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={styles.card}
        >
          <View style={[styles.iconWrap, { borderColor: `${content.accent}55`, backgroundColor: `${content.accent}22` }]}>
            <Ionicons color="#FFFFFF" name={content.icon} size={22} />
          </View>

          <View style={[styles.pill, { borderColor: `${content.accent}55`, backgroundColor: `${content.accent}18` }]}>
            <Text style={styles.pillText}>{content.pill}</Text>
          </View>

          <Text style={styles.title}>{content.title}</Text>
          <Text style={styles.body}>{content.body}</Text>

          <Pressable
            onPress={handlePrimary}
            style={[styles.primaryButton, { borderColor: `${content.accent}88`, backgroundColor: `${content.accent}33` }]}
          >
            <Text style={styles.primaryButtonText}>
              {busyAction === "primary" ? "Opening..." : content.primaryLabel}
            </Text>
          </Pressable>

          <Text style={styles.remindLabel}>Remind me again in</Text>

          <View style={styles.remindRow}>
            {REMINDER_OPTIONS.map((option) => {
              const isBusy = busyAction === option;
              return (
                <Pressable
                  key={option}
                  onPress={() => handleRemind(option)}
                  style={styles.remindButton}
                >
                  <Text style={styles.remindButtonText}>
                    {isBusy ? "Saving..." : getMarketProfileCompletionReminderLabel(option)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </LinearGradient>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(2,6,4,0.72)",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 26,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  iconWrap: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  pill: {
    alignSelf: "flex-start",
    marginTop: 16,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
  },
  pillText: {
    color: "#CCFBF1",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  title: {
    marginTop: 14,
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "900",
  },
  body: {
    marginTop: 10,
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
    lineHeight: 21,
  },
  primaryButton: {
    marginTop: 18,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
  remindLabel: {
    marginTop: 18,
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
    fontWeight: "800",
  },
  remindRow: {
    marginTop: 10,
    gap: 10,
  },
  remindButton: {
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
  },
  remindButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
});
