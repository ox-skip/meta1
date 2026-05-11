import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, usePathname } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Platform, Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { maskBalanceValue, useBalanceVisibility } from "@/hooks/useBalanceVisibility";
import UnifiedWalletSheet from "@/components/market/wallet/UnifiedWalletSheet";
import { useUnifiedWallet } from "@/components/market/wallet/useUnifiedWallet";

const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.68)";
const FAINT = "rgba(255,253,247,0.44)";
const BORDER = "rgba(255,253,247,0.14)";
const BORDER_TOP = "rgba(255,253,247,0.26)";
const SURFACE = "#0A0F0C";
const TEAL = "#2DD4BF";
const AMBER = "#F4B75D";
const BLUE = "#38BDF8";
const ROSE = "#FB7185";
const LIME = "#A3E635";
const INK = "#090D0B";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

type RadialAction = {
  key: string;
  label: string;
  icon: IconName;
  accent: string;
  onPress: () => void;
};

function walletModeLabel(mode?: "base_smart" | "walletconnect" | null) {
  if (mode === "base_smart") return "Coinbase";
  if (mode === "walletconnect") return "WC";
  return "Wallet";
}

export default function MarketRadialLauncher() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const wallet = useUnifiedWallet();
  const { balancesHidden, toggleBalancesHidden } = useBalanceVisibility();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();

  const [open, setOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const openProgress = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const draggedRef = useRef(false);
  const [dockOffset, setDockOffset] = useState({ x: 0, y: 0 });

  const compact = viewportWidth < 390;
  const launchSize = compact ? 68 : 76;
  const actionSize = compact ? 56 : 62;
  const plateSize = compact ? 262 : 292;
  const centerPad = (plateSize - launchSize) / 2;
  const baseLeft = Math.max(14, viewportWidth - launchSize - 18);

  const hidden = useMemo(() => {
    const p = String(pathname || "");
    if (!p.startsWith("/market")) return true;
    if (p.includes("/market/menu")) return true;
    if (p.includes("/market/wallet")) return true;
    if (p.includes("/market/support")) return true;
    if (p.includes("/market/checkout/")) return true;
    if (Platform.OS === "web" && (p.endsWith("/market/sell") || p.includes("/market/sell?"))) return true;
    return false;
  }, [pathname]);

  const bottomOffset = useMemo(() => {
    const p = String(pathname || "");
    const base = Platform.OS === "ios" ? 96 : 84;
    const listingPad = p.includes("/market/listing/") ? 96 : 0;
    const sellPad = p.endsWith("/market/sell") || p.includes("/market/sell?") ? 126 : 0;
    const densePad = p.includes("/market/orders") || p.includes("/market/stock") ? 26 : 0;
    return Math.max(insets.bottom, 10) + base + listingPad + sellPad + densePad;
  }, [insets.bottom, pathname]);

  const clampDrag = useCallback(
    (x: number, y: number) => {
      const minX = 8 - baseLeft;
      const maxX = viewportWidth - launchSize - 8 - baseLeft;
      const topSafe = Platform.OS === "ios" ? 76 : 58;
      const upTravel = viewportHeight - topSafe - bottomOffset - launchSize - 16;
      const maxUp = Math.min(0, -upTravel);
      return {
        x: Math.max(minX, Math.min(maxX, x)),
        y: Math.max(maxUp, Math.min(0, y)),
      };
    },
    [baseLeft, bottomOffset, launchSize, viewportHeight, viewportWidth],
  );

  useEffect(() => {
    const clamped = clampDrag(dragOffsetRef.current.x, dragOffsetRef.current.y);
    dragOffsetRef.current = clamped;
    setDockOffset(clamped);
    drag.setValue(clamped);
  }, [clampDrag, drag]);

  useEffect(() => {
    Animated.spring(openProgress, {
      toValue: open ? 1 : 0,
      useNativeDriver: true,
      bounciness: open ? 7 : 0,
      speed: open ? 18 : 24,
    }).start();
  }, [open, openProgress]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_evt, g) => Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6,
        onPanResponderGrant: () => {
          draggedRef.current = false;
          drag.setOffset(dragOffsetRef.current);
          drag.setValue({ x: 0, y: 0 });
        },
        onPanResponderMove: (_evt, g) => {
          if (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4) draggedRef.current = true;
          Animated.event([null, { dx: drag.x, dy: drag.y }], { useNativeDriver: false })(_evt, g);
        },
        onPanResponderRelease: (_evt, g) => {
          drag.flattenOffset();
          const clamped = clampDrag(dragOffsetRef.current.x + g.dx, dragOffsetRef.current.y + g.dy);
          dragOffsetRef.current = clamped;
          setDockOffset(clamped);
          Animated.spring(drag, {
            toValue: clamped,
            useNativeDriver: false,
            bounciness: 0,
            speed: 18,
          }).start();
        },
        onPanResponderTerminate: (_evt, g) => {
          drag.flattenOffset();
          const clamped = clampDrag(dragOffsetRef.current.x + g.dx, dragOffsetRef.current.y + g.dy);
          dragOffsetRef.current = clamped;
          setDockOffset(clamped);
          drag.setValue(clamped);
        },
      }),
    [clampDrag, drag],
  );

  const connected = Boolean(wallet.connectedAddress);
  const activeMode = wallet.connectedMode ?? wallet.walletMode;
  const activeModeLabel = walletModeLabel(activeMode);
  const openToLeft = baseLeft + dockOffset.x + launchSize / 2 > viewportWidth / 2;
  const radius = compact ? 98 : 114;
  const angles = openToLeft ? [-184, -156, -128, -100, -72, -44, -16] : [-164, -136, -108, -80, -52, -24, 4];

  const actions = useMemo<RadialAction[]>(
    () => [
      {
        key: "menu",
        label: "Menu",
        icon: "grid-outline",
        accent: AMBER,
        onPress: () => router.push("/market/menu" as any),
      },
      {
        key: "wallet",
        label: connected ? activeModeLabel : "Wallet",
        icon: activeMode === "base_smart" ? "ellipse" : activeMode === "walletconnect" ? "link-outline" : "wallet-outline",
        accent: activeMode === "base_smart" ? BLUE : TEAL,
        onPress: () => setWalletOpen(true),
      },
      {
        key: "sell",
        label: "Sell",
        icon: "add-circle-outline",
        accent: LIME,
        onPress: () => router.push("/market/(tabs)/sell" as any),
      },
      {
        key: "orders",
        label: "Orders",
        icon: "receipt-outline",
        accent: BLUE,
        onPress: () => router.push("/market/(tabs)/orders" as any),
      },
      {
        key: "history",
        label: "History",
        icon: "time-outline",
        accent: ROSE,
        onPress: () => router.push("/market/history" as any),
      },
      {
        key: "support",
        label: "Support",
        icon: "help-buoy-outline",
        accent: BLUE,
        onPress: () => router.push("/market/support" as any),
      },
      {
        key: "privacy",
        label: balancesHidden ? "Show" : "Hide",
        icon: balancesHidden ? "eye-outline" : "eye-off-outline",
        accent: "#C084FC",
        onPress: () => {
          void toggleBalancesHidden();
        },
      },
    ],
    [activeMode, activeModeLabel, balancesHidden, connected, toggleBalancesHidden],
  );

  if (hidden) return null;

  return (
    <>
      <Animated.View
        {...panResponder.panHandlers}
        pointerEvents="box-none"
        style={{
          position: "absolute",
          left: baseLeft - centerPad,
          bottom: bottomOffset - centerPad,
          width: plateSize,
          height: plateSize,
          zIndex: 44,
          transform: drag.getTranslateTransform(),
        }}
      >
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: centerPad + launchSize / 2 - plateSize / 2,
            top: centerPad + launchSize / 2 - plateSize / 2,
            width: plateSize,
            height: plateSize,
            borderRadius: plateSize / 2,
            opacity: openProgress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
            transform: [{ scale: openProgress.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) }],
          }}
        >
          <LinearGradient
            colors={["rgba(255,253,247,0.11)", "rgba(9,13,11,0.78)", "rgba(45,212,191,0.08)"]}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={{
              flex: 1,
              borderRadius: plateSize / 2,
              borderWidth: 1,
              borderColor: BORDER,
            }}
          />
        </Animated.View>

        {open
          ? actions.map((action, index) => {
              const angle = ((angles[index] ?? -90) * Math.PI) / 180;
              const dx = Math.cos(angle) * radius;
              const dy = Math.sin(angle) * radius;

              return (
                <Animated.View
                  key={action.key}
                  style={{
                    position: "absolute",
                    left: centerPad + launchSize / 2 - actionSize / 2,
                    top: centerPad + launchSize / 2 - actionSize / 2,
                    opacity: openProgress,
                    transform: [
                      { translateX: openProgress.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) },
                      { translateY: openProgress.interpolate({ inputRange: [0, 1], outputRange: [0, dy] }) },
                      { scale: openProgress.interpolate({ inputRange: [0, 1], outputRange: [0.62, 1] }) },
                    ],
                  }}
                >
                  <RadialActionButton
                    action={action}
                    size={actionSize}
                    onPress={() => {
                      setOpen(false);
                      action.onPress();
                    }}
                  />
                </Animated.View>
              );
            })
          : null}

        <Pressable
          onPress={() => {
            if (draggedRef.current) {
              draggedRef.current = false;
              return;
            }
            setOpen((prev) => !prev);
          }}
          accessibilityRole="button"
          accessibilityLabel={open ? "Close market actions" : "Open market actions"}
          style={({ pressed }) => ({
            position: "absolute",
            left: centerPad,
            top: centerPad,
            width: launchSize,
            height: launchSize,
            borderRadius: launchSize / 2,
            shadowColor: "#000",
            shadowOpacity: 0.32,
            shadowRadius: 18,
            shadowOffset: { width: 0, height: 10 },
            elevation: 14,
            transform: [{ scale: pressed ? 0.97 : 1 }],
          })}
        >
          <LinearGradient
            colors={
              connected
                ? ["rgba(45,212,191,0.96)", "rgba(13,148,136,0.94)", "rgba(244,183,93,0.86)"]
                : ["rgba(16,24,20,0.98)", "rgba(9,13,11,0.98)", "rgba(45,212,191,0.34)"]
            }
            start={{ x: 0.05, y: 0 }}
            end={{ x: 0.95, y: 1 }}
            style={{
              flex: 1,
              borderRadius: launchSize / 2,
              borderWidth: 1,
              borderColor: connected ? "rgba(255,253,247,0.38)" : BORDER_TOP,
              alignItems: "center",
              justifyContent: "center",
              padding: compact ? 7 : 8,
            }}
          >
            <View
              style={{
                width: compact ? 30 : 34,
                height: compact ? 30 : 34,
                borderRadius: compact ? 13 : 15,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: connected ? "rgba(7,16,13,0.18)" : "rgba(255,253,247,0.10)",
                borderWidth: 1,
                borderColor: connected ? "rgba(7,16,13,0.20)" : "rgba(255,253,247,0.14)",
              }}
            >
              <Ionicons name={open ? "close" : "apps-outline"} size={compact ? 17 : 19} color={connected ? INK : TEAL} />
            </View>
            <Text
              numberOfLines={1}
              style={{
                marginTop: 4,
                color: connected ? INK : TEXT,
                fontWeight: "900",
                fontSize: compact ? 8 : 9,
                maxWidth: launchSize - 10,
              }}
            >
              {balancesHidden
                ? maskBalanceValue("$")
                : `$${wallet.overallUsdApprox.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            </Text>
            <Text
              numberOfLines={1}
              style={{
                color: connected ? "rgba(7,16,13,0.74)" : FAINT,
                fontWeight: "900",
                fontSize: compact ? 7 : 8,
                maxWidth: launchSize - 12,
              }}
            >
              {connected ? activeModeLabel : "Market"}
            </Text>
          </LinearGradient>
        </Pressable>
      </Animated.View>

      <UnifiedWalletSheet
        visible={walletOpen}
        onClose={() => setWalletOpen(false)}
        wallet={wallet}
        onOpenNgnWallet={() => {
          setWalletOpen(false);
          router.push("/fintech/(tabs)/wallet?action=fund" as any);
        }}
        onOpenCryptoWallet={() => {
          setWalletOpen(false);
          router.push("/market/wallet" as any);
        }}
        onOpenHistory={() => {
          setWalletOpen(false);
          router.push("/market/history" as any);
        }}
      />
    </>
  );
}

function RadialActionButton({ action, size, onPress }: { action: RadialAction; size: number; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: "hidden",
        shadowColor: action.accent,
        shadowOpacity: pressed ? 0.18 : 0.26,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 8 },
        elevation: 10,
        transform: [{ scale: pressed ? 0.95 : 1 }],
      })}
    >
      <LinearGradient
        colors={[`${action.accent}34`, SURFACE, "rgba(255,253,247,0.075)"]}
        start={{ x: 0.12, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={{
          flex: 1,
          borderRadius: size / 2,
          borderWidth: 1,
          borderColor: `${action.accent}66`,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 5,
        }}
      >
        <Ionicons name={action.icon} size={size < 60 ? 18 : 20} color={action.accent} />
        <Text numberOfLines={1} style={{ marginTop: 4, color: TEXT, fontWeight: "900", fontSize: size < 60 ? 8 : 9 }}>
          {action.label}
        </Text>
      </LinearGradient>
    </Pressable>
  );
}
