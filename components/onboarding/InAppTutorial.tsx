import { Ionicons } from "@expo/vector-icons";
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
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";

import { explainOnboardingStep, type OnboardingAiMode } from "@/services/onboarding/ai";
import type {
  TutorialFlowDefinition,
  TutorialTargetPosition,
} from "@/services/onboarding/definitions";
import { recordOnboardingEvent } from "@/services/onboarding/events";

const STORAGE_PREFIX = "meta:onboarding/session/";
const BRAND = "#2DD4BF";
const GOLD = "#F4B75D";
const INK = "#FFF7ED";
const MUTED = "rgba(255,247,237,0.68)";

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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function targetIcon(position: TutorialTargetPosition): keyof typeof Ionicons.glyphMap {
  if (position === "top") return "arrow-up-circle";
  if (position === "bottom") return "arrow-down-circle";
  if (position === "left") return "arrow-back-circle";
  if (position === "right") return "arrow-forward-circle";
  return "scan-circle";
}

function pointerIcon(position: TutorialTargetPosition): keyof typeof Ionicons.glyphMap {
  if (position === "bottom") return "arrow-down";
  if (position === "left") return "arrow-back";
  if (position === "right") return "arrow-forward";
  return "arrow-up";
}

function getTargetStyle(position: TutorialTargetPosition, width: number, height: number): ViewStyle {
  const inset = clamp(width * 0.05, 16, 28);
  const centeredInset = width > 560 ? Math.max(inset, (width - 500) / 2) : inset;
  const sideWidth = clamp(width * 0.42, 142, 190);
  const topBase = clamp(height * 0.09, 44, 92);
  const middleBase = clamp(height * 0.27, 136, height * 0.4);

  if (position === "left") {
    return {
      top: middleBase,
      left: inset,
      width: sideWidth,
      minHeight: 132,
    };
  }

  if (position === "right") {
    return {
      top: middleBase,
      right: inset,
      width: sideWidth,
      minHeight: 132,
    };
  }

  if (position === "bottom") {
    return {
      bottom: clamp(height * 0.18, 138, 230),
      left: centeredInset,
      right: centeredInset,
      minHeight: 96,
    };
  }

  if (position === "middle") {
    return {
      top: middleBase,
      left: centeredInset,
      right: centeredInset,
      minHeight: 104,
    };
  }

  return {
    top: topBase,
    left: centeredInset,
    right: centeredInset,
    minHeight: 88,
  };
}

function getCardStyle(position: TutorialTargetPosition, width: number, height: number): ViewStyle {
  const baseInset = clamp(width * 0.045, 14, 22);
  const inset = width > 520 ? Math.max(baseInset, (width - 470) / 2) : baseInset;
  const maxHeight = position === "bottom" ? height * 0.48 : height * 0.52;
  const placement = position === "bottom"
    ? { top: clamp(height * 0.04, 26, 44) }
    : { bottom: clamp(height * 0.035, 18, 32) };

  return {
    ...placement,
    left: inset,
    right: inset,
    maxHeight,
  };
}

