import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { TutorialFlowDefinition } from "@/services/onboarding/definitions";
import { recordOnboardingEvent } from "@/services/onboarding/events";

const STORAGE_PREFIX = "meta:onboarding/session/";

type OnboardingContextValue = {
  activeFlowKey: string | null;
  hydrated: boolean;
  claimFlow: (flowKey: string) => boolean;
  dismissFlow: (params: {
    flow: TutorialFlowDefinition;
    status: "completed" | "skipped";
    completedSteps: number;
  }) => void;
  hasSeenFlow: (flowKey: string) => boolean;
  releaseFlow: (flowKey: string) => void;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

function getStorageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`;
}

function normalizeStoredFlows(raw: string | null): Record<string, true> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return {};
    return parsed.reduce<Record<string, true>>((acc, value) => {
      if (typeof value === "string" && value.trim()) {
        acc[value] = true;
      }
      return acc;
    }, {});
  } catch {
    return {};
  }
}

export function OnboardingProvider({
  children,
  userId,
}: {
  children: React.ReactNode;
  userId: string | null;
}) {
  const [hydrated, setHydrated] = useState(false);
  const [activeFlowKey, setActiveFlowKey] = useState<string | null>(null);
  const [seenFlows, setSeenFlows] = useState<Record<string, true>>({});

  const activeFlowRef = useRef<string | null>(null);
  const seenFlowsRef = useRef<Record<string, true>>({});
  const prevUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    seenFlowsRef.current = seenFlows;
  }, [seenFlows]);

  useEffect(() => {
    let cancelled = false;
    const prevUserId = prevUserIdRef.current;
    prevUserIdRef.current = userId;

    activeFlowRef.current = null;
    setActiveFlowKey(null);

    if (prevUserId && prevUserId !== userId) {
      void AsyncStorage.removeItem(getStorageKey(prevUserId)).catch(() => undefined);
    }

    if (!userId) {
      setSeenFlows({});
      setHydrated(true);
      return () => {
        cancelled = true;
      };
    }

    setHydrated(false);

    void AsyncStorage.getItem(getStorageKey(userId))
      .then((raw) => {
        if (cancelled) return;
        setSeenFlows(normalizeStoredFlows(raw));
        setHydrated(true);
      })
      .catch(() => {
        if (cancelled) return;
        setSeenFlows({});
        setHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || !hydrated) return;
    const nextValue = JSON.stringify(Object.keys(seenFlows).sort());
    void AsyncStorage.setItem(getStorageKey(userId), nextValue).catch(() => undefined);
  }, [hydrated, seenFlows, userId]);

  const hasSeenFlow = useCallback((flowKey: string) => {
    return !!seenFlowsRef.current[flowKey];
  }, []);

  const claimFlow = useCallback((flowKey: string) => {
    if (seenFlowsRef.current[flowKey]) return false;
    if (activeFlowRef.current && activeFlowRef.current !== flowKey) return false;
    if (activeFlowRef.current !== flowKey) {
      activeFlowRef.current = flowKey;
      setActiveFlowKey(flowKey);
    }
    return true;
  }, []);

  const releaseFlow = useCallback((flowKey: string) => {
    if (activeFlowRef.current !== flowKey) return;
    activeFlowRef.current = null;
    setActiveFlowKey(null);
  }, []);

  const dismissFlow = useCallback(
    ({
      flow,
      status,
      completedSteps,
    }: {
      flow: TutorialFlowDefinition;
      status: "completed" | "skipped";
      completedSteps: number;
    }) => {
      setSeenFlows((current) => {
        if (current[flow.key]) return current;
        return { ...current, [flow.key]: true };
      });
      releaseFlow(flow.key);

      if (!userId) return;
      void recordOnboardingEvent({
        userId,
        flowKey: flow.key,
        flowTitle: flow.title,
        status,
        completedSteps,
        totalSteps: flow.steps.length,
      });
    },
    [releaseFlow, userId],
  );

  const value = useMemo<OnboardingContextValue>(
    () => ({
      activeFlowKey,
      hydrated,
      claimFlow,
      dismissFlow,
      hasSeenFlow,
      releaseFlow,
    }),
    [activeFlowKey, claimFlow, dismissFlow, hasSeenFlow, hydrated, releaseFlow],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

function useOnboardingContext() {
  const value = useContext(OnboardingContext);
  if (!value) {
    throw new Error("InAppTutorial must be used inside OnboardingProvider.");
  }
  return value;
}

export function InAppTutorial({
  enabled = true,
  flow,
}: {
  enabled?: boolean;
  flow: TutorialFlowDefinition;
}) {
  const {
    activeFlowKey,
    hydrated,
    claimFlow,
    dismissFlow,
    hasSeenFlow,
    releaseFlow,
  } = useOnboardingContext();

  const [stepIndex, setStepIndex] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    if (!hydrated) return;
    if (visible) return;
    if (hasSeenFlow(flow.key)) return;
    if (activeFlowKey && activeFlowKey !== flow.key) return;
    if (claimFlow(flow.key)) {
      setStepIndex(0);
      setVisible(true);
    }
  }, [activeFlowKey, claimFlow, enabled, flow.key, hasSeenFlow, hydrated, visible]);

  useEffect(() => {
    if (enabled) return;
    if (!visible) return;
    setVisible(false);
    releaseFlow(flow.key);
  }, [enabled, flow.key, releaseFlow, visible]);

  useEffect(() => {
    return () => {
      releaseFlow(flow.key);
    };
  }, [flow.key, releaseFlow]);

  const totalSteps = flow.steps.length;
  const currentStep = flow.steps[stepIndex];

  function handleSkip() {
    setVisible(false);
    dismissFlow({
      flow,
      status: "skipped",
      completedSteps: stepIndex + 1,
    });
  }

  function handleBack() {
    setStepIndex((current) => Math.max(0, current - 1));
  }

  function handleNext() {
    if (stepIndex >= totalSteps - 1) {
      setVisible(false);
      dismissFlow({
        flow,
        status: "completed",
        completedSteps: totalSteps,
      });
      return;
    }
    setStepIndex((current) => current + 1);
  }

  if (!visible || !currentStep) return null;

  return (
    <Modal
      animationType="fade"
      onRequestClose={handleSkip}
      transparent
      visible={visible}
    >
      <View style={styles.backdrop}>
        <View style={styles.cardShell}>
          <LinearGradient
            colors={["#071220", "#0D1528"]}
            start={{ x: 0.15, y: 0 }}
            end={{ x: 0.85, y: 1 }}
            style={styles.card}
          >
            <View style={styles.topRow}>
              <View style={styles.kickerPill}>
                <Text style={styles.kickerText}>In-app tutorial</Text>
              </View>
              <Pressable onPress={handleSkip} hitSlop={8}>
                <Text style={styles.skipText}>Skip tutorial</Text>
              </Pressable>
            </View>

            <Text style={styles.flowTitle}>{flow.title}</Text>
            <Text style={styles.progressText}>
              Step {stepIndex + 1} of {totalSteps}
            </Text>

            <View style={styles.progressRow}>
              {flow.steps.map((step, index) => {
                const active = index === stepIndex;
                const done = index < stepIndex;
                return (
                  <View
                    key={`${flow.key}-${step.title}-${index}`}
                    style={[
                      styles.progressDot,
                      done ? styles.progressDotDone : null,
                      active ? styles.progressDotActive : null,
                    ]}
                  />
                );
              })}
            </View>

            <View style={styles.stepCard}>
              <Text style={styles.stepLabel}>What to do here</Text>
              <Text style={styles.stepTitle}>{currentStep.title}</Text>
              <Text style={styles.stepBody}>{currentStep.body}</Text>
            </View>

            <View style={styles.footerRow}>
              <Pressable
                disabled={stepIndex === 0}
                onPress={handleBack}
                style={[
                  styles.secondaryButton,
                  stepIndex === 0 ? styles.secondaryButtonDisabled : null,
                ]}
              >
                <Text style={styles.secondaryButtonText}>Back</Text>
              </Pressable>

              <Pressable onPress={handleNext} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>
                  {stepIndex === totalSteps - 1 ? "Done" : "Next"}
                </Text>
              </Pressable>
            </View>
          </LinearGradient>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(2,6,23,0.72)",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  cardShell: {
    width: "100%",
    maxWidth: 430,
  },
  card: {
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  kickerPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(45,212,191,0.14)",
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.3)",
  },
  kickerText: {
    color: "#CCFBF1",
    fontWeight: "800",
    fontSize: 11,
  },
  skipText: {
    color: "rgba(255,255,255,0.72)",
    fontWeight: "800",
    fontSize: 12,
  },
  flowTitle: {
    marginTop: 16,
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 24,
  },
  progressText: {
    marginTop: 6,
    color: "rgba(255,255,255,0.62)",
    fontSize: 12,
    fontWeight: "700",
  },
  progressRow: {
    marginTop: 14,
    flexDirection: "row",
    gap: 8,
  },
  progressDot: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  progressDotDone: {
    backgroundColor: "rgba(45,212,191,0.45)",
  },
  progressDotActive: {
    backgroundColor: "#2DD4BF",
  },
  stepCard: {
    marginTop: 18,
    borderRadius: 18,
    padding: 16,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  stepLabel: {
    color: "rgba(191,219,254,0.92)",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  stepTitle: {
    marginTop: 10,
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
  },
  stepBody: {
    marginTop: 8,
    color: "rgba(255,255,255,0.74)",
    fontSize: 14,
    lineHeight: 21,
  },
  footerRow: {
    marginTop: 18,
    flexDirection: "row",
    gap: 10,
  },
  secondaryButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  secondaryButtonDisabled: {
    opacity: 0.45,
  },
  secondaryButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  primaryButton: {
    flex: 1.3,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(45,212,191,0.28)",
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.5)",
  },
  primaryButtonText: {
    color: "#ECFEFF",
    fontSize: 14,
    fontWeight: "900",
  },
});
