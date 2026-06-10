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
  Animated,
  Modal,
  PanResponder,
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

type LayoutBox = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type OnboardingContextValue = {
  activeFlowKey: string | null;
  activeTargetId: string | null;
  hydrated: boolean;
  claimFlow: (flowKey: string) => boolean;
  dismissFlow: (params: {
    flow: TutorialFlowDefinition;
    status: "completed" | "skipped";
    completedSteps: number;
  }) => void;
  hasSeenFlow: (flowKey: string) => boolean;
  registerTarget: (targetId: string, box: LayoutBox | null) => void;
  releaseFlow: (flowKey: string) => void;
  setActiveTargetId: (targetId: string | null) => void;
  targetLayouts: Record<string, LayoutBox>;
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

function getTargetBox(position: TutorialTargetPosition, width: number, height: number): LayoutBox {
  const inset = clamp(width * 0.045, 16, width >= 900 ? 36 : 24);
  const contentWidth = width >= 900 ? clamp(width - inset * 2, 740, 1080) : width;
  const contentLeft = (width - contentWidth) / 2;
  const topWidth = width >= 900 ? clamp(width * 0.34, 340, 430) : width - inset * 2;
  const centeredWidth = width >= 900 ? clamp(width * 0.44, 420, 560) : width - inset * 2;
  const sideWidth = clamp(width * 0.34, 154, 220);
  const topBase = clamp(height * 0.085, 52, 88);
  const middleBase = clamp(height * 0.28, 150, height * 0.42);

  if (position === "left") {
    return {
      top: middleBase,
      left: inset,
      width: sideWidth,
      height: 122,
    };
  }

  if (position === "right") {
    return {
      top: middleBase,
      left: width - inset - sideWidth,
      width: sideWidth,
      height: 122,
    };
  }

  if (position === "bottom") {
    return {
      top: height - clamp(height * 0.2, 150, 230),
      left: (width - centeredWidth) / 2,
      width: centeredWidth,
      height: 92,
    };
  }

  if (position === "middle") {
    return {
      top: middleBase,
      left: (width - centeredWidth) / 2,
      width: centeredWidth,
      height: 96,
    };
  }

  const desktopLeft = width >= 900
    ? clamp(contentLeft + clamp(contentWidth * 0.025, 16, 28), inset, width - topWidth - inset)
    : (width - topWidth) / 2;
  return {
    top: topBase,
    left: desktopLeft,
    width: topWidth,
    height: width >= 900 ? 74 : 72,
  };
}

function normalizeMeasuredBox(box: LayoutBox, width: number, height: number): LayoutBox {
  const pad = clamp(Math.min(width, height) * 0.012, 6, 12);
  const minWidth = 54;
  const minHeight = 44;
  const left = clamp(box.left - pad, 8, width - 24);
  const top = clamp(box.top - pad, 8, height - 24);
  const rawWidth = Math.max(minWidth, box.width + pad * 2);
  const rawHeight = Math.max(minHeight, box.height + pad * 2);

  return {
    left,
    top,
    width: clamp(rawWidth, minWidth, Math.max(minWidth, width - left - 8)),
    height: clamp(rawHeight, minHeight, Math.max(minHeight, height - top - 8)),
  };
}

function measuredBoxIsVisible(box: LayoutBox, width: number, height: number) {
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  return box.width > 2 && box.height > 2 && right > 8 && bottom > 8 && box.left < width - 8 && box.top < height - 8;
}

function getCardStyle(position: TutorialTargetPosition, width: number, height: number): ViewStyle {
  const baseInset = clamp(width * 0.045, 14, 22);
  const cardWidth = clamp(width - baseInset * 2, 310, 470);
  const left = (width - cardWidth) / 2;
  const maxHeight = position === "bottom" ? height * 0.46 : height * 0.5;
  const placement = position === "bottom"
    ? { top: clamp(height * 0.04, 26, 44) }
    : { bottom: clamp(height * 0.035, 18, 32) };

  return {
    ...placement,
    left,
    width: cardWidth,
    maxHeight,
  };
}

function getPointerStyle(position: TutorialTargetPosition, _width: number, height: number, targetBox: LayoutBox): ViewStyle {
  const centerX = targetBox.left + targetBox.width / 2 - 48;

  if (position === "bottom") {
    return {
      top: targetBox.top - 68,
      left: centerX,
    };
  }
  if (position === "left") {
    return {
      top: targetBox.top + targetBox.height / 2 - 30,
      left: targetBox.left + targetBox.width + 12,
    };
  }
  if (position === "right") {
    return {
      top: targetBox.top + targetBox.height / 2 - 30,
      left: targetBox.left - 108,
    };
  }
  if (position === "middle") {
    return {
      top: clamp(targetBox.top + targetBox.height + 12, 118, height - 210),
      left: centerX,
    };
  }
  return {
    top: targetBox.top + targetBox.height + 12,
    left: centerX,
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
  const [activeTargetId, setActiveTargetId] = useState<string | null>(null);
  const [seenFlows, setSeenFlows] = useState<Record<string, true>>({});
  const [targetLayouts, setTargetLayouts] = useState<Record<string, LayoutBox>>({});

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
    setActiveTargetId(null);
    setTargetLayouts({});

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
    setActiveTargetId(null);
  }, []);

  const registerTarget = useCallback((targetId: string, box: LayoutBox | null) => {
    const id = String(targetId || "").trim();
    if (!id) return;
    setTargetLayouts((current) => {
      if (!box) {
        if (!current[id]) return current;
        const next = { ...current };
        delete next[id];
        return next;
      }

      const prev = current[id];
      if (
        prev &&
        Math.abs(prev.left - box.left) < 1 &&
        Math.abs(prev.top - box.top) < 1 &&
        Math.abs(prev.width - box.width) < 1 &&
        Math.abs(prev.height - box.height) < 1
      ) {
        return current;
      }

      return { ...current, [id]: box };
    });
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
      activeTargetId,
      hydrated,
      claimFlow,
      dismissFlow,
      hasSeenFlow,
      registerTarget,
      releaseFlow,
      setActiveTargetId,
      targetLayouts,
    }),
    [
      activeFlowKey,
      activeTargetId,
      claimFlow,
      dismissFlow,
      hasSeenFlow,
      hydrated,
      registerTarget,
      releaseFlow,
      targetLayouts,
    ],
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

export function TutorialTarget({
  id,
  children,
  disabled = false,
  style,
}: {
  id: string;
  children: React.ReactNode;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const { activeTargetId, registerTarget } = useOnboardingContext();
  const ref = useRef<View>(null);
  const { width, height } = useWindowDimensions();

  const measure = useCallback(() => {
    if (disabled) return;
    const node = ref.current;
    if (!node?.measureInWindow) return;
    node.measureInWindow((left, top, boxWidth, boxHeight) => {
      if (
        !Number.isFinite(left) ||
        !Number.isFinite(top) ||
        !Number.isFinite(boxWidth) ||
        !Number.isFinite(boxHeight) ||
        boxWidth <= 1 ||
        boxHeight <= 1
      ) {
        return;
      }
      registerTarget(id, { left, top, width: boxWidth, height: boxHeight });
    });
  }, [disabled, id, registerTarget]);

  useEffect(() => {
    if (disabled) {
      registerTarget(id, null);
      return;
    }
    const timers = [0, 120, 360, 720].map((delay) => setTimeout(measure, delay));
    return () => {
      timers.forEach(clearTimeout);
      registerTarget(id, null);
    };
  }, [disabled, height, id, measure, registerTarget, width]);

  useEffect(() => {
    if (activeTargetId !== id || disabled) return;
    const timers = [0, 80, 220, 500, 900].map((delay) => setTimeout(measure, delay));
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [activeTargetId, disabled, id, measure]);

  return (
    <View ref={ref} collapsable={false} onLayout={measure} style={style}>
      {children}
    </View>
  );
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
    setActiveTargetId,
    targetLayouts,
  } = useOnboardingContext();
  const { width, height } = useWindowDimensions();

  const [stepIndex, setStepIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const [aiMode, setAiMode] = useState<OnboardingAiMode | null>(null);
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSource, setAiSource] = useState<"bestcity_ai" | "local" | null>(null);
  const aiRequestRef = useRef(0);
  const drag = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const completeDrag = useCallback(
    (_event: unknown, gesture: { dx: number; dy: number }) => {
      drag.flattenOffset();
      const maxX = Math.max(30, width * 0.36);
      const maxY = Math.max(36, height * 0.3);
      const next = {
        x: clamp(dragOffsetRef.current.x + gesture.dx, -maxX, maxX),
        y: clamp(dragOffsetRef.current.y + gesture.dy, -maxY, maxY),
      };

      dragOffsetRef.current = next;
      Animated.spring(drag, {
        toValue: next,
        useNativeDriver: false,
        bounciness: 0,
        speed: 18,
      }).start();
    },
    [drag, height, width],
  );
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3,
        onPanResponderGrant: () => {
          drag.setOffset(dragOffsetRef.current);
          drag.setValue({ x: 0, y: 0 });
        },
        onPanResponderMove: Animated.event([null, { dx: drag.x, dy: drag.y }], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: completeDrag,
        onPanResponderTerminate: completeDrag,
      }),
    [completeDrag, drag],
  );

  const totalSteps = flow.steps.length;
  const currentStep = flow.steps[stepIndex];

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
    setActiveTargetId(visible ? currentStep?.targetId ?? null : null);
  }, [currentStep?.targetId, flow.key, setActiveTargetId, stepIndex, visible]);

  useEffect(() => {
    setActiveTargetId(visible ? currentStep?.targetId ?? null : null);
    return () => {
      setActiveTargetId(null);
    };
  }, [currentStep?.targetId, setActiveTargetId, visible]);

  useEffect(() => {
    drag.stopAnimation();
    dragOffsetRef.current = { x: 0, y: 0 };
    drag.setOffset({ x: 0, y: 0 });
    drag.setValue({ x: 0, y: 0 });
  }, [drag, flow.key, height, stepIndex, visible, width]);

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
      actionLabel: currentStep.actionLabel,
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

  const rawMeasuredTarget = currentStep.targetId ? targetLayouts[currentStep.targetId] : null;
  const measuredTarget = rawMeasuredTarget && measuredBoxIsVisible(rawMeasuredTarget, width, height)
    ? rawMeasuredTarget
    : null;
  const targetBox = measuredTarget
    ? normalizeMeasuredBox(measuredTarget, width, height)
    : getTargetBox(targetPosition, width, height);
  const targetStyle = targetBox as ViewStyle;
  const cardStyle = getCardStyle(targetPosition, width, height);
  const pointerStyle = getPointerStyle(targetPosition, width, height, targetBox);
  const shadeTop = { top: 0, left: 0, right: 0, height: targetBox.top } as ViewStyle;
  const shadeBottom = { top: targetBox.top + targetBox.height, left: 0, right: 0, bottom: 0 } as ViewStyle;
  const shadeLeft = { top: targetBox.top, left: 0, width: targetBox.left, height: targetBox.height } as ViewStyle;
  const shadeRight = {
    top: targetBox.top,
    left: targetBox.left + targetBox.width,
    right: 0,
    height: targetBox.height,
  } as ViewStyle;

  return (
    <Modal
      animationType="fade"
      onRequestClose={handleSkip}
      transparent
      visible={visible}
    >
      <View style={styles.backdrop}>
        <View pointerEvents="none" style={[styles.shade, shadeTop]} />
        <View pointerEvents="none" style={[styles.shade, shadeBottom]} />
        <View pointerEvents="none" style={[styles.shade, shadeLeft]} />
        <View pointerEvents="none" style={[styles.shade, shadeRight]} />

        <View style={[styles.targetFrame, targetStyle]}>
          <LinearGradient
            colors={["rgba(45,212,191,0.08)", "rgba(244,183,93,0.06)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.targetGlow}
          >
            <View style={styles.targetTopRow}>
              <View style={styles.targetIcon}>
                <Ionicons name={targetIcon(targetPosition)} size={18} color={BRAND} />
              </View>
              <Text style={styles.targetCaption}>{measuredTarget ? "Tap or inspect this" : "Look here"}</Text>
            </View>
            <Text style={styles.targetLabel}>{targetLabel}</Text>
          </LinearGradient>
        </View>

        <View pointerEvents="none" style={[styles.pointer, pointerStyle]}>
          <Ionicons name={pointerIcon(targetPosition)} size={38} color={GOLD} />
          <Text style={styles.pointerText}>follow the highlight</Text>
        </View>

        <Animated.View style={[styles.cardShell, cardStyle, { transform: drag.getTranslateTransform() }]}>
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
              <View {...panResponder.panHandlers} style={styles.dragHandle}>
                <Ionicons name="move-outline" size={14} color={MUTED} />
                <Text style={styles.dragHandleText}>Move</Text>
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
              style={styles.stepScroll}
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
              {currentStep.actionLabel ? (
                <View style={styles.tryThisBox}>
                  <Ionicons name="hand-left-outline" size={16} color={GOLD} />
                  <Text style={styles.tryThisText}>{currentStep.actionLabel}</Text>
                </View>
              ) : null}

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
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "transparent",
  },
  shade: {
    position: "absolute",
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
    backgroundColor: "rgba(2,6,23,0.08)",
  },
  targetGlow: {
    flex: 1,
    padding: 14,
    justifyContent: "center",
    backgroundColor: "rgba(10,14,12,0.12)",
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
  tryThisBox: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(244,183,93,0.11)",
    borderWidth: 1,
    borderColor: "rgba(244,183,93,0.28)",
  },
  tryThisText: {
    flex: 1,
    color: "#FFE7B3",
    fontWeight: "900",
    fontSize: 12,
    lineHeight: 17,
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
    maxHeight: "100%",
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
    gap: 8,
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
  dragHandle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
  },
  dragHandleText: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "900",
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
  stepScroll: {
    flexShrink: 1,
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
