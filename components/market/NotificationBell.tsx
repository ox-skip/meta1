import { Ionicons } from "@expo/vector-icons";
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
        width: 42,
        height: 42,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(124,58,237,0.18)",
        borderWidth: 1,
        borderColor: "rgba(124,58,237,0.40)",
      }}
    >
      <Ionicons name="notifications-outline" size={22} color="#FFFFFF" />
      {count > 0 ? (
        <View
          style={{
            position: "absolute",
            top: 4,
            right: 3,
            minWidth: 18,
            height: 18,
            borderRadius: 999,
            paddingHorizontal: 5,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#EF4444",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.22)",
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 10, fontWeight: "900" }}>
            {count > 99 ? "99+" : count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
