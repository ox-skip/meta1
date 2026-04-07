import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, usePathname } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Animated, PanResponder, Platform, Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const ACCENT = "#F59E0B";
const TEXT = "#FFF7ED";
const MUTED = "rgba(255,247,237,0.7)";

export default function MarketMenuLauncher() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const drag = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const draggedRef = useRef(false);

  const hidden = useMemo(() => {
    const p = String(pathname || "");
    if (!p.startsWith("/market")) return true;
    if (p.includes("/market/menu")) return true;
    if (p.includes("/market/checkout/")) return true;
    return false;
  }, [pathname]);

  const bottomOffset = useMemo(() => {
    const p = String(pathname || "");
    const base = Platform.OS === "ios" ? 94 : 82;
    const listingPad = p.includes("/market/listing/") ? 92 : 0;
    const sellPad = p.endsWith("/market/sell") || p.includes("/market/sell?") ? 124 : 0;
    return Math.max(insets.bottom, 10) + base + listingPad + sellPad;
  }, [insets.bottom, pathname]);

  const compact = viewportWidth < 390;
  const chipWidth = compact ? 116 : 132;
  const chipHeight = compact ? 50 : 56;

  const clampDrag = useCallback(
    (x: number, y: number) => {
      const maxLeft = -8;
      const maxRight = Math.max(0, viewportWidth - chipWidth - 24);
      const topSafe = Platform.OS === "ios" ? 74 : 58;
      const upTravel = viewportHeight - topSafe - bottomOffset - chipHeight - 16;
      const maxUp = Math.min(0, -upTravel);
      return {
        x: Math.max(maxLeft, Math.min(maxRight, x)),
        y: Math.max(maxUp, Math.min(0, y)),
      };
    },
    [bottomOffset, chipHeight, chipWidth, viewportHeight, viewportWidth],
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
        left: compact ? 12 : 16,
        bottom: bottomOffset,
        zIndex: 38,
        transform: drag.getTranslateTransform(),
      }}
    >
      <Pressable
        onPress={() => {
          if (draggedRef.current) {
            draggedRef.current = false;
            return;
          }
          router.push("/market/menu" as any);
        }}
        style={{
          borderRadius: compact ? 18 : 22,
          overflow: "hidden",
          shadowColor: "#000",
          shadowOpacity: 0.24,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
          elevation: 10,
        }}
      >
        <LinearGradient
          colors={["#342514", "#17120D"]}
          start={{ x: 0.12, y: 0 }}
          end={{ x: 0.92, y: 1 }}
          style={{
            minWidth: compact ? 116 : 132,
            height: compact ? 50 : 56,
            borderRadius: compact ? 18 : 22,
            borderWidth: 1,
            borderColor: "rgba(245,158,11,0.34)",
            paddingHorizontal: compact ? 12 : 14,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
          }}
        >
          <View
            style={{
              width: compact ? 28 : 32,
              height: compact ? 28 : 32,
              borderRadius: compact ? 10 : 12,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(245,158,11,0.16)",
              borderWidth: 1,
              borderColor: "rgba(245,158,11,0.24)",
            }}
          >
            <Ionicons name="grid-outline" size={compact ? 15 : 17} color={ACCENT} />
          </View>

          <View>
            <Text style={{ color: TEXT, fontSize: compact ? 11 : 12, fontWeight: "900" }}>Menu</Text>
            <Text style={{ color: MUTED, fontSize: compact ? 9 : 10, fontWeight: "700" }}>
              All market routes
            </Text>
          </View>
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}