function getPointerStyle(position: TutorialTargetPosition, width: number, height: number): ViewStyle {
  if (position === "bottom") {
    return {
      top: clamp(height * 0.49, 270, height * 0.58),
      left: width * 0.5 - 48,
    };
  }
  if (position === "left") {
    return {
      top: clamp(height * 0.43, 240, height * 0.52),
      left: clamp(width * 0.42, 150, 210),
    };
  }
  if (position === "right") {
    return {
      top: clamp(height * 0.43, 240, height * 0.52),
      right: clamp(width * 0.42, 150, 210),
    };
  }
  if (position === "middle") {
    return {
      top: clamp(height * 0.44, 238, height * 0.54),
      left: width * 0.5 - 48,
    };
  }
  return {
    top: clamp(height * 0.22, 128, 184),
    left: width * 0.5 - 48,
  };
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

export function useOnboardingState() {
  const { activeFlowKey, hydrated } = useOnboardingContext();
  return { activeFlowKey, hydrated };
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
  const { width, height } = useWindowDimensions();

  const [stepIndex, setStepIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const [aiMode, setAiMode] = useState<OnboardingAiMode | null>(null);
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSource, setAiSource] = useState<"bestcity_ai" | "local" | null>(null);
  const aiRequestRef = useRef(0);

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

  useEffect(() => {
    aiRequestRef.current += 1;
    setAiMode(null);
    setAiText("");
    setAiLoading(false);
    setAiSource(null);
  }, [flow.key, stepIndex]);

  const totalSteps = flow.steps.length;
  const currentStep = flow.steps[stepIndex];
  const targetPosition = currentStep?.targetPosition ?? "middle";
  const targetLabel = currentStep?.targetLabel ?? flow.title;

  async function handleAiPress(mode: OnboardingAiMode) {
    if (!currentStep || aiLoading) return;
    const requestId = aiRequestRef.current + 1;
    aiRequestRef.current = requestId;
    setAiMode(mode);
    setAiLoading(true);
    setAiText("");
    setAiSource(null);

    const result = await explainOnboardingStep({
      flowKey: flow.key,
      flowTitle: flow.title,
      flowSummary: flow.summary,
      stepIndex,
      totalSteps,
      stepTitle: currentStep.title,
      stepBody: currentStep.body,
      targetLabel: currentStep.targetLabel,
      targetPosition: currentStep.targetPosition,
      aiHint: currentStep.aiHint,
      mode,
    });

    if (aiRequestRef.current !== requestId) return;
    setAiText(result.text);
    setAiSource(result.source);
    setAiLoading(false);
  }

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

  const targetStyle = getTargetStyle(targetPosition, width, height);
  const cardStyle = getCardStyle(targetPosition, width, height);
  const pointerStyle = getPointerStyle(targetPosition, width, height);

  return (
    <Modal
      animationType="fade"
      onRequestClose={handleSkip}
      transparent
      visible={visible}
    >
      <View style={styles.backdrop}>
        <View style={[styles.targetFrame, targetStyle]}>
          <LinearGradient
            colors={["rgba(45,212,191,0.18)", "rgba(244,183,93,0.12)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.targetGlow}
          >
            <View style={styles.targetTopRow}>
              <View style={styles.targetIcon}>
                <Ionicons name={targetIcon(targetPosition)} size={18} color={BRAND} />
              </View>
              <Text style={styles.targetCaption}>Look here</Text>
            </View>
            <Text style={styles.targetLabel}>{targetLabel}</Text>
          </LinearGradient>
        </View>

        <View pointerEvents="none" style={[styles.pointer, pointerStyle]}>
          <Ionicons name={pointerIcon(targetPosition)} size={38} color={GOLD} />
          <Text style={styles.pointerText}>follow the highlight</Text>
        </View>

        <View style={[styles.cardShell, cardStyle]}>
          <LinearGradient
            colors={["#130F0B", "#111C1B", "#071220"]}
            start={{ x: 0.08, y: 0 }}
            end={{ x: 0.95, y: 1 }}
            style={styles.card}
          >
            <View style={styles.topRow}>
              <View style={styles.kickerPill}>
                <Ionicons name="navigate-circle" size={14} color={BRAND} />
                <Text style={styles.kickerText}>Guided onboarding</Text>
              </View>
              <Pressable onPress={handleSkip} hitSlop={8} style={styles.skipButton}>
                <Text style={styles.skipText}>Skip</Text>
              </Pressable>
            </View>

            <View style={styles.flowRow}>
              <View style={styles.flowTitleWrap}>
                <Text style={styles.flowTitle}>{flow.title}</Text>
                <Text style={styles.progressText}>
                  Step {stepIndex + 1} of {totalSteps}
                </Text>
              </View>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>{stepIndex + 1}</Text>
              </View>
            </View>

            <View style={styles.progressRow}>
              {flow.steps.map((_, index) => {
                const active = index === stepIndex;
                const done = index < stepIndex;
                return (
                  <View
                    key={`${flow.key}-step-${index}`}
                    style={[
                      styles.progressDot,
                      done ? styles.progressDotDone : null,
                      active ? styles.progressDotActive : null,
                    ]}
                  />
                );
              })}
            </View>

            <ScrollView
              bounces={false}
              contentContainerStyle={styles.cardScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.stepHeader}>
                <View style={styles.targetPill}>
                  <Ionicons name="locate-outline" size={13} color={BRAND} />
                  <Text style={styles.targetPillText}>{targetLabel}</Text>
                </View>
                <Text style={styles.stepCounter}>Teaching point</Text>
              </View>

              <Text style={styles.stepTitle}>{currentStep.title}</Text>
              <Text style={styles.stepBody}>{currentStep.body}</Text>

              <View style={styles.aiPanel}>
                <View style={styles.aiHeader}>
                  <View style={styles.aiTitleRow}>
                    <Ionicons name="sparkles" size={15} color={GOLD} />
                    <Text style={styles.aiTitle}>BestCity Ai</Text>
                  </View>
                  <Text style={styles.aiOptional}>Optional</Text>
                </View>
                <Text style={styles.aiIntro}>
                  Ask for a quick summary or a fuller coach-style explanation without leaving the tutorial.
                </Text>

                <View style={styles.aiActions}>
                  <Pressable
                    disabled={aiLoading}
                    onPress={() => void handleAiPress("summary")}
                    style={[
                      styles.aiButton,
                      aiMode === "summary" ? styles.aiButtonActive : null,
                    ]}
                  >
                    <Ionicons name="flash-outline" size={14} color={aiMode === "summary" ? "#071211" : BRAND} />
                    <Text style={[styles.aiButtonText, aiMode === "summary" ? styles.aiButtonTextActive : null]}>
                      Summarise
                    </Text>
                  </Pressable>
                  <Pressable
                    disabled={aiLoading}
                    onPress={() => void handleAiPress("full")}
                    style={[
                      styles.aiButton,
                      aiMode === "full" ? styles.aiButtonActive : null,
                    ]}
                  >
                    <Ionicons name="school-outline" size={14} color={aiMode === "full" ? "#071211" : BRAND} />
                    <Text style={[styles.aiButtonText, aiMode === "full" ? styles.aiButtonTextActive : null]}>
                      Teach me
                    </Text>
                  </Pressable>
                </View>

                {aiLoading ? (
                  <View style={styles.aiLoadingRow}>
                    <ActivityIndicator color={BRAND} size="small" />
                    <Text style={styles.aiLoadingText}>BestCity Ai is preparing this step...</Text>
                  </View>
                ) : aiText ? (
                  <View style={styles.aiAnswer}>
                    <Text style={styles.aiAnswerText}>{aiText}</Text>
                    {aiSource === "local" ? (
                      <Text style={styles.aiFallbackText}>Offline guide shown while BestCity Ai is unavailable.</Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </ScrollView>

            <View style={styles.footerRow}>
              <Pressable
                disabled={stepIndex === 0}
                onPress={handleBack}
                style={[
                  styles.secondaryButton,
                  stepIndex === 0 ? styles.secondaryButtonDisabled : null,
                ]}
              >
                <Ionicons name="chevron-back" size={16} color={INK} />
                <Text style={styles.secondaryButtonText}>Back</Text>
              </Pressable>

              <Pressable onPress={handleNext} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>
                  {stepIndex === totalSteps - 1 ? "Done" : "Next"}
                </Text>
                <Ionicons
                  name={stepIndex === totalSteps - 1 ? "checkmark-circle" : "chevron-forward"}
                  size={17}
                  color="#061211"
                />
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
    backgroundColor: "rgba(2,6,23,0.78)",
  },
  targetFrame: {
    position: "absolute",
    borderRadius: 24,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "rgba(45,212,191,0.78)",
    shadowColor: BRAND,
    shadowOpacity: 0.4,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
    overflow: "hidden",
  },
  targetGlow: {
    flex: 1,
    padding: 14,
    justifyContent: "center",
    backgroundColor: "rgba(10,14,12,0.42)",
  },
  targetTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  targetIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(45,212,191,0.16)",
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.34)",
  },
  targetCaption: {
    color: "rgba(204,251,241,0.88)",
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  targetLabel: {
    marginTop: 8,
    color: INK,
    fontSize: 18,
    fontWeight: "900",
  },
  pointer: {
    position: "absolute",
    width: 96,
    alignItems: "center",
    gap: 2,
  },
  pointerText: {
    color: "rgba(255,247,237,0.72)",
    fontSize: 9,
    fontWeight: "900",
    textTransform: "uppercase",
    textAlign: "center",
  },
  cardShell: {
    position: "absolute",
    width: "auto",
    maxWidth: 470,
    alignSelf: "center",
  },
  card: {
    borderRadius: 22,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
    shadowColor: "#000",
    shadowOpacity: 0.38,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  kickerPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(45,212,191,0.13)",
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.28)",
  },
  kickerText: {
    color: "#CCFBF1",
    fontWeight: "900",
    fontSize: 11,
  },
  skipButton: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  skipText: {
    color: "rgba(255,255,255,0.76)",
    fontWeight: "900",
    fontSize: 12,
  },
  flowRow: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  flowTitleWrap: {
    flex: 1,
  },
  flowTitle: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 21,
    lineHeight: 25,
  },
  progressText: {
    marginTop: 5,
    color: MUTED,
    fontSize: 12,
    fontWeight: "800",
  },
  stepBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,183,93,0.16)",
    borderWidth: 1,
    borderColor: "rgba(244,183,93,0.34)",
  },
  stepBadgeText: {
    color: GOLD,
    fontWeight: "900",
    fontSize: 17,
  },
  progressRow: {
    marginTop: 13,
    flexDirection: "row",
    gap: 7,
  },
  progressDot: {
    flex: 1,
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  progressDotDone: {
    backgroundColor: "rgba(45,212,191,0.45)",
  },
  progressDotActive: {
    backgroundColor: BRAND,
  },
  cardScrollContent: {
    paddingTop: 14,
    paddingBottom: 2,
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  targetPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(45,212,191,0.1)",
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.22)",
  },
  targetPillText: {
    color: "#CFFAFE",
    fontSize: 11,
    fontWeight: "900",
  },
  stepCounter: {
    color: "rgba(255,247,237,0.5)",
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  stepTitle: {
    marginTop: 11,
    color: "#FFFFFF",
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "900",
  },
  stepBody: {
    marginTop: 7,
    color: "rgba(255,255,255,0.76)",
    fontSize: 13,
    lineHeight: 19,
  },
  aiPanel: {
    marginTop: 14,
    borderRadius: 17,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: "rgba(244,183,93,0.18)",
  },
  aiHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  aiTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  aiTitle: {
    color: INK,
    fontSize: 13,
    fontWeight: "900",
  },
  aiOptional: {
    color: "rgba(255,247,237,0.52)",
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  aiIntro: {
    marginTop: 6,
    color: "rgba(255,247,237,0.64)",
    fontSize: 12,
    lineHeight: 17,
  },
  aiActions: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
  },
  aiButton: {
    flex: 1,
    minHeight: 38,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "rgba(45,212,191,0.08)",
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.2)",
  },
  aiButtonActive: {
    backgroundColor: BRAND,
    borderColor: BRAND,
  },
  aiButtonText: {
    color: "#CCFBF1",
    fontSize: 12,
    fontWeight: "900",
  },
  aiButtonTextActive: {
    color: "#071211",
  },
  aiLoadingRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
  },
  aiLoadingText: {
    color: "rgba(255,247,237,0.68)",
    fontSize: 12,
    fontWeight: "800",
  },
  aiAnswer: {
    marginTop: 10,
    borderRadius: 13,
    padding: 10,
    backgroundColor: "rgba(5,10,12,0.45)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  aiAnswerText: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
  aiFallbackText: {
    marginTop: 8,
    color: "rgba(244,183,93,0.78)",
    fontSize: 10,
    fontWeight: "800",
  },
  footerRow: {
    marginTop: 14,
    flexDirection: "row",
    gap: 10,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 45,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
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
    fontWeight: "900",
  },
  primaryButton: {
    flex: 1.25,
    minHeight: 45,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: BRAND,
    borderWidth: 1,
    borderColor: "rgba(204,251,241,0.52)",
  },
  primaryButtonText: {
    color: "#061211",
    fontSize: 14,
    fontWeight: "900",
  },
});
