import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Platform, Pressable, Text, useWindowDimensions, View } from "react-native";

import UnifiedWalletSheet from "@/components/market/wallet/UnifiedWalletSheet";
import { useUnifiedWallet } from "@/components/market/wallet/useUnifiedWallet";

export default function UnifiedWalletLauncher() {
  const pathname = usePathname();
  const wallet = useUnifiedWallet();
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

  const chipWidth = compact ? 120 : 146;
  const chipHeight = compact ? 48 : 54;

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

  if (hidden) return null;

  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}>
      <Animated.View
        {...panResponder.panHandlers}
        style={{
          position: "absolute",
          right: compact ? 12 : 16,
          bottom: bottomPad,
          zIndex: 40,
          transform: drag.getTranslateTransform(),
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Pressable
            onPress={() => {
              if (draggedRef.current) {
                draggedRef.current = false;
                return;
              }
              setOpen(true);
            }}
            style={{
              minWidth: compact ? 120 : 146,
              height: compact ? 48 : 54,
              borderRadius: compact ? 18 : 20,
              paddingHorizontal: compact ? 11 : 14,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              backgroundColor: "rgba(12,10,25,0.92)",
              borderWidth: 1,
              borderColor: "rgba(124,58,237,0.45)",
              shadowColor: "#000",
              shadowOpacity: 0.35,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 6 },
              elevation: 12,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
              <View
                style={{
                  width: compact ? 28 : 32,
                  height: compact ? 28 : 32,
                  borderRadius: compact ? 10 : 11,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(124,58,237,0.3)",
                }}
              >
                <Ionicons name="wallet-outline" size={compact ? 15 : 17} color="#fff" />
              </View>
              <View>
                <Text style={{ color: "#fff", fontWeight: "900", fontSize: compact ? 11 : 12 }}>Wallet</Text>
                <Text style={{ color: "rgba(255,255,255,0.72)", fontWeight: "700", fontSize: compact ? 9 : 10 }}>
                  ${wallet.overallUsdApprox.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-up" size={compact ? 14 : 16} color="#fff" />
          </Pressable>
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
    </View>
  );
}
