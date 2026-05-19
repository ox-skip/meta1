import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import React, { useEffect, useState } from "react";
import { Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HapticTab } from "@/components/followcome/haptic-tab";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/followcome/use-color-scheme";
import { isNigeriaCountry, resolveUserCountry, type UserCountry } from "@/utils/country";

let BlurViewComp: any = null;
if (Platform.OS === "ios") {
  try {
    BlurViewComp = require("expo-blur").BlurView;
  } catch {
    BlurViewComp = null;
  }
}

export default function TabLayout() {
  const scheme = useColorScheme();
  const tint = Colors[scheme ?? "dark"].tint;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [userCountry, setUserCountry] = useState<UserCountry | null | undefined>(undefined);
  const isNigeria = isNigeriaCountry(userCountry?.code || userCountry?.name);
  const isWebDesktop = Platform.OS === "web" && width >= 980;

  const TABBAR_HEIGHT = isWebDesktop ? 62 : 64;
  const bottomPad = isWebDesktop ? 0 : Math.max(insets.bottom, 10);

  useEffect(() => {
    let mounted = true;
    const fallback = setTimeout(() => {
      if (mounted) setUserCountry(null);
    }, 4000);
    (async () => {
      try {
        const c = await resolveUserCountry({ prompt: true });
        if (mounted) setUserCountry(c);
      } catch {
        if (mounted) setUserCountry(null);
      }
      clearTimeout(fallback);
    })();
    return () => {
      mounted = false;
      clearTimeout(fallback);
    };
  }, []);

  if (userCountry === undefined) return null;
  if (!isNigeria) return <Redirect href="/market/wallet" />;

  return (
    <Tabs
      initialRouteName={isNigeria ? "index" : "wallet"}
      screenOptions={{
        headerShown: false,
        tabBarButton: isWebDesktop ? undefined : HapticTab,
        tabBarPosition: isWebDesktop ? "top" : "bottom",
        tabBarActiveTintColor: tint,
        tabBarInactiveTintColor: "#6B7280",
        tabBarHideOnKeyboard: true,

        tabBarBackground: () => {
          if (isWebDesktop) {
            return (
              <View
                style={[
                  StyleSheet.absoluteFill,
                { backgroundColor: "rgba(7,16,13,0.98)" },
                ]}
              />
            );
          }
          if (Platform.OS === "ios" && BlurViewComp) {
            return (
              <BlurViewComp
                intensity={70}
                tint="dark"
                style={StyleSheet.absoluteFill}
              />
            );
          }
          return (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: "#050814" },
              ]}
            />
          );
        },

        tabBarStyle: isWebDesktop
          ? {
              height: TABBAR_HEIGHT,
              paddingBottom: 8,
              paddingTop: 8,
              backgroundColor: "rgba(7,16,13,0.98)",
              borderTopWidth: 0,
              borderBottomWidth: 1,
              borderBottomColor: "rgba(255,255,255,0.1)",
              elevation: 0,
              left: 0,
              right: 0,
            }
          : [
              styles.tabBar,
              {
                height: TABBAR_HEIGHT + bottomPad,
                paddingBottom: bottomPad,
                backgroundColor:
                  Platform.OS === "android" ? "#07100D" : "transparent",
              },
            ],
        tabBarLabelStyle: styles.label,
        sceneStyle: isWebDesktop
          ? {
              width: "100%",
              maxWidth: 1400,
              alignSelf: "center",
            }
          : undefined,
      }}
    >
      {/* ✅ Visible tabs */}
      <Tabs.Screen
        name="index"
        options={{
          href: isNigeria ? undefined : null,
          title: "Home",
          tabBarIcon: ({ color, focused }) => (
            <MaterialCommunityIcons
              name={focused ? "home-variant" : "home-variant-outline"}
              size={focused ? 28 : 24}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="wallet"
        options={{
          title: "Wallet",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "wallet" : "wallet-outline"}
              size={focused ? 28 : 24}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "person-circle" : "person-circle-outline"}
              size={focused ? 28 : 24}
              color={color}
            />
          ),
        }}
      />

      {/* 🚫 Hidden routes (still navigable via router.push) */}
      <Tabs.Screen name="electricity" options={{ href: null }} />
      <Tabs.Screen name="airtime" options={{ href: null }} />
      <Tabs.Screen name="data" options={{ href: null }} />
      <Tabs.Screen name="betting" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: "absolute",
    borderTopWidth: 0,
    elevation: 0,
    left: 14,
    right: 14,
    bottom: 10,
    borderRadius: 20,
    overflow: "hidden",
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    marginTop: 4,
  },
});
