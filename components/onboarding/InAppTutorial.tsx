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
  Animated,
  Easing,
  Modal,
  PanResponder,
  Platform,
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

// Haptics is entirely optional. We deliberately avoid any static `import` (type or value) of
// "expo-haptics" so TypeScript never needs to resolve that module on disk — this keeps the file
// compiling cleanly whether or not the package happens to be installed in this project.
// At runtime, we only ever reach for it through a guarded dynamic require with a loose shape.
type LooseHapticsModule = {
  impactAsync?: (style?: unknown) => Promise<void>;
  notificationAsync?: (type?: unknown) => Promise<void>;
  ImpactFeedbackStyle?: { Light?: unknown; Medium?: unknown; Heavy?: unknown };
  NotificationFeedbackType?: { Success?: unknown; Warning?: unknown; Error?: unknown };
};

let Haptics: LooseHapticsModule | null = null;
let hapticsLoadAttempted = false;

function loadHapticsOnce(): LooseHapticsModule | null {
  if (hapticsLoadAttempted) return Haptics;
  hapticsLoadAttempted = true;
  if (Platform.OS === "web") return null;
  try {
    // require() is resolved at runtime only; since there's no static `import` anywhere in this
    // file, TypeScript has nothing to type-check here even if the package isn't installed.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    Haptics = require("expo-haptics") as LooseHapticsModule;
  } catch {
    Haptics = null;
  }
  return Haptics;
}

function tapHaptic(style: "light" | "medium" | "success" = "light") {
  if (Platform.OS === "web") return;
  const mod = loadHapticsOnce();
  if (!mod) return;
  try {
    if (style === "success" && mod.notificationAsync && mod.NotificationFeedbackType?.Success) {
      void mod.notificationAsync(mod.NotificationFeedbackType.Success);
    } else if (style === "medium" && mod.impactAsync && mod.ImpactFeedbackStyle?.Medium) {
      void mod.impactAsync(mod.ImpactFeedbackStyle.Medium);
    } else if (mod.impactAsync && mod.ImpactFeedbackStyle?.Light) {
      void mod.impactAsync(mod.ImpactFeedbackStyle.Light);
    }
  } catch {
    // no-op — never let haptics break the tour
  }
}

const STORAGE_PREFIX = "meta:onboarding/v2/";

// ─── Brand Tokens ──────────────────────────────────────────────────────────────
const BRAND = "#2DD4BF";
const BRAND_DEEP = "#0F9C8C";
const GOLD = "#F4B75D";
const ROSE = "#FB7185";
const INK = "#FFF7ED";
const MUTED = "rgba(255,247,237,0.68)";
const FAINT = "rgba(255,247,237,0.42)";
const SHEET_BG = "#0A0F14";
const SHEET_BG_RAISED = "#0E1620";
const HAIRLINE = "rgba(255,255,255,0.10)";
const HAIRLINE_BRIGHT = "rgba(255,255,255,0.16)";

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

// ─── Device class ──────────────────────────────────────────────────────────────
type DeviceClass = "phone" | "tablet" | "desktop";

function getDeviceClass(width: number): DeviceClass {
  if (width >= 1024) return "desktop";
  if (width >= 700) return "tablet";
  return "phone";
}

