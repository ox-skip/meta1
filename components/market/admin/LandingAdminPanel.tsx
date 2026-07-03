import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { uploadToSupabaseStorage } from "@/services/market/storageUpload";

const TEXT = "#FFF7ED";
const MUTED = "rgba(255,247,237,0.68)";
const FAINT = "rgba(255,247,237,0.46)";
const PANEL = "rgba(255,255,255,0.045)";
const BORDER = "rgba(245,158,11,0.16)";
const ACCENT = "#F59E0B";
const SUCCESS = "#4ADE80";
const DANGER = "#F87171";
const TEAL = "#2DD4BF";

type TabKey = "hero" | "sections" | "features" | "roadmap" | "team" | "faqs" | "demos";

type Props = {
  landing?: any | null;
  workingKey?: string | null;
  onAction: (actionKey: string, body: Record<string, unknown>, destructive?: boolean) => Promise<void>;
};

function emptyConfig() {
  return {
    brand_name: "BestCity Market",
    hero_eyebrow: "Trusted digital commerce for modern cities",
    hero_title: "BestCity Market",
    hero_subtitle: "",
    hero_media_url: "",
    hero_media_storage_path: "",
    primary_cta_label: "Enter the market",
    primary_cta_route: "/market",
    secondary_cta_label: "Create account",
    secondary_cta_route: "/register",
    company_overview: "",
    mission_title: "Our mission",
    mission_body: "",
    vision_title: "Our vision",
    vision_body: "",
    what_building_title: "What we are building",
    what_building_body: "",
    why_building_title: "Why we are building it",
    why_building_body: "",
    blockchain_title: "Why blockchain",
    blockchain_body: "",
    product_title: "Product details",
    product_body: "",
    stats_title: "Public platform statistics",
    stats_subtitle: "",
    roadmap_title: "Roadmap",
    roadmap_body: "",
    features_title: "Platform features",
    features_body: "",
    team_title: "Team",
    team_body: "",
    faq_title: "Frequently asked questions",
    faq_body: "",
    demo_title: "Product demo",
    demo_body: "",
    demo_cta_label: "Open product demo",
    contact_title: "Contact BestCity Market",
    contact_body: "",
    contact_email: "support@bestcity.market",
    contact_phone: "",
    contact_address: "",
    contact_cta_label: "Contact support",
    contact_cta_route: "/market/support",
  };
}

function inputText(value: unknown) {
  return String(value ?? "");
}

function safeFileName(value?: string | null) {
  return String(value || `landing-${Date.now()}`)
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 140);
}

