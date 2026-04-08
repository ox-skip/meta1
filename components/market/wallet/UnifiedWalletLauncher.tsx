import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, usePathname } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Platform, Pressable, Text, useWindowDimensions, View } from "react-native";

import BalanceVisibilityToggle from "@/components/common/BalanceVisibilityToggle";
import { useMarketQuickDockExpanded } from "@/components/market/quickDockState";
import { maskBalanceValue, useBalanceVisibility } from "@/hooks/useBalanceVisibility";
import UnifiedWalletSheet from "@/components/market/wallet/UnifiedWalletSheet";
import { useUnifiedWallet } from "@/components/market/wallet/useUnifiedWallet";

function walletModeLabel(mode?: "base_smart" | "walletconnect" | null) {
  if (mode === "base_smart") return "Base wallet";
  if (mode === "walletconnect") return "WalletConnect";
  return "Wallet";
}

export default function UnifiedWalletLauncher() {
  const pathname = usePathname();
  const wallet = useUnifiedWallet();
  const dockExpanded = useMarketQuickDockExpanded();
  const { balancesHidden, toggleBalancesHidden } = useBalanceVisibility();
  const [open, setOpen] = useState(false);
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const drag = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const draggedRef = useRef(false);

  const hidden = useMemo(() => {
    const p = String(pathname || "");
    if (!p.startsWith("/market")) return true;
    if (p.includes("/market/wallet")) return true;
    if (p.includes("/market/checkout/")) return true;
    if (Platform.OS === "web" && (p.endsWith("/market/sell") || p.includes("/market/sell?"))) return true;
    return false;
  }, [pathname]);

  const compact = useMemo(() => {
    const p = String(pathname || "");
    return p.includes("/market/orders") || p.includes("/market/stock");
  }, [pathname]);

  const inListing = useMemo(() => {
    const p = String(pathname || "");
    return p.includes("/market/listing/");
  }, [pathname]);

  const inSellComposer = useMemo(() => {
    const p = String(pathname || "");
    return p.endsWith("/market/sell") || p.includes("/market/sell?");
  }, [pathname]);

  const bottomPad = useMemo(() => {
    const base = Platform.OS === "ios" ? 96 : 82;
    if (inListing) return base + 94;
    if (inSellComposer) return base + 126;
    return compact ? base + 26 : base;
  }, [compact, inListing, inSellComposer]);

  const chipWidth = compact ? 172 : 194;
  const chipHeight = compact ? 60 : 68;
  const connected = Boolean(wallet.connectedAddress);
  const activeMode = wallet.connectedMode ?? wallet.walletMode;
  const activeModeLabel = walletModeLabel(activeMode);

  const clampDrag = useCallback(
    (x: number, y: number) => {
      const maxRight = 8;
      const maxLeft = -(viewportWidth - chipWidth - 24);
      const topSafe = Platform.OS === "ios" ? 74 : 58;
      const upTravel = viewportHeight - topSafe - bottomPad - chipHeight - 16;
      const maxUp = Math.min(0, -upTravel);
      return {
        x: Math.max(maxLeft, Math.min(maxRight, x)),
        y: Math.max(maxUp, Math.min(0, y)),
      };
    },
    [bottomPad, chipHeight, chipWidth, viewportHeight, viewportWidth]
  );

  useEffect(() => {
    const clamped = clampDrag(dragOffsetRef.current.x, dragOffsetRef.current.y);
    dragOffsetRef.current = clamped;
    drag.setValue(clamped);
  }, [clampDrag, drag]);

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
          const raw = {
            x: dragOffsetRef.current.x + g.dx,
            y: dragOffsetRef.current.y + g.dy,
          };
          const clamped = clampDrag(raw.x, raw.y);
          dragOffsetRef.current = clamped;
          Animated.spring(drag, {
            toValue: clamped,
            useNativeDriver: false,
            bounciness: 0,
            speed: 18,
          }).start();
        },
        onPanResponderTerminate: (_evt, g) => {
          drag.flattenOffset();
          const raw = {
            x: dragOffsetRef.current.x + g.dx,
            y: dragOffsetRef.current.y + g.dy,
          };
          const clamped = clampDrag(raw.x, raw.y);
          dragOffsetRef.current = clamped;
          drag.setValue(clamped);
        },
      }),
    [clampDrag, drag]
  );

  if (hidden || !dockExpanded) return null;

  return (
    <>
      <Animated.View
        {...panResponder.panHandlers}
        pointerEvents="box-none"
        style={{
          position: "absolute",
          right: compact ? 12 : 16,
          bottom: bottomPad,
          zIndex: 40,
          transform: drag.getTranslateTransform(),
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <LinearGradient
            colors={connected ? ["rgba(13,148,136,0.98)", "rgba(15,23,42,0.96)", "rgba(180,83,9,0.9)"] : ["rgba(7,18,24,0.96)", "rgba(15,23,42,0.94)"]}
            style={{
              minWidth: chipWidth,
              minHeight: chipHeight,
              borderRadius: compact ? 22 : 24,
              paddingHorizontal: compact ? 11 : 13,
              paddingVertical: compact ? 9 : 10,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              borderWidth: 1,
              borderColor: connected ? "rgba(45,212,191,0.35)" : "rgba(148,163,184,0.22)",
              shadowColor: "#000",
              shadowOpacity: 0.35,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 6 },
              elevation: 12,
            }}
          >
            <Pressable
              onPress={() => {
                if (draggedRef.current) {
                  draggedRef.current = false;
                  return;
                }
                setOpen(true);
              }}
              style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <View
                style={{
                  width: compact ? 34 : 38,
                  height: compact ? 34 : 38,
                  borderRadius: compact ? 12 : 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: connected ? "rgba(255,255,255,0.16)" : "rgba(45,212,191,0.16)",
                  borderWidth: 1,
                  borderColor: connected ? "rgba(255,255,255,0.22)" : "rgba(45,212,191,0.28)",
                }}
              >
                <Ionicons name="wallet-outline" size={compact ? 17 : 18} color="#F8FAFC" />
              </View>

              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <Text style={{ color: "#fff", fontWeight: "900", fontSize: compact ? 11 : 12 }}>Wallet Hub</Text>
                  <View
                    style={{
                      borderRadius: 999,
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      backgroundColor: connected ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.08)",
                      borderWidth: 1,
                      borderColor: connected ? "rgba(16,185,129,0.32)" : "rgba(255,255,255,0.12)",
                    }}
                  >
                    <Text style={{ color: "#F8FAFC", fontWeight: "900", fontSize: compact ? 8 : 9 }}>
                      {connected ? "Connected" : activeModeLabel}
                    </Text>
                  </View>
                </View>

                <Text style={{ marginTop: 5, color: "#fff", fontWeight: "900", fontSize: compact ? 12 : 14 }}>
                  {balancesHidden
                    ? maskBalanceValue("$")
                    : `$${wallet.overallUsdApprox.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                </Text>
                <Text style={{ marginTop: 3, color: "rgba(255,255,255,0.72)", fontWeight: "700", fontSize: compact ? 9 : 10 }}>
                  {connected ? `${activeModeLabel} active` : "Tap to open wallet tools"}
                </Text>
              </View>

              <Ionicons name="chevron-up" size={compact ? 15 : 16} color="#fff" />
            </Pressable>

            {connected ? (
              <Pressable
                onPress={async () => {
                  await wallet.disconnectWallet();
                }}
                disabled={wallet.busy}
                style={{
                  width: compact ? 34 : 38,
                  height: compact ? 34 : 38,
                  borderRadius: compact ? 12 : 14,
                  alignItems: "center",
                  justifyContent: "center",
                  marginLeft: 8,
                  backgroundColor: "rgba(255,255,255,0.12)",
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.18)",
                  opacity: wallet.busy ? 0.6 : 1,
                }}
              >
                <Ionicons name="power-outline" size={compact ? 16 : 18} color="#F8FAFC" />
              </Pressable>
            ) : null}
          </LinearGradient>

          <View style={{ marginLeft: 8 }}>
            <BalanceVisibilityToggle
              hidden={balancesHidden}
              onPress={() => {
                void toggleBalancesHidden();
              }}
              size={compact ? 42 : 46}
            />
          </View>
        </View>
      </Animated.View>

      <UnifiedWalletSheet
        visible={open}
        onClose={() => setOpen(false)}
        wallet={wallet}
        onOpenNgnWallet={() => {
          setOpen(false);
          router.push("/fintech/(tabs)/wallet?action=fund" as any);
        }}
        onOpenCryptoWallet={() => {
          setOpen(false);
          router.push("/market/wallet" as any);
        }}
        onOpenHistory={() => {
          setOpen(false);
          router.push("/market/history" as any);
        }}
      />
    </>
  );
}