// ─── Fallback target box (used when nothing is measured yet, e.g. very first frame) ──
function getTargetBox(position: TutorialTargetPosition, width: number, height: number): LayoutBox {
  const inset = clamp(width * 0.04, 12, 32);
  const topWidth = width >= 900 ? clamp(width * 0.32, 300, 400) : width - inset * 2;
  const centeredWidth = width >= 900 ? clamp(width * 0.42, 380, 540) : width - inset * 2;
  const sideWidth = clamp(width * 0.32, 140, 200);
  const topBase = clamp(height * 0.08, 48, 80);
  const middleBase = clamp(height * 0.3, 140, height * 0.45);

  if (position === "left") {
    return { top: middleBase, left: inset, width: sideWidth, height: 120 };
  }
  if (position === "right") {
    return { top: middleBase, left: width - inset - sideWidth, width: sideWidth, height: 120 };
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
    return { top: middleBase, left: (width - centeredWidth) / 2, width: centeredWidth, height: 92 };
  }
  return { top: topBase, left: (width - topWidth) / 2, width: topWidth, height: 70 };
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

// ─── Panel geometry ────────────────────────────────────────────────────────────
// Three distinct strategies depending on device class + available space:
//  - desktop: floating side panel (left/right of target), connected by a line + marker
//  - tablet: same idea but narrower margins, panel can also go above/below
//  - phone: anchored bottom sheet that rises from the bottom edge — connector becomes
//           a short vertical "pointer" line from the target down toward the sheet's top edge
type GuidePlacement = "left" | "right" | "top" | "bottom" | "sheet";

type GuideGeometry = {
  placement: GuidePlacement;
  connectorStyle: ViewStyle | null;
  markerIcon: keyof typeof Ionicons.glyphMap;
  markerStyle: ViewStyle;
  panelStyle: ViewStyle;
  isSheet: boolean;
};

function getMarkerIcon(placement: GuidePlacement): keyof typeof Ionicons.glyphMap {
  if (placement === "left") return "arrow-back";
  if (placement === "right") return "arrow-forward";
  if (placement === "top") return "arrow-up";
  return "arrow-down";
}

function getGuideGeometry(
  width: number,
  height: number,
  targetBox: LayoutBox,
  deviceClass: DeviceClass,
): GuideGeometry {
  const inset = clamp(width * 0.03, 12, 28);
  const gap = clamp(Math.min(width, height) * 0.035, 16, 36);
  const markerSize = deviceClass === "phone" ? 32 : 36;
  const lineOffset = 8;
  const targetCenterX = targetBox.left + targetBox.width / 2;
  const targetCenterY = targetBox.top + targetBox.height / 2;
  const targetRight = targetBox.left + targetBox.width;
  const targetBottom = targetBox.top + targetBox.height;

  // ── DESKTOP & TABLET-WIDE: try side panel first ──────────────────────────────
  if (deviceClass !== "phone") {
    const panelWidth =
      deviceClass === "desktop" ? clamp(width * 0.28, 360, 440) : clamp(width * 0.42, 320, 400);
    const availableHeight = Math.max(280, height - inset * 2);
    const panelHeight = Math.min(availableHeight, clamp(height * 0.62, 380, 560));
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
        placement: "right",
        isSheet: false,
        connectorStyle: {
          height: 2,
          left: connectorLeft,
          top: clamp(targetCenterY - 1, inset, height - inset),
          width: connectorWidth,
        },
        markerIcon: getMarkerIcon("right"),
        markerStyle: {
          left: clamp(targetRight - markerSize / 2, 8, width - markerSize - 8),
          top: clamp(targetCenterY - markerSize / 2, 8, height - markerSize - 8),
        },
        panelStyle: { height: panelHeight, left: panelLeft, top: panelTop, width: panelWidth },
      };
    }

    if (canUseLeft) {
      const panelLeft = inset;
      const connectorLeft = panelLeft + panelWidth + 12;
      const connectorWidth = Math.max(16, targetBox.left - lineOffset - connectorLeft);
      return {
        placement: "left",
        isSheet: false,
        connectorStyle: {
          height: 2,
          left: connectorLeft,
          top: clamp(targetCenterY - 1, inset, height - inset),
          width: connectorWidth,
        },
        markerIcon: getMarkerIcon("left"),
        markerStyle: {
          left: clamp(targetBox.left - markerSize / 2, 8, width - markerSize - 8),
          top: clamp(targetCenterY - markerSize / 2, 8, height - markerSize - 8),
        },
        panelStyle: { height: panelHeight, left: panelLeft, top: panelTop, width: panelWidth },
      };
    }
    // Falls through to stacked top/bottom panel below if no side space (e.g. narrow tablet split-view).
  }

  // ── PHONE: anchored bottom sheet ─────────────────────────────────────────────
  if (deviceClass === "phone") {
    const sheetHeight = clamp(height * 0.46, 320, 440);
    const sheetTop = height - sheetHeight;
    const targetAboveSheet = targetBottom < sheetTop - 4;

    return {
      placement: "sheet",
      isSheet: true,
      connectorStyle: targetAboveSheet
        ? {
            height: Math.max(0, sheetTop - targetBottom - 6),
            left: clamp(targetCenterX - 1, inset, width - inset),
            top: targetBottom + 4,
            width: 2,
          }
        : null,
      markerIcon: getMarkerIcon("bottom"),
      markerStyle: {
        left: clamp(targetCenterX - markerSize / 2, 8, width - markerSize - 8),
        top: clamp(targetBottom - markerSize / 2, 8, height - markerSize - 8),
      },
      panelStyle: { height: sheetHeight, left: 0, top: sheetTop, width },
    };
  }

  // ── Stacked fallback (tablet without side space) ─────────────────────────────
  const availableWidth = Math.max(280, width - inset * 2);
  const panelWidth = availableWidth;
  const availableHeight = Math.max(280, height - inset * 2);
  const panelHeight = Math.min(availableHeight, clamp(height * 0.52, 300, 380));
  const panelLeft = (width - panelWidth) / 2;
  const placeOnTop = targetCenterY > height * 0.52;

  if (placeOnTop) {
    const panelTop = inset;
    const connectorTop = panelTop + panelHeight + 10;
    const connectorHeight = Math.max(0, targetBox.top - connectorTop - 8);
    return {
      placement: "top",
      isSheet: false,
      connectorStyle: {
        height: connectorHeight,
        left: clamp(targetCenterX - 1, inset, width - inset),
        top: connectorTop,
        width: 2,
      },
      markerIcon: getMarkerIcon("top"),
      markerStyle: {
        left: clamp(targetCenterX - markerSize / 2, 8, width - markerSize - 8),
        top: clamp(targetBox.top - markerSize / 2, 8, height - markerSize - 8),
      },
      panelStyle: { height: panelHeight, left: panelLeft, top: panelTop, width: panelWidth },
    };
  }

  const panelTop = height - inset - panelHeight;
  const connectorTop = targetBottom + 8;
  const connectorHeight = Math.max(0, panelTop - connectorTop - 10);
  return {
    placement: "bottom",
    isSheet: false,
    connectorStyle: {
      height: connectorHeight,
      left: clamp(targetCenterX - 1, inset, width - inset),
      top: connectorTop,
      width: 2,
    },
    markerIcon: getMarkerIcon("bottom"),
    markerStyle: {
      left: clamp(targetCenterX - markerSize / 2, 8, width - markerSize - 8),
      top: clamp(targetBottom - markerSize / 2, 8, height - markerSize - 8),
    },
    panelStyle: { height: panelHeight, left: panelLeft, top: panelTop, width: panelWidth },
  };
}

