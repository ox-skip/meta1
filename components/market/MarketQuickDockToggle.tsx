import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { usePathname } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Animated, PanResponder, Platform, Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { toggleMarketQuickDockExpanded, useMarketQuickDockExpanded } from "@/components/market/quickDockState";

export default function MarketQuickDockToggle() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const expanded = useMarketQuickDockExpanded();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const drag = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const draggedRef = useRef(false);

  const hidden = useMemo(() => {
    const p = String(pathname || "");
    if (!p.startsWith("/market")) return true;
    if (p.includes("/market/menu")) return true;
    if (p.includes("/market/wallet")) return true;
    if (p.includes("/market/checkout/")) return true;
    if (Platform.OS === "web" && (p.endsWith("/market/sell") || p.includes("/market/sell?"))) return true;
    return false;
  }, [pathname]);

  const bottomOffset = useMemo(() => {
    const p = String(pathname || "");
    const listingPad = p.includes("/market/listing/") ? 92 : 0;
    const sellPad = p.endsWith("/market/sell") || p.includes("/market/sell?") ? 124 : 0;
    const base = Platform.OS === "ios" ? 24 : 18;
    return Math.max(insets.bottom, 10) + base + listingPad + sellPad;
  }, [insets.bottom, pathname]);

  const compact = viewportWidth < 390;
  const toggleWidth = compact ? 64 : 72;
  const toggleHeight = compact ? 58 : 64;
  const baseLeft = Math.max(16, viewportWidth / 2 - toggleWidth / 2);

  const clampDrag = useCallback(
    (x: number, y: number) => {
      const minX = 8 - baseLeft;
      const maxX = viewportWidth - toggleWidth - 8 - baseLeft;
      const topSafe = Platform.OS === "ios" ? 74 : 58;
      const upTravel = viewportHeight - topSafe - bottomOffset - toggleHeight - 16;
      const maxUp = Math.min(0, -upTravel);
      return {
        x: Math.max(minX, Math.min(maxX, x)),
        y: Math.max(maxUp, Math.min(0, y)),
      };
    },
    [baseLeft, bottomOffset, toggleHeight, toggleWidth, viewportHeight, viewportWidth],
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
    [clampDrag, drag],
  );

  if (hidden) return null;

  return (
    <Animated.View
      {...panResponder.panHandlers}
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: baseLeft,
        bottom: bottomOffset,
        zIndex: 39,
        transform: drag.getTranslateTransform(),
      }}
    >
      <Pressable
        onPress={() => {
          if (draggedRef.current) {
            draggedRef.current = false;
            return;
          }
          toggleMarketQuickDockExpanded();
        }}
        style={{
          borderRadius: 999,
          overflow: "hidden",
          shadowColor: "#000",
          shadowOpacity: 0.24,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 6 },
          elevation: 10,
        }}
      >
        <LinearGradient
          colors={expanded ? ["#171A13", "#10130E", "#060807"] : ["#10130E", "#060807"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            width: toggleWidth,
          height: compact ? 42 : 46,
          borderRadius: 999,
          borderWidth: 1,
            borderColor: "rgba(45,212,191,0.28)",
            paddingHorizontal: 10,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="grid-outline" size={compact ? 13 : 14} color="#2DD4BF" />
            <Ionicons name="wallet-outline" size={compact ? 13 : 14} color="#F8FAFC" />
          </View>
          <Ionicons name={expanded ? "chevron-down" : "chevron-up"} size={compact ? 14 : 16} color="#FFFDF7" />
        </LinearGradient>
      </Pressable>
      <Text
        style={{
          marginTop: 6,
          textAlign: "center",
          color: "rgba(255,253,247,0.68)",
          fontSize: 10,
          fontWeight: "800",
        }}
      >
        {expanded ? "Hide" : "Show"}
      </Text>
    </Animated.View>
  );
}
