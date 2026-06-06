import { useLocalSearchParams } from "expo-router";
import React from "react";
import { View } from "react-native";

import SocialFeed from "@/components/market/SocialFeed";

export default function SocialPostScreen() {
  const { postId } = useLocalSearchParams<{ postId?: string | string[] }>();
  const id = Array.isArray(postId) ? postId[0] : postId;

  return (
    <View style={{ flex: 1, backgroundColor: "#060807" }}>
      <SocialFeed mode="contained" focusPostId={String(id || "")} hideComposer />
    </View>
  );
}
