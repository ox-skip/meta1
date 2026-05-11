import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";

import AppHeader from "@/components/common/AppHeader";
import { PRODUCT_CATEGORIES, SERVICE_CATEGORIES } from "@/services/market/categories";
import type { CategoryItem } from "@/services/market/categories";

const BG0 = "#060807";
const BG1 = "#10130E";
const BG2 = "#171A13";
const INK = "#090D0B";
const TEAL = "#2DD4BF";
const AMBER = "#F4B75D";
const BLUE = "#38BDF8";
const ROSE = "#FB7185";
const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.68)";
const FAINT = "rgba(255,253,247,0.46)";
const CARD = "rgba(255,253,247,0.065)";
const BORDER = "rgba(255,253,247,0.12)";
const BORDER_TOP = "rgba(255,253,247,0.24)";

function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: () => void;
}) {
  return (
    <View style={{ marginTop: 18, marginBottom: 10, flexDirection: "row", alignItems: "flex-end", gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: TEXT, fontWeight: "900", fontSize: 16 }}>{title}</Text>
        <Text style={{ color: MUTED, marginTop: 4, fontSize: 12 }}>{subtitle}</Text>
      </View>
      {action ? (
        <Pressable
          onPress={action}
          style={({ pressed }) => ({
            borderRadius: 999,
            paddingHorizontal: 11,
            paddingVertical: 8,
            backgroundColor: pressed ? "rgba(255,253,247,0.13)" : "rgba(255,253,247,0.07)",
            borderWidth: 1,
            borderColor: BORDER,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          })}
        >
          <Text style={{ color: TEXT, fontWeight: "900", fontSize: 12 }}>View all</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function EntryCard({
  title,
  subtitle,
  icon,
  tone,
  onPress,
}: {
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 150,
        borderRadius: 22,
        padding: 14,
        backgroundColor: pressed ? "rgba(255,253,247,0.09)" : CARD,
        borderWidth: 1,
        borderColor: pressed ? BORDER_TOP : BORDER,
        transform: [{ translateY: pressed ? 1 : 0 }],
      })}
    >
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 16,
          backgroundColor: `${tone}24`,
          borderWidth: 1,
          borderColor: `${tone}55`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={20} color={tone} />
      </View>
      <Text style={{ marginTop: 12, color: TEXT, fontWeight: "900", fontSize: 15 }}>{title}</Text>
      <Text style={{ marginTop: 5, color: MUTED, fontSize: 12, lineHeight: 17 }}>{subtitle}</Text>
    </Pressable>
  );
}

function CategoryTile({
  item,
  onPress,
  width,
}: {
  item: CategoryItem;
  onPress: () => void;
  width: `${number}%`;
}) {
  const isService = item.main === "service";
  const tone = isService ? BLUE : TEAL;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        width,
        minHeight: 118,
        borderRadius: 22,
        padding: 13,
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
            backgroundColor: `${tone}22`,
            borderWidth: 1,
            borderColor: `${tone}44`,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={19} color={tone} />
        </View>
        <Ionicons name="chevron-forward" size={16} color={FAINT} />
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

function StatPill({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <View
      style={{
        flex: 1,
        minWidth: 104,
        borderRadius: 18,
        padding: 11,
        backgroundColor: "rgba(9,13,11,0.42)",
        borderWidth: 1,
        borderColor: `${tone}40`,
      }}
    >
      <Text style={{ color: MUTED, fontWeight: "900", fontSize: 11 }}>{label}</Text>
      <Text numberOfLines={1} style={{ marginTop: 6, color: TEXT, fontWeight: "900", fontSize: 17 }}>
        {value}
      </Text>
    </View>
  );
}

export default function MarketCategoryTab() {
  const [q, setQ] = useState("");
  const { width } = useWindowDimensions();
  const isWebDesktop = Platform.OS === "web" && width >= 980;
  const contentMaxWidth = isWebDesktop ? 1120 : undefined;
  const pagePadding = isWebDesktop ? 28 : 16;
  const tileWidth = (width >= 860 ? "31.8%" : "48%") as `${number}%`;

  const quickProducts = useMemo(() => PRODUCT_CATEGORIES.slice(0, 6), []);
  const quickServices = useMemo(() => SERVICE_CATEGORIES.slice(0, 6), []);

  function openCategory(slug: string) {
    router.push(`/market/category/${slug}` as any);
  }

  function openCategoryPicker(mode?: "product" | "service") {
    router.push({ pathname: "/market/category" as any, params: mode ? { mode } : {} });
  }

  function onSearch() {
    const term = q.trim();
    if (!term) return;
    router.push({ pathname: "/market/search" as any, params: { q: term } });
  }

  return (
    <LinearGradient
      colors={[BG2, BG1, BG0]}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={{ flex: 1, paddingHorizontal: pagePadding, paddingTop: 14 }}
    >
      <View style={{ alignSelf: "center", width: "100%", maxWidth: contentMaxWidth }}>
        <AppHeader
          title="Categories"
          subtitle="Products, services, and escrow-ready offers"
          bordered={false}
          style={{ backgroundColor: "transparent", paddingHorizontal: 0 }}
        />
      </View>

      <ScrollView
        contentContainerStyle={{
          alignSelf: "center",
          width: "100%",
          maxWidth: contentMaxWidth,
          paddingBottom: 132,
        }}
      >
        <LinearGradient
          colors={["rgba(45,212,191,0.18)", "rgba(56,189,248,0.08)", "rgba(255,253,247,0.055)"]}
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
          <View style={{ flexDirection: isWebDesktop ? "row" : "column", gap: 18, alignItems: "stretch" }}>
            <View style={{ flex: 1.15, minWidth: 0 }}>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <View
                  style={{
                    borderRadius: 999,
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    backgroundColor: "rgba(9,13,11,0.48)",
                    borderWidth: 1,
                    borderColor: "rgba(94,234,212,0.30)",
                  }}
                >
                  <Text style={{ color: TEAL, fontWeight: "900", fontSize: 12 }}>Escrow protected</Text>
                </View>
                <View
                  style={{
                    borderRadius: 999,
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    backgroundColor: "rgba(9,13,11,0.38)",
                    borderWidth: 1,
                    borderColor: "rgba(244,183,93,0.30)",
                  }}
                >
                  <Text style={{ color: AMBER, fontWeight: "900", fontSize: 12 }}>Local and remote</Text>
                </View>
              </View>

              <Text
                style={{
                  marginTop: 15,
                  color: TEXT,
                  fontWeight: "900",
                  fontSize: isWebDesktop ? 34 : 28,
                  lineHeight: isWebDesktop ? 40 : 34,
                }}
              >
                Find the right market lane fast.
              </Text>
              <Text style={{ marginTop: 9, color: MUTED, lineHeight: 21, maxWidth: 650 }}>
                Browse products, hire services, or search directly across marketplace listings and stores.
              </Text>

              <View
                style={{
                  marginTop: 15,
                  flexDirection: "row",
                  gap: 10,
                  borderRadius: 20,
                  padding: 10,
                  borderWidth: 1,
                  borderColor: BORDER,
                  backgroundColor: "rgba(9,13,11,0.52)",
                  alignItems: "center",
                }}
              >
                <Ionicons name="search-outline" size={18} color={MUTED} />
                <TextInput
                  value={q}
                  onChangeText={setQ}
                  placeholder="Search products, services, or stores"
                  placeholderTextColor={FAINT}
                  style={{ flex: 1, color: TEXT, fontWeight: "800", minWidth: 0 }}
                  returnKeyType="search"
                  onSubmitEditing={onSearch}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Pressable
                  onPress={onSearch}
                  accessibilityRole="button"
                  style={({ pressed }) => ({
                    width: 40,
                    height: 40,
                    borderRadius: 15,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: pressed ? "rgba(94,234,212,0.82)" : TEAL,
                    transform: [{ scale: pressed ? 0.96 : 1 }],
                  })}
                >
                  <Ionicons name="arrow-forward" size={18} color={INK} />
                </Pressable>
              </View>
            </View>

            <View style={{ width: isWebDesktop ? 330 : undefined, gap: 10 }}>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <StatPill label="Products" value={String(PRODUCT_CATEGORIES.length)} tone={TEAL} />
                <StatPill label="Services" value={String(SERVICE_CATEGORIES.length)} tone={BLUE} />
              </View>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <EntryCard
                  title="Products"
                  subtitle="Shop goods"
                  icon="storefront-outline"
                  tone={TEAL}
                  onPress={() => openCategoryPicker("product")}
                />
                <EntryCard
                  title="Services"
                  subtitle="Hire help"
                  icon="briefcase-outline"
                  tone={BLUE}
                  onPress={() => openCategoryPicker("service")}
                />
              </View>
            </View>
          </View>
        </LinearGradient>

        <SectionHeader
          title="Popular Products"
          subtitle="Fast paths into active product lanes"
          action={() => openCategoryPicker("product")}
        />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {quickProducts.map((item) => (
            <CategoryTile key={item.slug} item={item} width={tileWidth} onPress={() => openCategory(item.slug)} />
          ))}
        </View>

        <SectionHeader
          title="Popular Services"
          subtitle="Remote work, on-site help, and digital delivery"
          action={() => openCategoryPicker("service")}
        />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {quickServices.map((item) => (
            <CategoryTile key={item.slug} item={item} width={tileWidth} onPress={() => openCategory(item.slug)} />
          ))}
        </View>

        <Pressable
          onPress={() => openCategoryPicker()}
          accessibilityRole="button"
          style={({ pressed }) => ({
            marginTop: 16,
            borderRadius: 22,
            paddingVertical: 15,
            paddingHorizontal: 16,
            alignItems: "center",
            borderWidth: 1,
            borderColor: "rgba(94,234,212,0.32)",
            backgroundColor: pressed ? "rgba(45,212,191,0.16)" : "rgba(45,212,191,0.10)",
            flexDirection: "row",
            justifyContent: "center",
            gap: 8,
            transform: [{ translateY: pressed ? 1 : 0 }],
          })}
        >
          <Ionicons name="grid-outline" size={18} color={TEAL} />
          <Text style={{ color: TEXT, fontWeight: "900" }}>Open full category directory</Text>
        </Pressable>
      </ScrollView>
    </LinearGradient>
  );
}
