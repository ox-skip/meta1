import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MARKET_MENU_SECTIONS, type MarketMenuItem } from "@/components/market/MarketMenuModal";
import { isNigeriaCountry, resolveUserCountry, type UserCountry } from "@/utils/country";

export const MARKET_DESKTOP_RAIL_WIDTH = 52;
export const MARKET_DESKTOP_BREAKPOINT = 980;

const RAIL_WIDTH = MARKET_DESKTOP_RAIL_WIDTH;
const PANEL_WIDTH = 224;
const SURFACE = "rgba(7,10,8,0.97)";
const SURFACE_HOVER = "rgba(255,253,247,0.08)";
const BORDER = "rgba(255,253,247,0.10)";
const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.64)";
const FAINT = "rgba(255,253,247,0.42)";
const TEAL = "#2DD4BF";
const GOLD = "#F4B75D";

function normalizeRoute(route: string) {
  const clean = String(route || "").split("?")[0].replace("/(tabs)", "").replace(/\/+$/, "");
  return clean || "/market";
}

function isRouteActive(pathname: string, route: string) {
  const path = String(pathname || "").replace(/\/+$/, "") || "/market";
  const target = normalizeRoute(route);
  if (target === "/market") return path === "/market";
  return path === target || path.startsWith(`${target}/`);
}

function SidebarItem({
  item,
  accent,
  expanded,
  active,
  onPress,
}: {
  item: MarketMenuItem;
  accent: string;
  expanded: boolean;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.title}
      onPress={onPress}
      style={({ pressed }) => ({
        height: 40,
        borderRadius: 8,
        paddingHorizontal: expanded ? 10 : 0,
        marginHorizontal: 6,
        alignItems: "center",
        justifyContent: expanded ? "flex-start" : "center",
        flexDirection: "row",
        gap: 10,
        backgroundColor: active ? "rgba(255,253,247,0.12)" : pressed ? SURFACE_HOVER : "transparent",
        borderWidth: active ? 1 : 0,
        borderColor: active ? `${accent}55` : "transparent",
      })}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: active ? `${accent}1F` : "transparent",
        }}
      >
        <Ionicons name={item.icon} size={17} color={active ? accent : MUTED} />
      </View>

      {expanded ? (
        <>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: active ? TEXT : MUTED, fontSize: 13, fontWeight: active ? "900" : "800" }}>
              {item.title}
            </Text>
          </View>
          {item.badge ? (
            <View style={{ borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: `${accent}1F` }}>
              <Text style={{ color: accent, fontSize: 9, fontWeight: "900" }}>{item.badge}</Text>
            </View>
          ) : null}
        </>
      ) : null}
    </Pressable>
  );
}

