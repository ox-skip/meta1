import React from "react";
import { View } from "react-native";

import SocialFeed from "@/components/market/SocialFeed";

export default function SocialFeedScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: "#120E0C" }}>
      <SocialFeed mode="contained" />
    </View>
  );
}
