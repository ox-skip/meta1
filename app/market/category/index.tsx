import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";

import AppHeader from "@/components/common/AppHeader";
import { PRODUCT_CATEGORIES, SERVICE_CATEGORIES } from "@/services/market/categories";
import type { CategoryItem } from "@/services/market/categories";

const BG0 = "#060807";
const BG1 = "#10130E";
const BG2 = "#171A13";
const TEAL = "#2DD4BF";
const BLUE = "#38BDF8";
const AMBER = "#F4B75D";
const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.68)";
const FAINT = "rgba(255,253,247,0.44)";
const CARD = "rgba(255,253,247,0.065)";
const BORDER = "rgba(255,253,247,0.12)";
const BORDER_TOP = "rgba(255,253,247,0.24)";

type Mode = "product" | "service";

function modeCopy(mode: Mode) {
  if (mode === "service") {
    return {
      eyebrow: "SERVICE DIRECTORY",
      title: "Hire for remote, digital, or local work.",
      subtitle: "Find specialists, on-site help, and deliverable-based services with escrow protection.",
      tone: BLUE,
      icon: "briefcase-outline" as keyof typeof Ionicons.glyphMap,
    };
  }

  return {
    eyebrow: "PRODUCT DIRECTORY",
    title: "Shop listings by market lane.",
    subtitle: "Jump into goods, gadgets, fashion, home needs, and everyday essentials.",
    tone: TEAL,
    icon: "storefront-outline" as keyof typeof Ionicons.glyphMap,
  };
}

function SegmentButton({
  active,
  label,
  icon,
  onPress,
}: {
  active: boolean;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 46,
        borderRadius: 17,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 7,
        backgroundColor: active ? "rgba(45,212,191,0.15)" : "rgba(255,253,247,0.06)",
        borderWidth: 1,
        borderColor: active ? "rgba(94,234,212,0.45)" : BORDER,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <Ionicons name={icon} size={16} color={active ? TEAL : MUTED} />
      <Text style={{ color: active ? TEXT : MUTED, fontWeight: "900" }}>{label}</Text>
    </Pressable>
  );
}

function CategoryCard({
  item,
  width,
  onPress,
}: {
  item: CategoryItem;
  width: `${number}%`;
  onPress: () => void;
}) {
  const tone = item.main === "service" ? BLUE : TEAL;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        width,
        minHeight: 126,
        borderRadius: 22,
        padding: 14,
        backgroundColor: pressed ? "rgba(255,253,247,0.09)" : CARD,
        borderWidth: 1,
        borderColor: pressed ? BORDER_TOP : BORDER,
        transform: [{ translateY: pressed ? 1 : 0 }],
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: `${tone}22`,
            borderWidth: 1,
            borderColor: `${tone}44`,
          }}
        >
          <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={19} color={tone} />
        </View>
        <View
          style={{
            borderRadius: 999,
            paddingHorizontal: 8,
            paddingVertical: 5,
            backgroundColor: "rgba(255,253,247,0.06)",
            borderWidth: 1,
            borderColor: BORDER,
          }}
        >
          <Text style={{ color: FAINT, fontWeight: "900", fontSize: 10 }}>
            {item.main === "service" ? "SERVICE" : "PRODUCT"}
          </Text>
        </View>
      </View>

      <Text numberOfLines={1} style={{ marginTop: 12, color: TEXT, fontWeight: "900", fontSize: 14 }}>
        {item.title}
      </Text>
      <Text numberOfLines={2} style={{ marginTop: 5, color: MUTED, fontSize: 12, lineHeight: 17 }}>
        {item.subtitle}
      </Text>
    </Pressable>
  );
}

