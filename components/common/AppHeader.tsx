import React, { ReactNode, useMemo } from "react";
import { Image, Pressable, StyleProp, Text, View, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";

const BG = "#090D0B";
const CARD = "rgba(255,253,247,0.07)";
const BORDER = "rgba(255,253,247,0.12)";
const MUTED = "rgba(255,253,247,0.66)";
const WHITE = "#FFFDF7";

const APP_LOGO = require("@/assets/images/icon.png");

type Props = {
  title?: string;
  subtitle?: string;

  /** Shows back button. If no history, uses fallbackBackHref (if provided). */
  showBack?: boolean;

  /** Override back behavior */
  onBackPress?: () => void;

  /** If no history exists, go here (optional) */
  fallbackBackHref?: string;

  /** Show account button on the right */
  showAccount?: boolean;

  /** Override account button behavior */
  onAccountPress?: () => void;

  /** Account tab route */
  accountHref?: string;

  /** Replace account button with custom right slot */
  rightSlot?: ReactNode;

  /** Wrapper style */
  style?: StyleProp<ViewStyle>;

  /** Bottom border */
  bordered?: boolean;
};

export default function AppHeader({
  title = "",
  subtitle,
  showBack = true,
  onBackPress,
  fallbackBackHref,
  showAccount = true,
  onAccountPress,
  accountHref = "/market/(tabs)/account",
  rightSlot,
  style,
  bordered = true,
}: Props) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  const canGoBack = useMemo(() => {
    try {
      // @ts-ignore
      return navigation?.canGoBack?.() ?? false;
    } catch {
      return false;
    }
  }, [navigation]);

  function handleBack() {
    if (onBackPress) return onBackPress();

    if (canGoBack) {
      // @ts-ignore
      navigation.goBack();
      return;
    }

    if (fallbackBackHref) router.replace(fallbackBackHref as any);
  }

  function handleAccount() {
    if (onAccountPress) return onAccountPress();
    router.push(accountHref as any);
  }

  const showRealBack = showBack && (canGoBack || !!fallbackBackHref);

  return (
    <View
      style={[
        {
          paddingTop: insets.top + 10,
          paddingBottom: 12,
          paddingHorizontal: 14,
          backgroundColor: BG,
          borderBottomWidth: bordered ? 1 : 0,
          borderBottomColor: bordered ? BORDER : "transparent",
        },
        style,
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        {/* LEFT: Back */}
        <View style={{ width: 46, alignItems: "flex-start" }}>
          {showRealBack ? (
            <Pressable
              onPress={handleBack}
              hitSlop={12}
              style={{
                width: 42,
                height: 42,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: CARD,
                borderWidth: 1,
                borderColor: BORDER,
                shadowColor: "#000",
                shadowOpacity: 0.14,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 7 },
              }}
            >
              <Ionicons name="chevron-back" size={22} color={WHITE} />
            </Pressable>
          ) : null}
        </View>

        {/* CENTER: Logo + Title */}
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 12,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: "rgba(45,212,191,0.42)",
              backgroundColor: "rgba(45,212,191,0.14)",
            }}
          >
            <Image source={APP_LOGO} style={{ width: 34, height: 34 }} resizeMode="cover" />
          </View>

          <View style={{ flex: 1 }}>
            {!!title && (
              <Text numberOfLines={1} style={{ color: WHITE, fontWeight: "900", fontSize: 16 }}>
                {title}
              </Text>
            )}
            {!!subtitle && (
              <Text numberOfLines={1} style={{ color: MUTED, marginTop: 2, fontSize: 12 }}>
                {subtitle}
              </Text>
            )}
          </View>
        </View>

        {/* RIGHT: Account / custom */}
        <View style={{ width: 46, alignItems: "flex-end" }}>
          {rightSlot ? (
            rightSlot
          ) : showAccount ? (
            <Pressable
              onPress={handleAccount}
              hitSlop={12}
              style={{
                width: 42,
                height: 42,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(45,212,191,0.15)",
                borderWidth: 1,
                borderColor: "rgba(45,212,191,0.38)",
                shadowColor: "#000",
                shadowOpacity: 0.14,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 7 },
              }}
            >
              <Ionicons name="person-circle-outline" size={24} color={WHITE} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Accent line */}
      <View style={{ marginTop: 10, height: 1, backgroundColor: "rgba(45,212,191,0.22)" }} />
    </View>
  );
}
