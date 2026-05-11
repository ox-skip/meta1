import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { AppState, Pressable, Text, View } from "react-native";

import {
  getUnreadAccountNotificationCount,
  subscribeToAccountNotifications,
} from "@/services/market/notifications";

export default function NotificationBell() {
  const [count, setCount] = useState(0);

  const loadCount = useCallback(async () => {
    try {
      const next = await getUnreadAccountNotificationCount();
      setCount(next);
    } catch {
      setCount(0);
    }
  }, []);

  useEffect(() => {
    void loadCount();
  }, [loadCount]);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    void subscribeToAccountNotifications(() => {
      void loadCount();
    }).then((fn) => {
      unsubscribe = fn;
    });

    return () => {
      unsubscribe?.();
    };
  }, [loadCount]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void loadCount();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [loadCount]);

  return (
    <Pressable
      onPress={() => router.push("/market/notification" as any)}
      hitSlop={12}
      style={{
        width: 44,
        height: 44,
        borderRadius: 8,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: count > 0 ? "rgba(45,212,191,0.45)" : "rgba(255,253,247,0.16)",
      }}
    >
      <LinearGradient
        colors={count > 0 ? ["rgba(45,212,191,0.24)", "rgba(244,183,93,0.18)"] : ["rgba(255,253,247,0.075)", "rgba(255,253,247,0.045)"]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
      >
        <Ionicons name={count > 0 ? "notifications" : "notifications-outline"} size={21} color={count > 0 ? "#2DD4BF" : "#FFFDF7"} />
      </LinearGradient>
      {count > 0 ? (
        <View
          style={{
            position: "absolute",
            top: 3,
            right: 3,
            minWidth: 18,
            height: 18,
            borderRadius: 999,
            paddingHorizontal: 5,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#FB7185",
            borderWidth: 1,
            borderColor: "rgba(255,253,247,0.55)",
          }}
        >
          <Text style={{ color: "#FFFDF7", fontSize: 10, fontWeight: "900" }}>
            {count > 99 ? "99+" : count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
