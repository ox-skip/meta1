import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const SURFACE = "#15100C";
const ACCENT = "#F59E0B";
const MUTED = "rgba(255,247,237,0.58)";

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
      style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
      hitSlop={10}
    >
      <View
        style={{
          width: 62,
          height: 62,
          borderRadius: 22,
          alignItems: "center",
          justifyContent: "center",
          marginTop: -24,
          backgroundColor: focused ? ACCENT : "#C88714",
          borderWidth: 1,
          borderColor: "rgba(255,244,230,0.18)",
          shadowColor: "#000",
          shadowOpacity: 0.28,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 10,
        }}
      >
        <Ionicons name="grid-outline" size={28} color="#1A120A" />
      </View>

      <Text
        style={{
          marginTop: 4,
          fontSize: 11,
          fontWeight: "900",
          color: focused ? ACCENT : MUTED,
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
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarHideOnKeyboard: true,
        tabBarPosition: isWebDesktop ? "left" : "bottom",
        tabBarBackground: () => {
          if (isWebDesktop) {
            return (
              <View
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: "rgba(12,9,7,0.98)" },
                ]}
              />
            );
          }

          if (Platform.OS === "ios" && BlurViewComp) {
            return <BlurViewComp intensity={72} tint="dark" style={StyleSheet.absoluteFill} />;
          }

          return (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: SURFACE },
              ]}
            />
          );
        },
        tabBarStyle: isWebDesktop
          ? {
              backgroundColor: "rgba(12,9,7,0.98)",
              borderRightColor: "rgba(245,158,11,0.14)",
              borderRightWidth: 1,
              borderTopWidth: 0,
              width: 228,
              paddingTop: 18,
              paddingBottom: 18,
              paddingHorizontal: 10,
            }
          : [
              styles.mobileBar,
              {
                height: 72 + bottomPad,
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
              paddingTop: 2,
            },
        sceneStyle: isWebDesktop
          ? {
              width: "100%",
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
  );
}

const styles = StyleSheet.create({
  mobileBar: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 10,
    borderTopWidth: 0,
    elevation: 0,
    borderRadius: 24,
    overflow: "hidden",
  },
});
