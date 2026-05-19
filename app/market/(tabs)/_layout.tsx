import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const SURFACE = "#090D0B";
const ACCENT = "#2DD4BF";
const GOLD = "#F4B75D";
const MUTED = "rgba(255,253,247,0.58)";

let BlurViewComp: any = null;
if (Platform.OS === "ios") {
  try {
    BlurViewComp = require("expo-blur").BlurView;
  } catch {
    BlurViewComp = null;
  }
}

function CenterTabButton({
  accessibilityState,
  accessibilityLabel,
  testID,
  onPress,
  onLongPress,
}: any) {
  const focused = !!accessibilityState?.selected;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 4 }}
      hitSlop={10}
    >
      <View
        style={{
          width: 62,
          height: 62,
          borderRadius: 22,
          alignItems: "center",
          justifyContent: "center",
          marginTop: -18,
          backgroundColor: focused ? GOLD : "rgba(244,183,93,0.86)",
          borderWidth: 1,
          borderColor: "rgba(255,253,247,0.22)",
          shadowColor: "#000",
          shadowOpacity: 0.34,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
          elevation: 12,
        }}
      >
        <Ionicons name="grid-outline" size={28} color={SURFACE} />
      </View>

      <Text
        style={{
          marginTop: 4,
          fontSize: 11,
          fontWeight: "900",
          color: focused ? GOLD : MUTED,
        }}
      >
        Category
      </Text>
    </Pressable>
  );
}

export default function MarketTabsLayout() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isWebDesktop = Platform.OS === "web" && width >= 980;
  const bottomPad = isWebDesktop ? 0 : Math.max(insets.bottom, 10);

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: true,
          tabBarHideOnKeyboard: true,
          tabBarPosition: "bottom",
          tabBarBackground: () => {
            if (Platform.OS === "ios" && BlurViewComp) {
              return (
                <BlurViewComp
                  intensity={72}
                  tint="dark"
                  style={[StyleSheet.absoluteFill, styles.mobileBarBackground]}
                />
              );
            }

            return (
              <View
                style={[
                  StyleSheet.absoluteFill,
                  styles.mobileBarBackground,
                  { backgroundColor: SURFACE },
                ]}
              />
            );
          },
          tabBarStyle: isWebDesktop
            ? {
                display: "none",
                height: 0,
                width: 0,
              }
            : [
                styles.mobileBar,
                {
                  height: 78 + bottomPad,
                  paddingTop: 6,
                  paddingBottom: bottomPad + 4,
                  backgroundColor: Platform.OS === "android" ? SURFACE : "transparent",
                },
              ],
          tabBarActiveTintColor: ACCENT,
          tabBarInactiveTintColor: MUTED,
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: "800" as any,
            marginTop: isWebDesktop ? 4 : 2,
          },
          tabBarItemStyle: isWebDesktop
            ? {
                borderRadius: 18,
                marginVertical: 4,
                marginHorizontal: 2,
              }
            : {
                borderRadius: 18,
                marginHorizontal: 2,
                paddingTop: 6,
              },
          sceneStyle: isWebDesktop
            ? {
                width: "100%",
                paddingBottom: 0,
              }
            : undefined,
        }}
      >
      <Tabs.Screen
        name="index"
        options={{
          title: "Market",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="storefront-outline" color={color} size={size} />
          ),
        }}
      />

      <Tabs.Screen
        name="sell"
        options={{
          title: "Sell",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="add-circle-outline" color={color} size={size} />
          ),
        }}
      />

      <Tabs.Screen
        name="category"
        options={{
          title: "Category",
          tabBarLabel: isWebDesktop ? "Category" : () => null,
          tabBarButton: isWebDesktop ? undefined : (props) => <CenterTabButton {...props} />,
          tabBarIcon: isWebDesktop
            ? ({ color, size }) => <Ionicons name="grid-outline" color={color} size={size} />
            : undefined,
        }}
      />

      <Tabs.Screen
        name="orders"
        options={{
          title: "Orders",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="receipt-outline" color={color} size={size} />
          ),
        }}
      />

      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle-outline" color={color} size={size} />
          ),
        }}
      />

      <Tabs.Screen
        name="messages"
        options={{
          href: null,
          title: "Messages",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubble-ellipses-outline" color={color} size={size} />
          ),
        }}
      />

      <Tabs.Screen
        name="rewards"
        options={{
          href: null,
          title: "Rewards",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="gift-outline" color={color} size={size} />
          ),
        }}
      />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  mobileBar: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 10,
    borderTopWidth: 0,
    borderWidth: 1,
    borderColor: "rgba(255,253,247,0.10)",
    elevation: 12,
    shadowColor: "#000",
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    borderRadius: 26,
    overflow: "visible",
  },
  mobileBarBackground: {
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(255,253,247,0.10)",
  },
});