function mimeFromName(name?: string | null) {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <View style={{ gap: 8, flex: 1, minWidth: 220 }}>
      <Text style={{ color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="rgba(248,250,252,0.36)"
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        style={{
          minHeight: multiline ? 96 : 44,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: BORDER,
          backgroundColor: "rgba(255,255,255,0.06)",
          color: TEXT,
          paddingHorizontal: 12,
          paddingVertical: 10,
          fontSize: 14,
        }}
      />
    </View>
  );
}

function ActionButton({
  label,
  icon,
  color = ACCENT,
  loading,
  disabled,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color?: string;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const blocked = disabled || loading;
  return (
    <Pressable
      disabled={blocked}
      onPress={onPress}
      style={{
        opacity: blocked ? 0.52 : 1,
        minHeight: 42,
        borderRadius: 8,
        paddingHorizontal: 13,
        paddingVertical: 11,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 8,
        backgroundColor: `${color}18`,
        borderWidth: 1,
        borderColor: `${color}38`,
      }}
    >
      {loading ? <ActivityIndicator color={color} /> : <Ionicons name={icon} size={16} color={color} />}
      <Text style={{ color, fontWeight: "900", fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

function RecordCard({
  title,
  subtitle,
  active,
  children,
}: {
  title: string;
  subtitle?: string;
  active?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <View style={{ borderRadius: 8, padding: 14, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER, gap: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: TEXT, fontWeight: "900", fontSize: 16 }}>{title}</Text>
          {subtitle ? <Text style={{ marginTop: 5, color: MUTED, fontSize: 12, lineHeight: 18 }}>{subtitle}</Text> : null}
        </View>
        {active === undefined ? null : (
          <View style={{ borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: active ? "rgba(74,222,128,0.15)" : "rgba(248,113,113,0.13)" }}>
            <Text style={{ color: active ? SUCCESS : DANGER, fontWeight: "900", fontSize: 10 }}>
              {active ? "LIVE" : "HIDDEN"}
            </Text>
          </View>
        )}
      </View>
      {children}
    </View>
  );
}

export default function LandingAdminPanel({ landing, workingKey, onAction }: Props) {
  const [tab, setTab] = useState<TabKey>("hero");
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [config, setConfig] = useState<Record<string, string>>(emptyConfig());
  const [section, setSection] = useState<Record<string, string>>({});
  const [feature, setFeature] = useState<Record<string, string>>({});
  const [roadmap, setRoadmap] = useState<Record<string, string>>({});
  const [team, setTeam] = useState<Record<string, string>>({});
  const [faq, setFaq] = useState<Record<string, string>>({});
  const [demo, setDemo] = useState<Record<string, string>>({});

  const counts = useMemo(() => ({
    sections: landing?.sections?.length ?? 0,
    features: landing?.features?.length ?? 0,
    roadmap: landing?.roadmap?.length ?? 0,
    team: landing?.team_members?.length ?? 0,
    faqs: landing?.faqs?.length ?? 0,
    demos: landing?.demo_videos?.length ?? 0,
  }), [landing]);

  useEffect(() => {
    setConfig({ ...emptyConfig(), ...(landing?.config ?? {}) });
  }, [landing?.config?.updated_at]);

  function patchConfig(key: string, value: string) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  async function pickAndUpload(kind: string) {
    setNotice(null);
    setUploading(kind);
    try {
      const DocumentPicker = require("expo-document-picker");
      const res = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
        type: kind.includes("video") ? "video/*" : "image/*",
      });
      if (res.canceled) return null;
      const asset = res.assets?.[0];
      if (!asset?.uri) return null;
      const name = safeFileName(asset.name || asset.uri.split("/").pop());
      const path = `${kind}/${Date.now()}-${name}`;
      const uploaded = await uploadToSupabaseStorage({
        bucket: "market-landing",
        path,
        localUri: asset.uri,
        fileBody: asset.file ?? null,
        contentType: asset.mimeType || mimeFromName(name),
        upsert: true,
      });
      setNotice("Media uploaded. Save the record to publish the change.");
      return uploaded;
    } catch (e: any) {
      const msg = String(e?.message || e || "");
      if (msg.toLowerCase().includes("abort") || msg.toLowerCase().includes("signal")) {
        setNotice("Upload timed out. Try again with a smaller file or check your connection.");
      } else {
        setNotice(msg.replace(/^\[storage\]\s*/i, ""));
      }
      return null;
    } finally {
      setUploading(null);
    }
  }

  function fillItem(setter: (next: Record<string, string>) => void, row: any) {
    const next: Record<string, string> = {};
    Object.keys(row ?? {}).forEach((key) => {
      if (row[key] === null || typeof row[key] === "object") return;
      next[key] = inputText(row[key]);
    });
    setter(next);
  }

  function renderTabs() {
    const tabs: Array<{ key: TabKey; label: string; count?: number }> = [
      { key: "hero", label: "Company" },
      { key: "sections", label: "Sections", count: counts.sections },
      { key: "features", label: "Features", count: counts.features },
      { key: "roadmap", label: "Roadmap", count: counts.roadmap },
      { key: "team", label: "Team", count: counts.team },
      { key: "faqs", label: "FAQs", count: counts.faqs },
      { key: "demos", label: "Demos", count: counts.demos },
    ];

    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {tabs.map((item) => {
          const selected = tab === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => setTab(item.key)}
              style={{
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 10,
                backgroundColor: selected ? "rgba(245,158,11,0.16)" : "rgba(255,255,255,0.04)",
                borderWidth: 1,
                borderColor: selected ? "rgba(245,158,11,0.50)" : BORDER,
                flexDirection: "row",
                gap: 7,
                alignItems: "center",
              }}
            >
              <Text style={{ color: selected ? ACCENT : MUTED, fontWeight: "900", fontSize: 12 }}>{item.label}</Text>
              {typeof item.count === "number" ? <Text style={{ color: FAINT, fontWeight: "900", fontSize: 11 }}>{item.count}</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    );
  }

  function renderHero() {
    return (
      <View style={{ gap: 16 }}>
        <RecordCard title="Hero, company story, and contact information" subtitle="Only the logo is bundled. Hero media can be uploaded here and changed without a build.">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <Field label="Brand name" value={config.brand_name} onChangeText={(v) => patchConfig("brand_name", v)} />
            <Field label="Hero eyebrow" value={config.hero_eyebrow} onChangeText={(v) => patchConfig("hero_eyebrow", v)} />
          </View>
          <Field label="Hero title" value={config.hero_title} onChangeText={(v) => patchConfig("hero_title", v)} />
          <Field label="Hero subtitle" value={config.hero_subtitle} onChangeText={(v) => patchConfig("hero_subtitle", v)} multiline />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <Field label="Primary CTA label" value={config.primary_cta_label} onChangeText={(v) => patchConfig("primary_cta_label", v)} />
            <Field label="Primary CTA route" value={config.primary_cta_route} onChangeText={(v) => patchConfig("primary_cta_route", v)} />
            <Field label="Secondary CTA label" value={config.secondary_cta_label} onChangeText={(v) => patchConfig("secondary_cta_label", v)} />
            <Field label="Secondary CTA route" value={config.secondary_cta_route} onChangeText={(v) => patchConfig("secondary_cta_route", v)} />
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <ActionButton
              icon="image-outline"
              label={uploading === "hero" ? "Uploading hero" : "Upload hero media"}
              color={TEAL}
              loading={uploading === "hero"}
              onPress={async () => {
                const uploaded = await pickAndUpload("hero");
                if (uploaded) {
                  patchConfig("hero_media_url", uploaded.publicUrl ?? "");
                  patchConfig("hero_media_storage_path", uploaded.storagePath);
                }
              }}
            />
            {config.hero_media_url ? (
              <View style={{ width: 90, height: 58, borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: BORDER }}>
                <Image source={{ uri: config.hero_media_url }} style={{ width: "100%", height: "100%" }} />
              </View>
            ) : null}
          </View>
        </RecordCard>

        <RecordCard title="Narrative sections" subtitle="This copy powers the mission, vision, product, blockchain, roadmap, demo, FAQ, and contact headers.">
          {[
            ["company_overview", "Company overview"],
            ["mission_body", "Mission body"],
            ["vision_body", "Vision body"],
            ["what_building_body", "What we are building"],
            ["why_building_body", "Why we are building"],
            ["blockchain_body", "Why blockchain"],
            ["product_body", "Product details"],
            ["stats_subtitle", "Statistics subtitle"],
            ["features_body", "Features intro"],
            ["roadmap_body", "Roadmap intro"],
            ["team_body", "Team intro"],
            ["faq_body", "FAQ intro"],
            ["demo_body", "Demo intro"],
            ["contact_body", "Contact intro"],
          ].map(([key, label]) => (
            <Field key={key} label={label} value={config[key]} onChangeText={(v) => patchConfig(key, v)} multiline />
          ))}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <Field label="Contact email" value={config.contact_email} onChangeText={(v) => patchConfig("contact_email", v)} />
            <Field label="Contact phone" value={config.contact_phone} onChangeText={(v) => patchConfig("contact_phone", v)} />
            <Field label="Contact address" value={config.contact_address} onChangeText={(v) => patchConfig("contact_address", v)} />
          </View>
        </RecordCard>

        <ActionButton
          icon="save-outline"
          label="Save public landing company content"
          color={SUCCESS}
          loading={workingKey === "landing-config"}
          onPress={() => onAction("landing-config", { action: "upsert_landing_config", ...config })}
        />
      </View>
    );
  }

  function renderSections() {
    const rows = landing?.sections ?? [];
    return (
      <View style={{ gap: 14 }}>
        <RecordCard title={section.id ? "Edit landing section" : "Add landing section"} subtitle="Use sections for rich story blocks. Images are optional and admin-uploaded.">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <Field label="Section key" value={section.section_key ?? "custom_section"} onChangeText={(v) => setSection((p) => ({ ...p, section_key: v }))} />
            <Field label="Eyebrow" value={section.eyebrow ?? ""} onChangeText={(v) => setSection((p) => ({ ...p, eyebrow: v }))} />
            <Field label="Sort order" value={section.sort_order ?? "100"} onChangeText={(v) => setSection((p) => ({ ...p, sort_order: v }))} />
          </View>
          <Field label="Title" value={section.title ?? ""} onChangeText={(v) => setSection((p) => ({ ...p, title: v }))} />
          <Field label="Body" value={section.body ?? ""} onChangeText={(v) => setSection((p) => ({ ...p, body: v }))} multiline />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <Field label="CTA label" value={section.cta_label ?? ""} onChangeText={(v) => setSection((p) => ({ ...p, cta_label: v }))} />
            <Field label="CTA URL or route" value={section.cta_url ?? ""} onChangeText={(v) => setSection((p) => ({ ...p, cta_url: v }))} />
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <ActionButton
              icon="image-outline"
              label={uploading === "section" ? "Uploading image" : "Upload section image"}
              color={TEAL}
              loading={uploading === "section"}
              onPress={async () => {
                const uploaded = await pickAndUpload("section");
                if (uploaded) setSection((p) => ({ ...p, media_url: uploaded.publicUrl ?? "", media_storage_path: uploaded.storagePath }));
              }}
            />
            <ActionButton
              icon="save-outline"
              label="Save section"
              color={SUCCESS}
              loading={workingKey === `landing-section-${section.id || "new"}`}
              onPress={() => onAction(`landing-section-${section.id || "new"}`, { action: "upsert_landing_section", ...section })}
            />
            <ActionButton icon="refresh-outline" label="Clear" onPress={() => setSection({})} />
          </View>
        </RecordCard>
        {rows.map((row: any) => (
          <RecordCard key={row.id} title={row.title} subtitle={row.body} active={row.active !== false}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <ActionButton icon="create-outline" label="Edit" onPress={() => fillItem(setSection, row)} />
              <ActionButton
                icon={row.active === false ? "eye-outline" : "eye-off-outline"}
                label={row.active === false ? "Publish" : "Hide"}
                color={row.active === false ? SUCCESS : DANGER}
                loading={workingKey === `landing-section-active-${row.id}`}
                onPress={() => onAction(`landing-section-active-${row.id}`, { action: "set_landing_item_active", item_type: "section", item_id: row.id, active: row.active === false }, true)}
              />
            </View>
          </RecordCard>
        ))}
      </View>
    );
  }

  function renderSimpleBuilder(kind: "feature" | "roadmap" | "faq") {
    const state = kind === "feature" ? feature : kind === "roadmap" ? roadmap : faq;
    const setState = kind === "feature" ? setFeature : kind === "roadmap" ? setRoadmap : setFaq;
    const rows = kind === "feature" ? landing?.features ?? [] : kind === "roadmap" ? landing?.roadmap ?? [] : landing?.faqs ?? [];
    const titleLabel = kind === "faq" ? "Question" : "Title";
    const bodyLabel = kind === "faq" ? "Answer" : "Body";
    const action = kind === "feature" ? "upsert_landing_feature" : kind === "roadmap" ? "upsert_landing_roadmap" : "upsert_landing_faq";
    const itemType = kind === "feature" ? "feature" : kind === "roadmap" ? "roadmap" : "faq";

    return (
      <View style={{ gap: 14 }}>
        <RecordCard title={state.id ? `Edit ${kind}` : `Add ${kind}`} subtitle="Keep copy direct and polished; the public page handles layout.">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <Field label={titleLabel} value={state.title ?? state.question ?? ""} onChangeText={(v) => setState((p) => ({ ...p, [kind === "faq" ? "question" : "title"]: v }))} />
            <Field label="Sort order" value={state.sort_order ?? "100"} onChangeText={(v) => setState((p) => ({ ...p, sort_order: v }))} />
          </View>
          {kind === "feature" ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <Field label="Icon key" value={state.icon_key ?? "sparkles-outline"} onChangeText={(v) => setState((p) => ({ ...p, icon_key: v }))} />
              <Field label="Accent" value={state.accent ?? "#2DD4BF"} onChangeText={(v) => setState((p) => ({ ...p, accent: v }))} />
            </View>
          ) : null}
          {kind === "roadmap" ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <Field label="Status" value={state.status ?? "planned"} onChangeText={(v) => setState((p) => ({ ...p, status: v }))} />
              <Field label="Target label" value={state.target_label ?? ""} onChangeText={(v) => setState((p) => ({ ...p, target_label: v }))} />
            </View>
          ) : null}
          <Field label={bodyLabel} value={state.body ?? state.answer ?? ""} onChangeText={(v) => setState((p) => ({ ...p, [kind === "faq" ? "answer" : "body"]: v }))} multiline />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <ActionButton
              icon="save-outline"
              label={`Save ${kind}`}
              color={SUCCESS}
              loading={workingKey === `landing-${kind}-${state.id || "new"}`}
              onPress={() => onAction(`landing-${kind}-${state.id || "new"}`, { action, ...state })}
            />
            <ActionButton icon="refresh-outline" label="Clear" onPress={() => setState({})} />
          </View>
        </RecordCard>
        {rows.map((row: any) => (
          <RecordCard key={row.id} title={row.title || row.question} subtitle={row.body || row.answer} active={row.active !== false}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <ActionButton icon="create-outline" label="Edit" onPress={() => fillItem(setState, row)} />
              <ActionButton
                icon={row.active === false ? "eye-outline" : "eye-off-outline"}
                label={row.active === false ? "Publish" : "Hide"}
                color={row.active === false ? SUCCESS : DANGER}
                loading={workingKey === `landing-${kind}-active-${row.id}`}
                onPress={() => onAction(`landing-${kind}-active-${row.id}`, { action: "set_landing_item_active", item_type: itemType, item_id: row.id, active: row.active === false }, true)}
              />
            </View>
          </RecordCard>
        ))}
      </View>
    );
  }

  function renderTeam() {
    const rows = landing?.team_members ?? [];
    return (
      <View style={{ gap: 14 }}>
        <RecordCard title={team.id ? "Edit team member" : "Add team member"} subtitle="Team photos are uploaded by admins and never hardcoded.">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <Field label="Name" value={team.name ?? ""} onChangeText={(v) => setTeam((p) => ({ ...p, name: v }))} />
            <Field label="Role title" value={team.role_title ?? ""} onChangeText={(v) => setTeam((p) => ({ ...p, role_title: v }))} />
            <Field label="Sort order" value={team.sort_order ?? "100"} onChangeText={(v) => setTeam((p) => ({ ...p, sort_order: v }))} />
          </View>
          <Field label="Bio" value={team.bio ?? ""} onChangeText={(v) => setTeam((p) => ({ ...p, bio: v }))} multiline />
          <Field label="Social URL" value={team.social_url ?? ""} onChangeText={(v) => setTeam((p) => ({ ...p, social_url: v }))} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <ActionButton
              icon="image-outline"
              label={uploading === "team" ? "Uploading photo" : "Upload team photo"}
              color={TEAL}
              loading={uploading === "team"}
              onPress={async () => {
                const uploaded = await pickAndUpload("team");
                if (uploaded) setTeam((p) => ({ ...p, image_url: uploaded.publicUrl ?? "", image_storage_path: uploaded.storagePath }));
              }}
            />
            <ActionButton
              icon="save-outline"
              label="Save team member"
              color={SUCCESS}
              loading={workingKey === `landing-team-${team.id || "new"}`}
              onPress={() => onAction(`landing-team-${team.id || "new"}`, { action: "upsert_landing_team_member", ...team })}
            />
            <ActionButton icon="refresh-outline" label="Clear" onPress={() => setTeam({})} />
          </View>
        </RecordCard>
        {rows.map((row: any) => (
          <RecordCard key={row.id} title={row.name} subtitle={row.role_title} active={row.active !== false}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <ActionButton icon="create-outline" label="Edit" onPress={() => fillItem(setTeam, row)} />
              <ActionButton
                icon={row.active === false ? "eye-outline" : "eye-off-outline"}
                label={row.active === false ? "Publish" : "Hide"}
                color={row.active === false ? SUCCESS : DANGER}
                loading={workingKey === `landing-team-active-${row.id}`}
                onPress={() => onAction(`landing-team-active-${row.id}`, { action: "set_landing_item_active", item_type: "team_member", item_id: row.id, active: row.active === false }, true)}
              />
            </View>
          </RecordCard>
        ))}
      </View>
    );
  }

  function renderDemos() {
    const rows = landing?.demo_videos ?? [];
    return (
      <View style={{ gap: 14 }}>
        <RecordCard title={demo.id ? "Edit demo video" : "Add demo video"} subtitle="Every demo needs a title. Videos are uploaded or linked here and the public demo URL uses the current domain.">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <Field label="Demo title" value={demo.title ?? ""} onChangeText={(v) => setDemo((p) => ({ ...p, title: v }))} />
            <Field label="Sort order" value={demo.sort_order ?? "100"} onChangeText={(v) => setDemo((p) => ({ ...p, sort_order: v }))} />
          </View>
          <Field label="Description" value={demo.description ?? ""} onChangeText={(v) => setDemo((p) => ({ ...p, description: v }))} multiline />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <Field label="Video URL" value={demo.video_url ?? ""} onChangeText={(v) => setDemo((p) => ({ ...p, video_url: v }))} />
            <Field label="Thumbnail URL" value={demo.thumbnail_url ?? ""} onChangeText={(v) => setDemo((p) => ({ ...p, thumbnail_url: v }))} />
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <ActionButton
              icon="videocam-outline"
              label={uploading === "demo-video" ? "Uploading video" : "Upload demo video"}
              color={TEAL}
              loading={uploading === "demo-video"}
              onPress={async () => {
                const uploaded = await pickAndUpload("demo-video");
                if (uploaded) setDemo((p) => ({ ...p, video_url: uploaded.publicUrl ?? "", video_storage_path: uploaded.storagePath }));
              }}
            />
            <ActionButton
              icon="image-outline"
              label={uploading === "demo-thumbnail" ? "Uploading thumbnail" : "Upload thumbnail"}
              color={ACCENT}
              loading={uploading === "demo-thumbnail"}
              onPress={async () => {
                const uploaded = await pickAndUpload("demo-thumbnail");
                if (uploaded) setDemo((p) => ({ ...p, thumbnail_url: uploaded.publicUrl ?? "", thumbnail_storage_path: uploaded.storagePath }));
              }}
            />
            <ActionButton
              icon="save-outline"
              label="Save demo"
              color={SUCCESS}
              loading={workingKey === `landing-demo-${demo.id || "new"}`}
              disabled={!String(demo.title ?? "").trim()}
              onPress={() => onAction(`landing-demo-${demo.id || "new"}`, { action: "upsert_landing_demo_video", ...demo })}
            />
            <ActionButton icon="refresh-outline" label="Clear" onPress={() => setDemo({})} />
          </View>
        </RecordCard>
        {rows.map((row: any) => (
          <RecordCard key={row.id} title={row.title} subtitle={row.description || row.video_url || "Demo video"} active={row.active !== false}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <ActionButton icon="create-outline" label="Edit" onPress={() => fillItem(setDemo, row)} />
              <ActionButton
                icon={row.active === false ? "eye-outline" : "eye-off-outline"}
                label={row.active === false ? "Publish" : "Hide"}
                color={row.active === false ? SUCCESS : DANGER}
                loading={workingKey === `landing-demo-active-${row.id}`}
                onPress={() => onAction(`landing-demo-active-${row.id}`, { action: "set_landing_item_active", item_type: "demo_video", item_id: row.id, active: row.active === false }, true)}
              />
            </View>
          </RecordCard>
        ))}
      </View>
    );
  }

  return (
    <View style={{ gap: 16 }}>
      <RecordCard title="Public landing website" subtitle="Manage the web-only BestCity Market public site. Logo stays bundled from assets/images/icon.png; every other image/video is managed here.">
        {renderTabs()}
        {notice ? (
          <View style={{ borderRadius: 8, padding: 12, backgroundColor: "rgba(45,212,191,0.10)", borderWidth: 1, borderColor: "rgba(45,212,191,0.24)" }}>
            <Text style={{ color: TEAL, fontWeight: "800" }}>{notice}</Text>
          </View>
        ) : null}
      </RecordCard>

      {tab === "hero" ? renderHero() : null}
      {tab === "sections" ? renderSections() : null}
      {tab === "features" ? renderSimpleBuilder("feature") : null}
      {tab === "roadmap" ? renderSimpleBuilder("roadmap") : null}
      {tab === "team" ? renderTeam() : null}
      {tab === "faqs" ? renderSimpleBuilder("faq") : null}
      {tab === "demos" ? renderDemos() : null}
    </View>
  );
}
