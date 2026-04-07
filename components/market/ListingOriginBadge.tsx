import React from "react";
import { Text, View } from "react-native";

import { resolveListingOriginCountry } from "@/utils/listingOrigin";

type ListingOriginBadgeProps = {
  availability?: unknown;
  paymentOptions?: unknown;
  compact?: boolean;
  tone?: "overlay" | "inline";
};

export default function ListingOriginBadge({
  availability,
  paymentOptions,
  compact = false,
  tone = "inline",
}: ListingOriginBadgeProps) {
  const origin = resolveListingOriginCountry(availability, paymentOptions);
  if (!origin) return null;

  const overlay = tone === "overlay";

  return (
    <View
      style={{
        alignSelf: "flex-start",
        borderRadius: 999,
        paddingHorizontal: compact ? 9 : 10,
        paddingVertical: compact ? 5 : 6,
        backgroundColor: overlay ? "rgba(8,11,24,0.72)" : "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: overlay ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.12)",
      }}
    >
      <Text style={{ color: "#fff", fontWeight: "900", fontSize: compact ? 10 : 11 }}>
        {origin.flag ? `${origin.flag} ` : ""}
        {compact ? origin.compactLabel : origin.label}
      </Text>
    </View>
  );
}