export default function CategoryPicker() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const { width } = useWindowDimensions();
  const isWebDesktop = Platform.OS === "web" && width >= 980;
  const contentMaxWidth = isWebDesktop ? 1120 : undefined;
  const pagePadding = isWebDesktop ? 28 : 16;
  const tileWidth = (width >= 900 ? "31.8%" : "48%") as `${number}%`;

  const initialMode: Mode = params?.mode === "service" ? "service" : "product";
  const [mode, setMode] = useState<Mode>(initialMode);

  const list = useMemo(() => (mode === "product" ? PRODUCT_CATEGORIES : SERVICE_CATEGORIES), [mode]);
  const copy = modeCopy(mode);

  function open(slug: string) {
    router.push(`/market/category/${slug}` as any);
  }

  return (
    <LinearGradient
      colors={[BG2, BG1, BG0]}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={{ flex: 1, paddingTop: 14, paddingHorizontal: pagePadding }}
    >
      <View style={{ alignSelf: "center", width: "100%", maxWidth: contentMaxWidth }}>
        <AppHeader
          title="Category Directory"
          subtitle="Choose a lane to browse"
          bordered={false}
          style={{ backgroundColor: "transparent", paddingHorizontal: 0 }}
        />
      </View>

      <ScrollView
        contentContainerStyle={{
          alignSelf: "center",
          width: "100%",
          maxWidth: contentMaxWidth,
          paddingBottom: 44,
        }}
      >
        <LinearGradient
          colors={
            mode === "service"
              ? ["rgba(56,189,248,0.18)", "rgba(45,212,191,0.08)", "rgba(255,253,247,0.055)"]
              : ["rgba(45,212,191,0.18)", "rgba(244,183,93,0.08)", "rgba(255,253,247,0.055)"]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            marginTop: 8,
            borderRadius: 28,
            padding: 18,
            borderWidth: 1,
            borderColor: BORDER_TOP,
            overflow: "hidden",
          }}
        >
          <View style={{ flexDirection: isWebDesktop ? "row" : "column", gap: 16, alignItems: "stretch" }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 15,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: `${copy.tone}24`,
                    borderWidth: 1,
                    borderColor: `${copy.tone}55`,
                  }}
                >
                  <Ionicons name={copy.icon} size={19} color={copy.tone} />
                </View>
                <Text style={{ color: copy.tone, fontWeight: "900", fontSize: 12 }}>{copy.eyebrow}</Text>
              </View>

              <Text
                style={{
                  marginTop: 14,
                  color: TEXT,
                  fontWeight: "900",
                  fontSize: isWebDesktop ? 32 : 27,
                  lineHeight: isWebDesktop ? 38 : 33,
                  maxWidth: 620,
                }}
              >
                {copy.title}
              </Text>
              <Text style={{ marginTop: 8, color: MUTED, lineHeight: 21, maxWidth: 660 }}>{copy.subtitle}</Text>
            </View>

            <View style={{ width: isWebDesktop ? 340 : undefined, justifyContent: "center" }}>
              <View
                style={{
                  borderRadius: 22,
                  padding: 10,
                  backgroundColor: "rgba(9,13,11,0.44)",
                  borderWidth: 1,
                  borderColor: BORDER,
                  flexDirection: "row",
                  gap: 10,
                }}
              >
                <SegmentButton
                  active={mode === "product"}
                  label="Products"
                  icon="storefront-outline"
                  onPress={() => setMode("product")}
                />
                <SegmentButton
                  active={mode === "service"}
                  label="Services"
                  icon="briefcase-outline"
                  onPress={() => setMode("service")}
                />
              </View>
            </View>
          </View>
        </LinearGradient>

        <View style={{ marginTop: 18, marginBottom: 10, flexDirection: "row", alignItems: "flex-end", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: TEXT, fontWeight: "900", fontSize: 17 }}>
              {mode === "service" ? "Service Categories" : "Product Categories"}
            </Text>
            <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>
              {list.length} lanes available
            </Text>
          </View>
          <View
            style={{
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 7,
              backgroundColor: "rgba(255,253,247,0.07)",
              borderWidth: 1,
              borderColor: BORDER,
            }}
          >
            <Text style={{ color: AMBER, fontWeight: "900", fontSize: 12 }}>Escrow ready</Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {list.map((item) => (
            <CategoryCard key={item.slug} item={item} width={tileWidth} onPress={() => open(item.slug)} />
          ))}
        </View>

        <View
          style={{
            marginTop: 16,
            borderRadius: 22,
            padding: 14,
            backgroundColor: "rgba(45,212,191,0.08)",
            borderWidth: 1,
            borderColor: "rgba(94,234,212,0.24)",
            flexDirection: "row",
            gap: 10,
            alignItems: "flex-start",
          }}
        >
          <Ionicons name="shield-checkmark-outline" size={18} color={TEAL} style={{ marginTop: 1 }} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: TEXT, fontWeight: "900" }}>Use categories to narrow the market</Text>
            <Text style={{ marginTop: 5, color: MUTED, lineHeight: 18 }}>
              Products are physical listings. Services can be remote, digital, or in-person.
            </Text>
          </View>
        </View>
      </ScrollView>
    </LinearGradient>
  );
}
