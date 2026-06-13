import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
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

const STORAGE_PREFIX = "meta:onboarding/v2/";
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
  claimFlow: (flowKey: string, force?: boolean) => boolean;
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

function getTargetBox(position: TutorialTargetPosition, width: number, height: number): LayoutBox {
  const inset = clamp(width * 0.04, 12, 32);
  const topWidth = width >= 900 ? clamp(width * 0.32, 300, 400) : width - inset * 2;
  const centeredWidth = width >= 900 ? clamp(width * 0.42, 380, 540) : width - inset * 2;
  const sideWidth = clamp(width * 0.32, 140, 200);
  const topBase = clamp(height * 0.08, 48, 80);
  const middleBase = clamp(height * 0.3, 140, height * 0.45);

  if (position === "left") {
    return {
      top: middleBase,
      left: inset,
      width: sideWidth,
      height: 120,
    };
  }

  if (position === "right") {
    return {
      top: middleBase,
      left: width - inset - sideWidth,
      width: sideWidth,
      height: 120,
    };
  }

  if (position === "bottom") {
    return {
      top: height - clamp(height * 0.22, 140, 220),
      left: (width - centeredWidth) / 2,
      width: centeredWidth,
      height: 88,
    };
  }

  if (position === "middle") {
    return {
      top: middleBase,
      left: (width - centeredWidth) / 2,
      width: centeredWidth,
      height: 92,
    };
  }

  return {
    top: topBase,
    left: (width - topWidth) / 2,
    width: topWidth,
    height: 70,
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

type GuidePlacement = "left" | "right" | "top" | "bottom";

type GuideGeometry = {
  connectorStyle: ViewStyle;
  markerIcon: keyof typeof Ionicons.glyphMap;
  markerStyle: ViewStyle;
  panelStyle: ViewStyle;
};

function getMarkerIcon(placement: GuidePlacement): keyof typeof Ionicons.glyphMap {
  if (placement === "left") return "arrow-back";
  if (placement === "right") return "arrow-forward";
  if (placement === "top") return "arrow-up";
  return "arrow-down";
}

function getGuideGeometry(width: number, height: number, targetBox: LayoutBox): GuideGeometry {
  const inset = clamp(width * 0.03, 12, 32);
  const gap = clamp(Math.min(width, height) * 0.035, 18, 40);
  const markerSize = 36;
  const lineOffset = 8;
  const targetCenterX = targetBox.left + targetBox.width / 2;
  const targetCenterY = targetBox.top + targetBox.height / 2;
  const targetRight = targetBox.left + targetBox.width;
  const targetBottom = targetBox.top + targetBox.height;

  if (width >= 900) {
    const panelWidth = clamp(width * 0.32, 360, 480);
    const availableHeight = Math.max(300, height - inset * 2);
    const panelHeight = Math.min(availableHeight, clamp(height * 0.65, 360, 540));
    const panelTop = clamp(targetCenterY - panelHeight / 2, inset, Math.max(inset, height - panelHeight - inset));
    const rightSpace = width - targetRight - inset;
    const leftSpace = targetBox.left - inset;
    const prefersRight = targetCenterX <= width / 2;
    const canUseRight = rightSpace >= panelWidth + gap;
    const canUseLeft = leftSpace >= panelWidth + gap;

    if ((prefersRight && canUseRight) || (!canUseLeft && canUseRight)) {
      const panelLeft = width - inset - panelWidth;
      const connectorLeft = targetRight + lineOffset;
      const connectorWidth = Math.max(16, panelLeft - connectorLeft - 12);

      return {
        connectorStyle: {
          height: 3,
          left: connectorLeft,
          top: clamp(targetCenterY - 1.5, inset, height - inset),
          width: connectorWidth,
        },
        markerIcon: getMarkerIcon("right"),
        markerStyle: {
          left: clamp(targetRight - markerSize / 2, 8, width - markerSize - 8),
          top: clamp(targetCenterY - markerSize / 2, 8, height - markerSize - 8),
        },
        panelStyle: {
          height: panelHeight,
          left: panelLeft,
          top: panelTop,
          width: panelWidth,
        },
      };
    }

    if (canUseLeft) {
      const panelLeft = inset;
      const connectorLeft = panelLeft + panelWidth + 12;
      const connectorWidth = Math.max(16, targetBox.left - lineOffset - connectorLeft);

      return {
        connectorStyle: {
          height: 3,
          left: connectorLeft,
          top: clamp(targetCenterY - 1.5, inset, height - inset),
          width: connectorWidth,
        },
        markerIcon: getMarkerIcon("left"),
        markerStyle: {
          left: clamp(targetBox.left - markerSize / 2, 8, width - markerSize - 8),
          top: clamp(targetCenterY - markerSize / 2, 8, height - markerSize - 8),
        },
        panelStyle: {
          height: panelHeight,
          left: panelLeft,
          top: panelTop,
          width: panelWidth,
        },
      };
    }
  }

  const availableWidth = Math.max(260, width - inset * 2);
  const panelWidth = Math.min(availableWidth, availableWidth);
  const availableHeight = Math.max(280, height - inset * 2);
  const panelHeight = Math.min(availableHeight, clamp(height * 0.5, 280, 360));
  const panelLeft = (width - panelWidth) / 2;
  const placeOnTop = targetCenterY > height * 0.52;

  if (placeOnTop) {
    const panelTop = inset;
    const connectorTop = panelTop + panelHeight + 10;
    const connectorHeight = Math.max(0, targetBox.top - connectorTop - 8);

    return {
      connectorStyle: {
        height: connectorHeight,
        left: clamp(targetCenterX - 1.5, inset, width - inset),
        top: connectorTop,
        width: 3,
      },
      markerIcon: getMarkerIcon("top"),
      markerStyle: {
        left: clamp(targetCenterX - markerSize / 2, 8, width - markerSize - 8),
        top: clamp(targetBox.top - markerSize / 2, 8, height - markerSize - 8),
      },
      panelStyle: {
        height: panelHeight,
        left: panelLeft,
        top: panelTop,
        width: panelWidth,
      },
    };
  }

  const panelTop = height - inset - panelHeight;
  const connectorTop = targetBottom + 8;
  const connectorHeight = Math.max(0, panelTop - connectorTop - 10);

  return {
    connectorStyle: {
      height: connectorHeight,
      left: clamp(targetCenterX - 1.5, inset, width - inset),
      top: connectorTop,
      width: 3,
    },
    markerIcon: getMarkerIcon("bottom"),
    markerStyle: {
      left: clamp(targetCenterX - markerSize / 2, 8, width - markerSize - 8),
      top: clamp(targetBottom - markerSize / 2, 8, height - markerSize - 8),
    },
    panelStyle: {
      height: panelHeight,
      left: panelLeft,
      top: panelTop,
      width: panelWidth,
    },
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
  const [sessionDeferredFlows, setSessionDeferredFlows] = useState<Record<string, true>>({});
  const [targetLayouts, setTargetLayouts] = useState<Record<string, LayoutBox>>({});

  const activeFlowRef = useRef<string | null>(null);
  const seenFlowsRef = useRef<Record<string, true>>({});
  const sessionDeferredFlowsRef = useRef<Record<string, true>>({});

  useEffect(() => {
    seenFlowsRef.current = seenFlows;
  }, [seenFlows]);

  useEffect(() => {
    sessionDeferredFlowsRef.current = sessionDeferredFlows;
  }, [sessionDeferredFlows]);

  useEffect(() => {
    let cancelled = false;
    activeFlowRef.current = null;
    setActiveFlowKey(null);
    setActiveTargetId(null);
    setTargetLayouts({});
    setSessionDeferredFlows({});

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

  const claimFlow = useCallback((flowKey: string, force = false) => {
    if (!force && seenFlowsRef.current[flowKey]) return false;
    if (!force && sessionDeferredFlowsRef.current[flowKey]) return false;
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
      if (status === "completed") {
        setSeenFlows((current) => {
          if (current[flow.key]) return current;
          return { ...current, [flow.key]: true };
        });
      } else {
        setSessionDeferredFlows((current) => {
          if (current[flow.key]) return current;
          return { ...current, [flow.key]: true };
        });
      }
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
  autoStart = true,
  startSignal = 0,
}: {
  enabled?: boolean;
  flow: TutorialFlowDefinition;
  autoStart?: boolean;
  startSignal?: number;
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
  const [dismissedLocally, setDismissedLocally] = useState(false);
  const [aiMode, setAiMode] = useState<OnboardingAiMode | null>(null);
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSource, setAiSource] = useState<"bestcity_ai" | "local" | null>(null);
  const aiRequestRef = useRef(0);

  const totalSteps = flow.steps.length;
  const currentStep = flow.steps[stepIndex];

  useEffect(() => {
    if (!enabled) return;
    if (!autoStart) return;
    if (!hydrated) return;
    if (visible) return;
    if (dismissedLocally) return;
    if (hasSeenFlow(flow.key)) return;
    if (activeFlowKey && activeFlowKey !== flow.key) return;
    if (claimFlow(flow.key)) {
      setStepIndex(0);
      setVisible(true);
    }
  }, [activeFlowKey, autoStart, claimFlow, dismissedLocally, enabled, flow.key, hasSeenFlow, hydrated, visible]);

  useEffect(() => {
    if (!enabled) return;
    if (!hydrated) return;
    if (!startSignal) return;
    if (activeFlowKey && activeFlowKey !== flow.key) return;
    if (claimFlow(flow.key, true)) {
      setDismissedLocally(false);
      setStepIndex(0);
      setVisible(true);
    }
  }, [activeFlowKey, claimFlow, enabled, flow.key, hydrated, startSignal]);

  useEffect(() => {
    if (enabled) return;
    if (!visible) return;
    setVisible(false);
    releaseFlow(flow.key);
  }, [enabled, flow.key, releaseFlow, visible]);

  useEffect(() => {
    setDismissedLocally(false);
  }, [flow.key]);

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
    setDismissedLocally(true);
    setVisible(false);
    setActiveTargetId(null);
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
      setDismissedLocally(true);
      setVisible(false);
      setActiveTargetId(null);
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
  const guideGeometry = getGuideGeometry(width, height, targetBox);
  const progressFillStyle = {
    width: `${Math.round(((stepIndex + 1) / totalSteps) * 100)}%`,
  } as ViewStyle;
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

        <View pointerEvents="none" style={[styles.targetFrame, targetStyle]}>
          <View style={styles.targetGlow} />
        </View>

        <View pointerEvents="none" style={[styles.connectorLine, guideGeometry.connectorStyle]} />
        <View pointerEvents="none" style={[styles.connectorMarker, guideGeometry.markerStyle]}>
          <Ionicons name={guideGeometry.markerIcon} size={17} color="#061211" />
          <Text style={styles.connectorMarkerText}>{stepIndex + 1}</Text>
        </View>

        <View style={[styles.cardShell, guideGeometry.panelStyle]}>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderText}>
                <Text style={styles.flowTitle}>{flow.title}</Text>
                <Text style={styles.stepTitle}>{currentStep.title}</Text>
              </View>
              <Pressable accessibilityLabel="Close tour" onPress={handleSkip} hitSlop={8} style={styles.closeButton}>
                <Ionicons name="close" size={18} color={INK} />
              </Pressable>
            </View>

            <View style={styles.progressMeta}>
              <Text style={styles.progressLabel}>
                Step {stepIndex + 1} of {totalSteps}
              </Text>
              <Text style={styles.progressTarget} numberOfLines={1}>{targetLabel}</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, progressFillStyle]} />
            </View>

            <ScrollView
              bounces={false}
              style={styles.stepScroll}
              contentContainerStyle={styles.cardScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.focusBox}>
                <View style={styles.focusIcon}>
                  <Ionicons name="locate-outline" size={18} color={BRAND} />
                </View>
                <View style={styles.focusCopy}>
                  <Text style={styles.focusLabel}>Focus area</Text>
                  <Text style={styles.focusTitle} numberOfLines={2}>{targetLabel}</Text>
                </View>
              </View>

              <Text style={styles.stepBody}>{currentStep.body}</Text>
              {currentStep.actionLabel ? (
                <View style={styles.tryThisBox}>
                  <Ionicons name="hand-left-outline" size={18} color={GOLD} />
                  <Text style={styles.tryThisText}>{currentStep.actionLabel}</Text>
                </View>
              ) : null}

              <View style={styles.aiPanel}>
                <View style={styles.aiActions}>
                  <Pressable
                    disabled={aiLoading}
                    onPress={() => void handleAiPress("summary")}
                    style={[
                      styles.aiButton,
                      aiMode === "summary" ? styles.aiButtonActive : null,
                    ]}
                  >
                    <Ionicons name="flash-outline" size={15} color={aiMode === "summary" ? "#071211" : BRAND} />
                    <Text style={[styles.aiButtonText, aiMode === "summary" ? styles.aiButtonTextActive : null]}>
                      Summary
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
                    <Ionicons name="school-outline" size={15} color={aiMode === "full" ? "#071211" : BRAND} />
                    <Text style={[styles.aiButtonText, aiMode === "full" ? styles.aiButtonTextActive : null]}>
                      Guide me
                    </Text>
                  </Pressable>
                </View>

                {aiLoading ? (
                  <View style={styles.aiLoadingRow}>
                    <ActivityIndicator color={BRAND} size="small" />
                    <Text style={styles.aiLoadingText}>Preparing this guide...</Text>
                  </View>
                ) : aiText ? (
                  <View style={styles.aiAnswer}>
                    <Text style={styles.aiAnswerText}>{aiText}</Text>
                    {aiSource === "local" ? (
                      <Text style={styles.aiFallbackText}>Instant guide shown. Full assistant response is unavailable right now.</Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </ScrollView>

            <View style={styles.footerRow}>
              <Pressable onPress={handleSkip} style={styles.laterButton}>
                <Text style={styles.laterButtonText}>Later</Text>
              </Pressable>
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
                  {stepIndex === totalSteps - 1 ? "Finish" : "Next"}
                </Text>
                <Ionicons
                  name={stepIndex === totalSteps - 1 ? "checkmark-circle" : "chevron-forward"}
                  size={17}
                  color="#061211"
                />
              </Pressable>
            </View>
          </View>
        </View>
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
    backgroundColor: "rgba(2,6,23,0.76)",
  },
  targetFrame: {
    position: "absolute",
    zIndex: 30,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "rgba(45,212,191,0.95)",
    shadowColor: BRAND,
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
    overflow: "hidden",
    backgroundColor: "rgba(45,212,191,0.07)",
  },
  targetGlow: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: "rgba(45,212,191,0.08)",
  },
  connectorLine: {
    position: "absolute",
    zIndex: 34,
    borderRadius: 999,
    backgroundColor: "rgba(244,183,93,0.9)",
  },
  connectorMarker: {
    position: "absolute",
    zIndex: 36,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
    borderWidth: 2,
    borderColor: "rgba(255,247,237,0.9)",
    shadowColor: GOLD,
    shadowOpacity: 0.38,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  connectorMarkerText: {
    position: "absolute",
    right: -4,
    bottom: -5,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    overflow: "hidden",
    textAlign: "center",
    color: "#061211",
    backgroundColor: INK,
    fontSize: 10,
    lineHeight: 16,
    fontWeight: "900",
  },
  cardShell: {
    position: "absolute",
    zIndex: 40,
  },
  card: {
    height: "100%",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(10,16,28,0.95)",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  cardHeaderText: {
    flex: 1,
  },
  flowTitle: {
    color: BRAND,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  stepTitle: {
    marginTop: 4,
    color: "#F8FAFC",
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900",
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    flexShrink: 0,
  },
  progressMeta: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  progressLabel: {
    color: MUTED,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    flexShrink: 0,
  },
  progressTarget: {
    flex: 1,
    color: "rgba(255,247,237,0.58)",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    textAlign: "right",
  },
  progressTrack: {
    marginTop: 8,
    height: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: BRAND,
  },
  stepScroll: {
    flex: 1,
    marginTop: 10,
  },
  cardScrollContent: {
    paddingBottom: 2,
  },
  focusBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    padding: 10,
    backgroundColor: "rgba(45,212,191,0.09)",
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.22)",
  },
  focusIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(45,212,191,0.12)",
    flexShrink: 0,
  },
  focusCopy: {
    flex: 1,
  },
  focusLabel: {
    color: "rgba(204,251,241,0.72)",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  focusTitle: {
    marginTop: 2,
    color: INK,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
  },
  stepBody: {
    marginTop: 12,
    color: "rgba(255,255,255,0.8)",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
  },
  tryThisBox: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(244,183,93,0.12)",
    borderWidth: 1,
    borderColor: "rgba(244,183,93,0.3)",
  },
  tryThisText: {
    flex: 1,
    color: "#FFE7B3",
    fontWeight: "800",
    fontSize: 12,
    lineHeight: 16,
  },
  aiPanel: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    paddingTop: 10,
  },
  aiActions: {
    flexDirection: "row",
    gap: 8,
  },
  aiButton: {
    flex: 1,
    minHeight: 38,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
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
    fontSize: 11,
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
    paddingVertical: 4,
  },
  aiLoadingText: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "800",
  },
  aiAnswer: {
    marginTop: 10,
    borderRadius: 10,
    padding: 10,
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  aiAnswerText: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  aiFallbackText: {
    marginTop: 6,
    color: "rgba(244,183,93,0.82)",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
  },
  footerRow: {
    marginTop: 12,
    flexDirection: "row",
    gap: 8,
  },
  laterButton: {
    minWidth: 64,
    minHeight: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  laterButtonText: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "900",
  },
  secondaryButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  secondaryButtonDisabled: {
    opacity: 0.4,
  },
  secondaryButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
  },
  primaryButton: {
    flex: 1.2,
    minHeight: 40,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: BRAND,
    borderWidth: 1,
    borderColor: "rgba(204,251,241,0.58)",
  },
  primaryButtonText: {
    color: "#061211",
    fontSize: 13,
    fontWeight: "900",
  },
});