// ─── Provider (state/storage layer — logic unchanged from the original) ───────

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

// ─── TutorialTarget (measuring wrapper — logic unchanged) ─────────────────────

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

// ─── Animated pulse ring around the spotlighted target ────────────────────────

function PulseRing({ box, color }: { box: ViewStyle; color: string }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1600,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.pulseRing,
        box,
        { borderColor: color, transform: [{ scale }], opacity },
      ]}
    />
  );
}

// ─── Step dots ─────────────────────────────────────────────────────────────────

function StepDots({ total, activeIndex }: { total: number; activeIndex: number }) {
  if (total <= 1 || total > 8) {
    // For long flows, dots get noisy — fall back silently to the numeric label elsewhere.
    return null;
  }
  return (
    <View style={styles.dotsRow}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            i === activeIndex ? styles.dotActive : null,
            i < activeIndex ? styles.dotDone : null,
          ]}
        />
      ))}
    </View>
  );
}

// ─── Main tour component ───────────────────────────────────────────────────────

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
  const deviceClass = getDeviceClass(width);

  const [stepIndex, setStepIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const [dismissedLocally, setDismissedLocally] = useState(false);
  const [aiMode, setAiMode] = useState<OnboardingAiMode | null>(null);
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSource, setAiSource] = useState<"bestcity_ai" | "local" | null>(null);
  const [justFinished, setJustFinished] = useState(false);
  const aiRequestRef = useRef(0);

  // ── Animation values ──────────────────────────────────────────────────────
  const mountAnim = useRef(new Animated.Value(0)).current; // 0 = hidden, 1 = shown
  const stepFade = useRef(new Animated.Value(1)).current; // content cross-fade per step
  const pressScalePrimary = useRef(new Animated.Value(1)).current;
  const celebrateAnim = useRef(new Animated.Value(0)).current;

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

  // ── Mount / unmount spring ────────────────────────────────────────────────
  useEffect(() => {
    if (visible) {
      mountAnim.setValue(0);
      Animated.spring(mountAnim, {
        toValue: 1,
        useNativeDriver: true,
        damping: 18,
        stiffness: 180,
        mass: 0.9,
      }).start();
    }
  }, [visible, mountAnim]);

  // ── Per-step cross-fade ───────────────────────────────────────────────────
  const prevStepIndexRef = useRef(stepIndex);
  useEffect(() => {
    if (prevStepIndexRef.current === stepIndex) return;
    prevStepIndexRef.current = stepIndex;
    stepFade.setValue(0);
    Animated.timing(stepFade, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [stepIndex, stepFade]);

  const targetPosition = currentStep?.targetPosition ?? "middle";
  const targetLabel = currentStep?.targetLabel ?? flow.title;

  async function handleAiPress(mode: OnboardingAiMode) {
    if (!currentStep || aiLoading) return;
    tapHaptic("light");
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

  function closeWithAnim(after: () => void) {
    Animated.timing(mountAnim, {
      toValue: 0,
      duration: 160,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => after());
  }

  function handleSkip() {
    tapHaptic("light");
    closeWithAnim(() => {
      setDismissedLocally(true);
      setVisible(false);
      setActiveTargetId(null);
      dismissFlow({ flow, status: "skipped", completedSteps: stepIndex + 1 });
    });
  }

  function handleBack() {
    if (stepIndex === 0) return;
    tapHaptic("light");
    setStepIndex((current) => Math.max(0, current - 1));
  }

  function handleNext() {
    tapHaptic(stepIndex >= totalSteps - 1 ? "success" : "light");
    Animated.sequence([
      Animated.timing(pressScalePrimary, { toValue: 0.94, duration: 70, useNativeDriver: true }),
      Animated.timing(pressScalePrimary, { toValue: 1, duration: 90, useNativeDriver: true }),
    ]).start();

    if (stepIndex >= totalSteps - 1) {
      setJustFinished(true);
      celebrateAnim.setValue(0);
      Animated.sequence([
        Animated.timing(celebrateAnim, {
          toValue: 1,
          duration: 460,
          easing: Easing.out(Easing.back(1.6)),
          useNativeDriver: true,
        }),
        Animated.delay(420),
      ]).start(() => {
        closeWithAnim(() => {
          setJustFinished(false);
          setDismissedLocally(true);
          setVisible(false);
          setActiveTargetId(null);
          dismissFlow({ flow, status: "completed", completedSteps: totalSteps });
        });
      });
      return;
    }
    setStepIndex((current) => current + 1);
  }

  // ── Swipe gesture (phone only) — swipe left = next, right = back ─────────
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 18 && Math.abs(gesture.dy) < 40,
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx <= -40) {
          handleNext();
        } else if (gesture.dx >= 40) {
          handleBack();
        }
      },
    }),
  ).current;

  if (!visible || !currentStep) return null;

  const rawMeasuredTarget = currentStep.targetId ? targetLayouts[currentStep.targetId] : null;
  const measuredTarget =
    rawMeasuredTarget && measuredBoxIsVisible(rawMeasuredTarget, width, height) ? rawMeasuredTarget : null;
  const targetBox = measuredTarget
    ? normalizeMeasuredBox(measuredTarget, width, height)
    : getTargetBox(targetPosition, width, height);
  const targetStyle = targetBox as ViewStyle;
  const guideGeometry = getGuideGeometry(width, height, targetBox, deviceClass);
  const progressPct = Math.round(((stepIndex + 1) / totalSteps) * 100);
  const progressFillStyle = { width: `${progressPct}%` } as ViewStyle;

  const shadeTop = { top: 0, left: 0, right: 0, height: targetBox.top } as ViewStyle;
  const shadeBottom = { top: targetBox.top + targetBox.height, left: 0, right: 0, bottom: 0 } as ViewStyle;
  const shadeLeft = { top: targetBox.top, left: 0, width: targetBox.left, height: targetBox.height } as ViewStyle;
  const shadeRight = {
    top: targetBox.top,
    left: targetBox.left + targetBox.width,
    right: 0,
    height: targetBox.height,
  } as ViewStyle;

  const isSheet = guideGeometry.isSheet;
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === totalSteps - 1;

  const backdropOpacity = mountAnim;
  const cardTranslateY = mountAnim.interpolate({
    inputRange: [0, 1],
    outputRange: isSheet ? [60, 0] : [16, 0],
  });
  const cardScale = mountAnim.interpolate({
    inputRange: [0, 1],
    outputRange: isSheet ? [1, 1] : [0.96, 1],
  });
  const cardOpacity = mountAnim;

  return (
    <Modal animationType="none" onRequestClose={handleSkip} transparent visible={visible}>
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <View pointerEvents="none" style={[styles.shade, shadeTop]} />
        <View pointerEvents="none" style={[styles.shade, shadeBottom]} />
        <View pointerEvents="none" style={[styles.shade, shadeLeft]} />
        <View pointerEvents="none" style={[styles.shade, shadeRight]} />

        {/* Tap outside target / on dimmed area also allows skipping via the close button only —
            shaded zones are pointerEvents="none" so underlying UI never receives stray taps. */}

        <View pointerEvents="none" style={[styles.targetFrame, targetStyle]}>
          <View style={styles.targetGlow} />
        </View>
        <PulseRing box={targetStyle} color={BRAND} />

        {guideGeometry.connectorStyle ? (
          <View pointerEvents="none" style={[styles.connectorLine, guideGeometry.connectorStyle]} />
        ) : null}
        {!isSheet ? (
          <View pointerEvents="none" style={[styles.connectorMarker, guideGeometry.markerStyle]}>
            <Ionicons name={guideGeometry.markerIcon} size={16} color="#061211" />
            <View style={styles.connectorMarkerBadge}>
              <Text style={styles.connectorMarkerText}>{stepIndex + 1}</Text>
            </View>
          </View>
        ) : null}
      </Animated.View>

      {/* Card / sheet — animated independently from the backdrop so it can spring in. */}
      <Animated.View
        style={[
          styles.cardShell,
          guideGeometry.panelStyle,
          isSheet ? styles.cardShellSheet : null,
          {
            opacity: cardOpacity,
            transform: [{ translateY: cardTranslateY }, { scale: cardScale }],
          },
        ]}
        {...(deviceClass === "phone" ? panResponder.panHandlers : {})}
      >
        <View style={[styles.card, isSheet ? styles.cardSheet : null]}>
          {isSheet ? <View style={styles.sheetGrabber} /> : null}

          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderText}>
              <View style={styles.flowBadgeRow}>
                <View style={styles.flowBadgeDot} />
                <Text style={styles.flowTitle}>{flow.title}</Text>
              </View>
              <Text style={styles.stepTitle} numberOfLines={2}>
                {currentStep.title}
              </Text>
            </View>
            <Pressable accessibilityLabel="Close tour" onPress={handleSkip} hitSlop={8} style={styles.closeButton}>
              <Ionicons name="close" size={18} color={INK} />
            </Pressable>
          </View>

          <View style={styles.progressMeta}>
            <StepDots total={totalSteps} activeIndex={stepIndex} />
            <Text style={styles.progressLabel}>
              {stepIndex + 1} / {totalSteps}
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, progressFillStyle]} />
          </View>

          <ScrollView
            bounces={false}
            style={styles.stepScroll}
            contentContainerStyle={styles.cardScrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Animated.View style={{ opacity: stepFade }}>
              <View style={styles.focusBox}>
                <View style={styles.focusIcon}>
                  <Ionicons name="locate-outline" size={18} color={BRAND} />
                </View>
                <View style={styles.focusCopy}>
                  <Text style={styles.focusLabel}>Right now you're looking at</Text>
                  <Text style={styles.focusTitle} numberOfLines={2}>
                    {targetLabel}
                  </Text>
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
                <Text style={styles.aiPanelLabel}>Want more detail?</Text>
                <View style={styles.aiActions}>
                  <Pressable
                    disabled={aiLoading}
                    onPress={() => void handleAiPress("summary")}
                    style={[styles.aiButton, aiMode === "summary" ? styles.aiButtonActive : null]}
                  >
                    <Ionicons name="flash-outline" size={15} color={aiMode === "summary" ? "#071211" : BRAND} />
                    <Text style={[styles.aiButtonText, aiMode === "summary" ? styles.aiButtonTextActive : null]}>
                      Quick summary
                    </Text>
                  </Pressable>
                  <Pressable
                    disabled={aiLoading}
                    onPress={() => void handleAiPress("full")}
                    style={[styles.aiButton, aiMode === "full" ? styles.aiButtonActive : null]}
                  >
                    <Ionicons name="school-outline" size={15} color={aiMode === "full" ? "#071211" : BRAND} />
                    <Text style={[styles.aiButtonText, aiMode === "full" ? styles.aiButtonTextActive : null]}>
                      Guide me through it
                    </Text>
                  </Pressable>
                </View>

                {aiLoading ? (
                  <View style={styles.aiLoadingRow}>
                    <ActivityIndicator color={BRAND} size="small" />
                    <Text style={styles.aiLoadingText}>Putting this together…</Text>
                  </View>
                ) : aiText ? (
                  <View style={styles.aiAnswer}>
                    <Text style={styles.aiAnswerText}>{aiText}</Text>
                    {aiSource === "local" ? (
                      <Text style={styles.aiFallbackText}>
                        Showing the instant guide — the full assistant reply isn't available right now.
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </Animated.View>
          </ScrollView>

          <View style={styles.footerRow}>
            <Pressable onPress={handleSkip} style={styles.laterButton} hitSlop={6}>
              <Text style={styles.laterButtonText}>Skip tour</Text>
            </Pressable>

            <View style={styles.footerRightGroup}>
              <Pressable
                disabled={isFirstStep}
                onPress={handleBack}
                style={[styles.secondaryButton, isFirstStep ? styles.secondaryButtonDisabled : null]}
              >
                <Ionicons name="chevron-back" size={16} color={INK} />
              </Pressable>

              <Animated.View style={{ transform: [{ scale: pressScalePrimary }], flex: 1 }}>
                <Pressable onPress={handleNext} style={styles.primaryButton}>
                  <Text style={styles.primaryButtonText}>{isLastStep ? "Finish tour" : "Next"}</Text>
                  <Ionicons name={isLastStep ? "checkmark-circle" : "chevron-forward"} size={17} color="#061211" />
                </Pressable>
              </Animated.View>
            </View>
          </View>

          {deviceClass === "phone" ? (
            <Text style={styles.swipeHint}>Swipe to move between steps</Text>
          ) : null}
        </View>
      </Animated.View>

      {/* Finish celebration burst */}
      {justFinished ? (
        <View pointerEvents="none" style={styles.celebrateLayer}>
          <Animated.View
            style={[
              styles.celebrateBadge,
              {
                opacity: celebrateAnim,
                transform: [
                  {
                    scale: celebrateAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }),
                  },
                ],
              },
            ]}
          >
            <Ionicons name="checkmark-circle" size={30} color={BRAND} />
            <Text style={styles.celebrateText}>Tour complete</Text>
          </Animated.View>
        </View>
      ) : null}
    </Modal>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "transparent",
  },
  shade: {
    position: "absolute",
    backgroundColor: "rgba(3,7,12,0.82)",
  },

  // Spotlight frame
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
    backgroundColor: "rgba(45,212,191,0.06)",
  },
  targetGlow: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: "rgba(45,212,191,0.07)",
  },
  pulseRing: {
    position: "absolute",
    zIndex: 29,
    borderRadius: 16,
    borderWidth: 2,
  },

  // Connector
  connectorLine: {
    position: "absolute",
    zIndex: 34,
    borderRadius: 999,
    backgroundColor: "rgba(244,183,93,0.85)",
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
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  connectorMarkerBadge: {
    position: "absolute",
    right: -4,
    bottom: -5,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: INK,
    alignItems: "center",
    justifyContent: "center",
  },
  connectorMarkerText: {
    color: "#061211",
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "900",
    textAlign: "center",
  },

  // Card shell (floating panel OR bottom sheet positioning wrapper)
  cardShell: {
    position: "absolute",
    zIndex: 40,
  },
  cardShellSheet: {
    // sheet variant pins full width at the bottom; rounded only on top corners via inner card
  },

  card: {
    height: "100%",
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: HAIRLINE_BRIGHT,
    backgroundColor: SHEET_BG_RAISED,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
    overflow: "hidden",
  },
  cardSheet: {
    borderRadius: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderBottomWidth: 0,
    paddingTop: 10,
  },
  sheetGrabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: HAIRLINE_BRIGHT,
    marginBottom: 10,
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
  flowBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  flowBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: BRAND,
  },
  flowTitle: {
    color: BRAND,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  stepTitle: {
    marginTop: 5,
    color: "#F8FAFC",
    fontSize: 19,
    lineHeight: 25,
    fontWeight: "900",
    letterSpacing: -0.2,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: HAIRLINE,
    flexShrink: 0,
  },

  progressMeta: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  progressLabel: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    flexShrink: 0,
  },

  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: HAIRLINE_BRIGHT,
  },
  dotActive: {
    width: 16,
    backgroundColor: BRAND,
  },
  dotDone: {
    backgroundColor: BRAND_DEEP,
  },

  progressTrack: {
    marginTop: 9,
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.10)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: BRAND,
  },

  stepScroll: {
    flex: 1,
    marginTop: 12,
  },
  cardScrollContent: {
    paddingBottom: 2,
  },

  focusBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 13,
    padding: 11,
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
    backgroundColor: "rgba(45,212,191,0.13)",
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
    letterSpacing: 0.3,
  },
  focusTitle: {
    marginTop: 2,
    color: INK,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
  },

  stepBody: {
    marginTop: 13,
    color: "rgba(255,255,255,0.82)",
    fontSize: 13.5,
    lineHeight: 20,
    fontWeight: "600",
  },

  tryThisBox: {
    marginTop: 13,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 13,
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
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
    paddingTop: 12,
  },
  aiPanelLabel: {
    color: FAINT,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  aiActions: {
    flexDirection: "row",
    gap: 8,
  },
  aiButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(45,212,191,0.08)",
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.2)",
    paddingHorizontal: 8,
  },
  aiButtonActive: {
    backgroundColor: BRAND,
    borderColor: BRAND,
  },
  aiButtonText: {
    color: "#CCFBF1",
    fontSize: 11,
    fontWeight: "900",
    textAlign: "center",
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
    borderRadius: 11,
    padding: 11,
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  aiAnswerText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: "700",
  },
  aiFallbackText: {
    marginTop: 7,
    color: "rgba(244,183,93,0.82)",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
  },

  footerRow: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  footerRightGroup: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  },
  laterButton: {
    minHeight: 40,
    paddingHorizontal: 4,
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
    width: 40,
    minHeight: 40,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: HAIRLINE_BRIGHT,
  },
  secondaryButtonDisabled: {
    opacity: 0.35,
  },
  primaryButton: {
    minHeight: 40,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 16,
    backgroundColor: BRAND,
    borderWidth: 1,
    borderColor: "rgba(204,251,241,0.58)",
  },
  primaryButtonText: {
    color: "#061211",
    fontSize: 13,
    fontWeight: "900",
  },

  swipeHint: {
    marginTop: 10,
    textAlign: "center",
    color: FAINT,
    fontSize: 10,
    fontWeight: "700",
  },

  // Celebration overlay
  celebrateLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  celebrateBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: "rgba(10,16,28,0.95)",
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.4)",
    shadowColor: BRAND,
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  celebrateText: {
    color: INK,
    fontSize: 14,
    fontWeight: "900",
  },
});