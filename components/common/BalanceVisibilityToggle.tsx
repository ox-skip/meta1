import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable } from "react-native";

type Props = {
  hidden: boolean;
  onPress: () => void;
  size?: number;
};

export default function BalanceVisibilityToggle({ hidden, onPress, size = 36 }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size / 2),
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.12)",
        backgroundColor: "rgba(255,255,255,0.06)",
      }}
    >
      <Ionicons name={hidden ? "eye-outline" : "eye-off-outline"} size={Math.max(16, Math.round(size * 0.42))} color="#fff" />
    </Pressable>
  );
}
