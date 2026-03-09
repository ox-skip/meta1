import React from "react";
import { View } from "react-native";

import SocialFeed from "@/components/market/SocialFeed";

export default function SocialFeedScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <SocialFeed mode="contained" />
    </View>
  );
}