export default function MarketDesktopSidebar() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [userCountry, setUserCountry] = useState<UserCountry | null>(null);
  const widthAnim = useRef(new Animated.Value(RAIL_WIDTH)).current;
  const expanded = hovered || pinned;

  useEffect(() => {
    let mounted = true;
    void resolveUserCountry()
      .then((country) => {
        if (mounted) setUserCountry(country);
      })
      .catch(() => {
        if (mounted) setUserCountry(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    Animated.spring(widthAnim, {
      toValue: expanded ? PANEL_WIDTH : RAIL_WIDTH,
      useNativeDriver: false,
      bounciness: 0,
      speed: 24,
    }).start();
  }, [expanded, widthAnim]);

  const isNigeria = isNigeriaCountry(userCountry?.code || userCountry?.name);
  const sections = useMemo(
    () =>
      MARKET_MENU_SECTIONS.map((section) => ({
        ...section,
        items: section.items.filter((item) => !item.hideOutsideNigeria || isNigeria),
      })).filter((section) => section.items.length > 0),
    [isNigeria],
  );

  if (Platform.OS !== "web" || width < MARKET_DESKTOP_BREAKPOINT) return null;

  const hoverProps =
    Platform.OS === "web"
      ? ({
          onMouseEnter: () => setHovered(true),
          onMouseLeave: () => setHovered(false),
        } as any)
      : {};

  return (
    <Animated.View
      {...hoverProps}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: widthAnim,
        maxHeight: height,
        backgroundColor: SURFACE,
        borderRightWidth: 1,
        borderRightColor: BORDER,
        zIndex: 80,
        shadowColor: "#000",
        shadowOpacity: expanded ? 0.28 : 0.12,
        shadowRadius: expanded ? 22 : 8,
        shadowOffset: { width: 8, height: 0 },
        overflow: "hidden",
      }}
    >
      <View style={{ paddingTop: Math.max(insets.top + 8, 12), paddingBottom: Math.max(insets.bottom + 8, 12), flex: 1 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={pinned ? "Collapse marketplace menu" : "Pin marketplace menu"}
          onPress={() => setPinned((value) => !value)}
          style={({ pressed }) => ({
            height: 42,
            marginHorizontal: 6,
            marginBottom: 8,
            borderRadius: 8,
            paddingHorizontal: expanded ? 10 : 0,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: expanded ? "flex-start" : "center",
            gap: 10,
            backgroundColor: pressed || pinned ? "rgba(45,212,191,0.14)" : "transparent",
            borderWidth: pinned ? 1 : 0,
            borderColor: pinned ? "rgba(45,212,191,0.36)" : "transparent",
          })}
        >
          <View
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(45,212,191,0.14)",
              borderWidth: 1,
              borderColor: "rgba(45,212,191,0.26)",
            }}
          >
            <Ionicons name={pinned ? "chevron-back-outline" : "menu-outline"} size={18} color={TEAL} />
          </View>
          {expanded ? (
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: TEXT, fontSize: 13, fontWeight: "900" }}>
                Market menu
              </Text>
              <Text numberOfLines={1} style={{ marginTop: 1, color: FAINT, fontSize: 10, fontWeight: "800" }}>
                {pinned ? "Pinned open" : "Hover preview"}
              </Text>
            </View>
          ) : null}
        </Pressable>

        <ScrollView
          showsVerticalScrollIndicator={expanded}
          contentContainerStyle={{ paddingBottom: 10 }}
          style={{ flex: 1 }}
        >
          {sections.map((section, index) => (
            <View key={section.key} style={{ paddingTop: index === 0 ? 2 : 9, paddingBottom: 9, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: BORDER }}>
              {expanded ? (
                <View style={{ paddingHorizontal: 14, paddingBottom: 7, flexDirection: "row", alignItems: "center", gap: 7 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 99, backgroundColor: section.accent }} />
                  <Text numberOfLines={1} style={{ color: section.accent, fontSize: 10, fontWeight: "900", textTransform: "uppercase" }}>
                    {section.title}
                  </Text>
                </View>
              ) : null}

              <View style={{ gap: 3 }}>
                {section.items.map((item) => (
                  <SidebarItem
                    key={`${section.key}-${item.route}`}
                    item={item}
                    accent={section.accent}
                    expanded={expanded}
                    active={isRouteActive(pathname, item.route)}
                    onPress={() => router.push(item.route as any)}
                  />
                ))}
              </View>
            </View>
          ))}

          <View style={{ marginHorizontal: 10, marginTop: 4, borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 10 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open account"
              onPress={() => router.push("/market/(tabs)/account" as any)}
              style={({ pressed }) => {
                const active = isRouteActive(pathname, "/market/(tabs)/account");
                return {
                  height: 40,
                  borderRadius: 8,
                  paddingHorizontal: expanded ? 4 : 0,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: expanded ? "flex-start" : "center",
                  gap: 10,
                  backgroundColor: active ? "rgba(255,253,247,0.12)" : pressed ? SURFACE_HOVER : "transparent",
                };
              }}
            >
              <View style={{ width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="person-circle-outline" size={18} color={GOLD} />
              </View>
              {expanded ? (
                <Text numberOfLines={1} style={{ color: MUTED, fontSize: 13, fontWeight: "800" }}>
                  Account
                </Text>
              ) : null}
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Animated.View>
  );
}
