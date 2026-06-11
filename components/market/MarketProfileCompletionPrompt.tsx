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

type IconName = React.ComponentProps<typeof Ionicons>["name"];

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
        pill: "Get started",
        title: "Set up your storefront",
        body:
          "Create a public storefront so buyers can recognize your brand, browse your offers, and contact you from one trusted place.",
        benefits: [
          { icon: "search-outline" as IconName, text: "Appear in market discovery" },
          { icon: "bag-handle-outline" as IconName, text: "Publish listings under your brand" },
        ],
        primaryLabel: "Set up storefront",
        primaryRoute: "/market/profile/create",
        icon: "storefront-outline" as const,
        accent: "#2DD4BF",
      };
    }

    if (stage === "verify_profile") {
      return {
        pill: "Trust badge",
        title: "Earn your verified badge",
        body:
          "Complete a secure identity check to strengthen buyer confidence and show that your storefront has been reviewed.",
        benefits: [
          { icon: "shield-checkmark-outline" as IconName, text: "Display a verified badge" },
          { icon: "sparkles-outline" as IconName, text: "Build trust before checkout" },
        ],
        primaryLabel: "Continue verification",
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
          colors={["#071211", "#10130E", "#171A13"]}
          start={{ x: 0.12, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={styles.card}
        >
          <View style={styles.headerRow}>
            <View style={[styles.iconWrap, { borderColor: `${content.accent}55`, backgroundColor: `${content.accent}22` }]}>
              <Ionicons color="#FFFFFF" name={content.icon} size={20} />
            </View>
            <View style={[styles.pill, { borderColor: `${content.accent}55`, backgroundColor: `${content.accent}18` }]}>
              <Text style={styles.pillText}>{content.pill}</Text>
            </View>
          </View>

          <Text style={styles.title}>{content.title}</Text>
          <Text style={styles.body}>{content.body}</Text>

          <View style={styles.benefitList}>
            {content.benefits.map((benefit) => (
              <View key={benefit.text} style={styles.benefitItem}>
                <Ionicons name={benefit.icon} size={14} color={content.accent} />
                <Text style={styles.benefitText}>{benefit.text}</Text>
              </View>
            ))}
          </View>

          <Pressable
            onPress={handlePrimary}
            style={[styles.primaryButton, { borderColor: `${content.accent}88`, backgroundColor: `${content.accent}33` }]}
          >
            <Text style={styles.primaryButtonText}>
              {busyAction === "primary" ? "Opening..." : content.primaryLabel}
            </Text>
          </Pressable>

          <Text style={styles.remindLabel}>Remind me later</Text>

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
    backgroundColor: "rgba(2,6,4,0.62)",
    alignItems: "center",
    justifyContent: "flex-end",
    padding: 14,
  },
  card: {
    width: "100%",
    maxWidth: 390,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    shadowColor: "#000",
    shadowOpacity: 0.34,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 14,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  pill: {
    alignSelf: "flex-start",
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
    fontSize: 21,
    lineHeight: 25,
    fontWeight: "900",
  },
  body: {
    marginTop: 8,
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    lineHeight: 19,
  },
  benefitList: {
    marginTop: 13,
    gap: 8,
  },
  benefitItem: {
    minHeight: 36,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  benefitText: {
    flex: 1,
    color: "rgba(255,255,255,0.82)",
    fontSize: 12,
    fontWeight: "850",
  },
  primaryButton: {
    marginTop: 15,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: "center",
    borderWidth: 1,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
  remindLabel: {
    marginTop: 14,
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
    fontWeight: "800",
  },
  remindRow: {
    marginTop: 9,
    flexDirection: "row",
    gap: 8,
  },
  remindButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 8,
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
