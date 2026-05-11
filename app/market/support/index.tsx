import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppHeader from "@/components/common/AppHeader";
import {
  createSupportTicket,
  fetchMySupportTickets,
  fetchSupportMessages,
  sendSupportMessage,
  subscribeToMySupportTickets,
  subscribeToSupportMessages,
  type SupportAttachment,
  type SupportLocalFile,
  type SupportMessage,
  type SupportTicket,
  type SupportTicketPriority,
  type SupportTicketStatus,
} from "@/services/market/support";
import { supabase } from "@/services/supabase";

const BG0 = "#06100D";
const BG1 = "#17120A";
const PANEL = "rgba(255,253,247,0.075)";
const PANEL_STRONG = "rgba(8,13,10,0.94)";
const BORDER = "rgba(255,253,247,0.13)";
const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.67)";
const FAINT = "rgba(255,253,247,0.43)";
const TEAL = "#2DD4BF";
const AMBER = "#F4B75D";
const BLUE = "#38BDF8";
const ROSE = "#FB7185";
const LIME = "#A3E635";

type FilterKey = "fresh" | "in_progress" | "resolved" | "closed" | "all";
type PickedFile = SupportLocalFile & { id: string };

const CATEGORIES = [
  { key: "order", label: "Order" },
  { key: "payment", label: "Payment" },
  { key: "listing", label: "Listing" },
  { key: "account", label: "Account" },
  { key: "safety", label: "Safety" },
  { key: "general", label: "Other" },
];

const PRIORITIES: Array<{ key: SupportTicketPriority; label: string }> = [
  { key: "NORMAL", label: "Normal" },
  { key: "HIGH", label: "High" },
  { key: "URGENT", label: "Urgent" },
];

function labelFromKey(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusColor(status: SupportTicketStatus | string) {
  const raw = String(status).toUpperCase();
  if (raw === "RESOLVED") return LIME;
  if (raw === "CLOSED") return FAINT;
  if (raw === "IN_PROGRESS") return BLUE;
  return AMBER;
}

function priorityColor(priority: SupportTicketPriority) {
  if (priority === "URGENT") return ROSE;
  if (priority === "HIGH") return AMBER;
  return TEAL;
}

function formatDate(value?: string | null) {
  if (!value) return "Now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Now";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fileKind(mime?: string | null, name?: string | null) {
  const raw = String(mime || name || "").toLowerCase();
  if (raw.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic)$/i.test(raw)) return "image";
  if (raw.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(raw)) return "video";
  if (raw.startsWith("audio/") || /\.(m4a|mp3|wav|aac)$/i.test(raw)) return "audio";
  return "file";
}

function fileIcon(kind: string): keyof typeof Ionicons.glyphMap {
  if (kind === "image") return "image-outline";
  if (kind === "video") return "videocam-outline";
  if (kind === "audio") return "mic-outline";
  return "document-attach-outline";
}

function messagePreview(message?: SupportMessage | null) {
  const text = String(message?.body || "").replace(/\s+/g, " ").trim();
  if (text) return text;
  if (message?.attachments?.length) return "[Attachment]";
  return "No message";
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: `${color}18`, borderWidth: 1, borderColor: `${color}3A` }}>
      <Text style={{ color, fontSize: 11, fontWeight: "900" }}>{label}</Text>
    </View>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text style={{ color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>{children}</Text>;
}

function Choice({
  label,
  selected,
  color,
  onPress,
}: {
  label: string;
  selected: boolean;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 9,
        backgroundColor: selected ? `${color}1E` : "rgba(255,255,255,0.045)",
        borderWidth: 1,
        borderColor: selected ? `${color}55` : BORDER,
      }}
    >
      <Text style={{ color: selected ? color : MUTED, fontWeight: "900", fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

function PrimaryButton({
  label,
  icon,
  color,
  onPress,
  disabled,
  loading,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const blocked = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={blocked}
      style={{
        minHeight: 46,
        borderRadius: 14,
        paddingHorizontal: 15,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 8,
        opacity: blocked ? 0.58 : 1,
        backgroundColor: `${color}22`,
        borderWidth: 1,
        borderColor: `${color}55`,
      }}
    >
      {loading ? <ActivityIndicator color={color} /> : <Ionicons name={icon} size={18} color={color} />}
      <Text style={{ color, fontWeight: "900" }}>{label}</Text>
    </Pressable>
  );
}

function FilterTabs({
  value,
  onChange,
  counts,
}: {
  value: FilterKey;
  onChange: (value: FilterKey) => void;
  counts: Record<FilterKey, number>;
}) {
  const options: Array<{ key: FilterKey; label: string; color: string }> = [
    { key: "fresh", label: "Fresh", color: AMBER },
    { key: "in_progress", label: "In progress", color: BLUE },
    { key: "resolved", label: "Resolved", color: LIME },
    { key: "closed", label: "Closed", color: FAINT },
    { key: "all", label: "All", color: TEAL },
  ];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
      {options.map((option) => {
        const selected = value === option.key;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            style={{
              borderRadius: 999,
              paddingHorizontal: 12,
              paddingVertical: 9,
              backgroundColor: selected ? `${option.color}1F` : "rgba(255,255,255,0.045)",
              borderWidth: 1,
              borderColor: selected ? `${option.color}55` : BORDER,
              flexDirection: "row",
              gap: 7,
              alignItems: "center",
            }}
          >
            <Text style={{ color: selected ? option.color : MUTED, fontWeight: "900", fontSize: 12 }}>{option.label}</Text>
            <Text style={{ color: selected ? option.color : FAINT, fontWeight: "900", fontSize: 12 }}>{counts[option.key]}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function PendingFiles({
  files,
  onRemove,
}: {
  files: PickedFile[];
  onRemove: (id: string) => void;
}) {
  if (!files.length) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {files.map((file) => {
        const kind = fileKind(file.mimeType, file.name);
        return (
          <View
            key={file.id}
            style={{
              maxWidth: 210,
              borderRadius: 13,
              padding: 9,
              backgroundColor: "rgba(255,255,255,0.055)",
              borderWidth: 1,
              borderColor: BORDER,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Ionicons name={fileIcon(kind)} size={17} color={kind === "image" ? TEAL : kind === "video" ? BLUE : AMBER} />
            <Text numberOfLines={1} style={{ color: TEXT, flex: 1, fontSize: 12, fontWeight: "800" }}>
              {file.name || "Proof"}
            </Text>
            <Pressable onPress={() => onRemove(file.id)} hitSlop={10}>
              <Ionicons name="close" size={16} color={FAINT} />
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

function AttachmentList({ attachments }: { attachments?: SupportAttachment[] }) {
  if (!attachments?.length) return null;
  return (
    <View style={{ marginTop: 9, gap: 7 }}>
      {attachments.map((attachment) => {
        const url = attachment.signed_url || attachment.public_url;
        const label = attachment.file_name || labelFromKey(attachment.kind);
        return (
          <Pressable
            key={attachment.id}
            onPress={() => {
              if (url) Linking.openURL(url);
            }}
            style={{
              borderRadius: 12,
              padding: 8,
              backgroundColor: "rgba(0,0,0,0.18)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.12)",
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            {attachment.kind === "image" && url ? (
              <Image source={{ uri: url }} style={{ width: 36, height: 36, borderRadius: 9 }} />
            ) : (
              <View style={{ width: 36, height: 36, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.07)" }}>
                <Ionicons name={fileIcon(attachment.kind)} size={18} color={attachment.kind === "video" ? BLUE : attachment.kind === "audio" ? AMBER : TEAL} />
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: TEXT, fontSize: 12, fontWeight: "900" }}>{label}</Text>
              <Text style={{ marginTop: 2, color: FAINT, fontSize: 10, fontWeight: "700" }}>{labelFromKey(attachment.kind)}</Text>
            </View>
            <Ionicons name="open-outline" size={15} color={MUTED} />
          </Pressable>
        );
      })}
    </View>
  );
}

function TicketCard({
  ticket,
  selected,
  onPress,
}: {
  ticket: SupportTicket;
  selected: boolean;
  onPress: () => void;
}) {
  const tone = statusColor(ticket.status);
  const preview = messagePreview(ticket.latest_message);
  return (
    <Pressable
      onPress={onPress}
      style={{
        borderRadius: 16,
        padding: 12,
        backgroundColor: selected ? "rgba(45,212,191,0.12)" : PANEL,
        borderWidth: 1,
        borderColor: selected ? "rgba(45,212,191,0.45)" : BORDER,
        flexDirection: "row",
        gap: 11,
        alignItems: "flex-start",
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 13,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${tone}18`,
          borderWidth: 1,
          borderColor: `${tone}42`,
        }}
      >
        <Ionicons name="chatbubbles-outline" size={19} color={tone} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <Text numberOfLines={1} style={{ flex: 1, color: TEXT, fontSize: 15, fontWeight: "900" }}>
            {ticket.subject}
          </Text>
          <Text style={{ color: FAINT, fontSize: 11, fontWeight: "800" }}>{formatDate(ticket.last_message_at)}</Text>
        </View>
        <Text numberOfLines={1} style={{ marginTop: 4, color: MUTED, fontSize: 12, lineHeight: 17 }}>
          {preview}
        </Text>
        <View style={{ marginTop: 9, flexDirection: "row", flexWrap: "wrap", gap: 7, alignItems: "center" }}>
          <Pill label={labelFromKey(ticket.status)} color={tone} />
          <Pill label={labelFromKey(ticket.priority)} color={priorityColor(ticket.priority)} />
          <Text style={{ color: FAINT, fontSize: 10, fontWeight: "800" }}>{labelFromKey(ticket.category)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function MessageRow({
  message,
  meId,
  onOpenDm,
}: {
  message: SupportMessage;
  meId: string | null;
  onOpenDm: (slug?: string | null) => void;
}) {
  const mine = !!meId && message.sender_id === meId;
  const fromAdmin = message.sender_kind === "ADMIN";
  const color = mine ? AMBER : fromAdmin ? TEAL : BLUE;
  return (
    <View style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "88%", marginTop: 10 }}>
      <View
        style={{
          borderRadius: 16,
          padding: 12,
          backgroundColor: mine ? "rgba(244,183,93,0.13)" : fromAdmin ? "rgba(45,212,191,0.12)" : "rgba(56,189,248,0.12)",
          borderWidth: 1,
          borderColor: `${color}38`,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
          <Text style={{ color, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>
            {mine ? "You" : fromAdmin ? "Support" : "User"}
          </Text>
          {!mine && message.message_slug ? (
            <Pressable onPress={() => onOpenDm(message.message_slug)} hitSlop={8}>
              <Ionicons name="chatbubble-ellipses-outline" size={15} color={color} />
            </Pressable>
          ) : null}
        </View>
        {message.body ? <Text style={{ marginTop: 6, color: TEXT, fontSize: 14, lineHeight: 20 }}>{message.body}</Text> : null}
        <AttachmentList attachments={message.attachments} />
      </View>
      <Text style={{ marginTop: 4, color: FAINT, fontSize: 10, textAlign: mine ? "right" : "left" }}>
        {formatDate(message.created_at)}
      </Text>
    </View>
  );
}

export default function MarketSupportScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ ticket?: string }>();
  const { width } = useWindowDimensions();
  const wide = width >= 940;
  const scrollRef = useRef<ScrollView>(null);

  const [meId, setMeId] = useState<string | null>(null);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("fresh");
  const [loading, setLoading] = useState(true);
  const [messageLoading, setMessageLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [picking, setPicking] = useState<"new" | "reply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("order");
  const [priority, setPriority] = useState<SupportTicketPriority>("NORMAL");
  const [relatedOrderId, setRelatedOrderId] = useState("");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");
  const [newFiles, setNewFiles] = useState<PickedFile[]>([]);
  const [replyFiles, setReplyFiles] = useState<PickedFile[]>([]);
  const [composerOpen, setComposerOpen] = useState(true);

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedId) ?? null,
    [selectedId, tickets],
  );

  const counts = useMemo(() => {
    const next: Record<FilterKey, number> = { fresh: 0, in_progress: 0, resolved: 0, closed: 0, all: tickets.length };
    tickets.forEach((ticket) => {
      if (ticket.status === "OPEN") next.fresh += 1;
      if (ticket.status === "IN_PROGRESS") next.in_progress += 1;
      if (ticket.status === "RESOLVED") next.resolved += 1;
      if (ticket.status === "CLOSED") next.closed += 1;
    });
    return next;
  }, [tickets]);

  const filteredTickets = useMemo(() => {
    if (filter === "all") return tickets;
    const status: Record<Exclude<FilterKey, "all">, SupportTicketStatus> = {
      fresh: "OPEN",
      in_progress: "IN_PROGRESS",
      resolved: "RESOLVED",
      closed: "CLOSED",
    };
    return tickets.filter((ticket) => ticket.status === status[filter]);
  }, [filter, tickets]);

  const latestAdminDmSlug = useMemo(() => {
    const found = [...messages].reverse().find((message) => message.sender_kind === "ADMIN" && message.message_slug);
    return found?.message_slug ?? null;
  }, [messages]);

  const loadTickets = useCallback(async (preferredId?: string | null) => {
    const rows = await fetchMySupportTickets();
    setTickets(rows);
    setSelectedId((current) => {
      const preferred = String(preferredId ?? "").trim();
      if (preferred && rows.some((ticket) => ticket.id === preferred)) return preferred;
      if (current && rows.some((ticket) => ticket.id === current)) return current;
      return null;
    });
  }, []);

  const loadMessages = useCallback(async (ticketId: string | null) => {
    if (!ticketId) {
      setMessages([]);
      return;
    }
    setMessageLoading(true);
    try {
      const rows = await fetchSupportMessages(ticketId);
      setMessages(rows);
    } finally {
      setMessageLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await supabase.auth.getUser();
        setMeId(data?.user?.id ?? null);
        await loadTickets(params.ticket ?? null);
      } catch (e: any) {
        if (mounted) setError(e?.message || "Could not load support.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [loadTickets, params.ticket]);

  useEffect(() => {
    let cleanup: undefined | (() => void);
    subscribeToMySupportTickets(() => {
      void loadTickets(selectedId);
    })
      .then((fn) => {
        cleanup = fn;
      })
      .catch(() => undefined);
    return () => {
      cleanup?.();
    };
  }, [loadTickets, selectedId]);

  useEffect(() => {
    void loadMessages(selectedId);
    if (!selectedId) return undefined;

    let cleanup: undefined | (() => void);
    subscribeToSupportMessages(selectedId, () => {
      void loadMessages(selectedId);
      void loadTickets(selectedId);
    })
      .then((fn) => {
        cleanup = fn;
      })
      .catch(() => undefined);
    return () => {
      cleanup?.();
    };
  }, [loadMessages, loadTickets, selectedId]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  async function pickProof(target: "new" | "reply") {
    setError(null);
    setPicking(target);
    try {
      const DocumentPicker = require("expo-document-picker");
      const res = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
        type: "*/*",
      });
      if (res.canceled) return;
      const picked: PickedFile[] = (res.assets ?? [])
        .filter((asset: any) => !!asset?.uri)
        .slice(0, 8)
        .map((asset: any) => ({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          uri: asset.uri,
          name: asset.name ?? `proof-${Date.now()}`,
          mimeType: asset.mimeType ?? null,
          size: typeof asset.size === "number" ? asset.size : null,
          fileBody: asset.file ?? null,
        }));
      if (!picked.length) return;
      if (target === "new") setNewFiles((prev) => [...prev, ...picked].slice(0, 8));
      else setReplyFiles((prev) => [...prev, ...picked].slice(0, 8));
    } catch (e: any) {
      setError(e?.message || "Could not attach proof.");
    } finally {
      setPicking(null);
    }
  }

  function openDm(slug?: string | null) {
    const clean = String(slug || "").trim();
    if (!clean) return;
    router.push(`/market/dm/${encodeURIComponent(clean)}` as any);
  }

  async function submitTicket() {
    setError(null);
    setNotice(null);
    setCreating(true);
    try {
      const ticket = await createSupportTicket({
        subject,
        category,
        priority,
        body,
        relatedOrderId: relatedOrderId.trim() || null,
        attachments: newFiles,
      });
      setSubject("");
      setBody("");
      setRelatedOrderId("");
      setPriority("NORMAL");
      setCategory("order");
      setNewFiles([]);
      setSelectedId(ticket.id);
      setFilter("fresh");
      await loadTickets(ticket.id);
      await loadMessages(ticket.id);
      setNotice("Support ticket sent.");
    } catch (e: any) {
      setError(e?.message || "Could not send support ticket.");
    } finally {
      setCreating(false);
    }
  }

  async function submitReply() {
    if (!selectedId) return;
    setError(null);
    setNotice(null);
    setSending(true);
    try {
      await sendSupportMessage(selectedId, reply, replyFiles);
      setReply("");
      setReplyFiles([]);
      await loadMessages(selectedId);
      await loadTickets(selectedId);
    } catch (e: any) {
      setError(e?.message || "Could not send reply.");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <LinearGradient colors={[BG1, BG0]} style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <ActivityIndicator color={TEAL} />
        <Text style={{ marginTop: 12, color: TEXT, fontWeight: "900" }}>Opening support</Text>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={[BG1, BG0]} start={{ x: 0.08, y: 0 }} end={{ x: 0.94, y: 1 }} style={{ flex: 1, paddingTop: Math.max(insets.top, 12) }}>
      <AppHeader title="Support" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: wide ? 24 : 16,
            paddingTop: 10,
            paddingBottom: insets.bottom + 120,
          }}
        >
          <View style={{ width: "100%", maxWidth: 1180, alignSelf: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Pressable
                onPress={() => router.back()}
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: PANEL,
                  borderWidth: 1,
                  borderColor: BORDER,
                }}
              >
                <Ionicons name="chevron-back" size={22} color={TEXT} />
              </Pressable>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: TEAL, fontSize: 12, fontWeight: "900", textTransform: "uppercase" }}>Marketplace support</Text>
                <Text style={{ marginTop: 5, color: TEXT, fontSize: wide ? 30 : 25, fontWeight: "900" }}>Cases and proof</Text>
                <Text style={{ marginTop: 5, color: MUTED, fontSize: 13, lineHeight: 20 }}>
                  Track each case separately, attach evidence, and continue by DM when a support admin replies.
                </Text>
              </View>
            </View>

            {error ? (
              <View style={{ marginTop: 16, borderRadius: 15, padding: 13, backgroundColor: "rgba(251,113,133,0.13)", borderWidth: 1, borderColor: "rgba(251,113,133,0.35)" }}>
                <Text style={{ color: "#FDA4AF", fontWeight: "900" }}>{error}</Text>
              </View>
            ) : null}
            {notice ? (
              <View style={{ marginTop: 16, borderRadius: 15, padding: 13, backgroundColor: "rgba(45,212,191,0.12)", borderWidth: 1, borderColor: "rgba(45,212,191,0.32)" }}>
                <Text style={{ color: TEAL, fontWeight: "900" }}>{notice}</Text>
              </View>
            ) : null}

            <View style={{ marginTop: 18, flexDirection: wide ? "row" : "column", gap: 14, alignItems: "flex-start" }}>
              <View style={{ width: wide ? 410 : "100%", gap: 14 }}>
                <View style={{ borderRadius: 22, padding: 16, backgroundColor: PANEL_STRONG, borderWidth: 1, borderColor: BORDER }}>
                  <Pressable onPress={() => setComposerOpen((prev) => !prev)} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <View>
                      <Text style={{ color: TEXT, fontSize: 18, fontWeight: "900" }}>New ticket</Text>
                      <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>Attach screenshots, videos, PDFs, or receipts.</Text>
                    </View>
                    <Ionicons name={composerOpen ? "chevron-up" : "chevron-down"} size={20} color={TEAL} />
                  </Pressable>

                  {composerOpen ? (
                    <View style={{ marginTop: 16, gap: 12 }}>
                      <View style={{ gap: 7 }}>
                        <FieldLabel>Subject</FieldLabel>
                        <TextInput
                          value={subject}
                          onChangeText={setSubject}
                          placeholder="Short summary"
                          placeholderTextColor="rgba(255,253,247,0.35)"
                          style={{ minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: BORDER, backgroundColor: "rgba(255,255,255,0.055)", color: TEXT, paddingHorizontal: 12, fontSize: 14 }}
                        />
                      </View>

                      <View style={{ gap: 8 }}>
                        <FieldLabel>Category</FieldLabel>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                          {CATEGORIES.map((item) => (
                            <Choice key={item.key} label={item.label} selected={category === item.key} color={TEAL} onPress={() => setCategory(item.key)} />
                          ))}
                        </View>
                      </View>

                      <View style={{ gap: 8 }}>
                        <FieldLabel>Priority</FieldLabel>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                          {PRIORITIES.map((item) => (
                            <Choice key={item.key} label={item.label} selected={priority === item.key} color={priorityColor(item.key)} onPress={() => setPriority(item.key)} />
                          ))}
                        </View>
                      </View>

                      <View style={{ gap: 7 }}>
                        <FieldLabel>Order ID</FieldLabel>
                        <TextInput
                          value={relatedOrderId}
                          onChangeText={setRelatedOrderId}
                          autoCapitalize="none"
                          placeholder="Optional"
                          placeholderTextColor="rgba(255,253,247,0.35)"
                          style={{ minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: BORDER, backgroundColor: "rgba(255,255,255,0.055)", color: TEXT, paddingHorizontal: 12, fontSize: 14 }}
                        />
                      </View>

                      <View style={{ gap: 7 }}>
                        <FieldLabel>Message</FieldLabel>
                        <TextInput
                          value={body}
                          onChangeText={setBody}
                          multiline
                          placeholder="What happened?"
                          placeholderTextColor="rgba(255,253,247,0.35)"
                          style={{ minHeight: 116, borderRadius: 14, borderWidth: 1, borderColor: BORDER, backgroundColor: "rgba(255,255,255,0.055)", color: TEXT, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, textAlignVertical: "top" }}
                        />
                      </View>

                      <PendingFiles files={newFiles} onRemove={(id) => setNewFiles((prev) => prev.filter((file) => file.id !== id))} />
                      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                        <PrimaryButton
                          label={picking === "new" ? "Attaching" : "Attach proof"}
                          icon="document-attach-outline"
                          color={BLUE}
                          loading={picking === "new"}
                          onPress={() => void pickProof("new")}
                        />
                        <PrimaryButton
                          label={creating ? "Sending" : "Send ticket"}
                          icon="paper-plane-outline"
                          color={TEAL}
                          loading={creating}
                          disabled={!subject.trim() || (!body.trim() && !newFiles.length)}
                          onPress={submitTicket}
                        />
                      </View>
                    </View>
                  ) : null}
                </View>

                <View style={{ borderRadius: 22, padding: 16, backgroundColor: PANEL_STRONG, borderWidth: 1, borderColor: BORDER }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <View>
                      <Text style={{ color: TEXT, fontSize: 18, fontWeight: "900" }}>Tickets</Text>
                      <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>{tickets.length} total</Text>
                    </View>
                    <PrimaryButton label="Refresh" icon="refresh" color={AMBER} onPress={() => void loadTickets(selectedId)} />
                  </View>

                  <View style={{ marginTop: 13 }}>
                    <FilterTabs value={filter} onChange={setFilter} counts={counts} />
                  </View>

                  <View style={{ marginTop: 13, gap: 10 }}>
                    {filteredTickets.length ? filteredTickets.map((ticket) => (
                      <TicketCard key={ticket.id} ticket={ticket} selected={ticket.id === selectedId} onPress={() => setSelectedId(ticket.id)} />
                    )) : (
                      <View style={{ borderRadius: 16, padding: 15, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER }}>
                        <Text style={{ color: TEXT, fontWeight: "900" }}>No {filter === "fresh" ? "fresh" : labelFromKey(filter)} tickets</Text>
                        <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 19 }}>Switch filters or open a new support ticket.</Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>

              <View style={{ flex: 1, width: wide ? undefined : "100%", minWidth: 0 }}>
                <View style={{ borderRadius: 22, padding: 16, backgroundColor: PANEL_STRONG, borderWidth: 1, borderColor: BORDER, minHeight: 520 }}>
                  {selectedTicket ? (
                    <>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                        <View style={{ flex: 1, minWidth: 220 }}>
                          <Text style={{ color: TEXT, fontSize: 21, fontWeight: "900" }}>{selectedTicket.subject}</Text>
                          <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>
                            {labelFromKey(selectedTicket.category)} - Created {formatDate(selectedTicket.created_at)}
                          </Text>
                        </View>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                          <Pill label={labelFromKey(selectedTicket.status)} color={statusColor(selectedTicket.status)} />
                          <Pill label={labelFromKey(selectedTicket.priority)} color={priorityColor(selectedTicket.priority)} />
                        </View>
                      </View>

                      <View style={{ marginTop: 12, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                        {selectedTicket.related_order_id ? (
                          <PrimaryButton label="Open order" icon="receipt-outline" color={BLUE} onPress={() => router.push(`/market/order/${selectedTicket.related_order_id}` as any)} />
                        ) : null}
                        {latestAdminDmSlug ? (
                          <PrimaryButton label="Message admin" icon="chatbubble-ellipses-outline" color={TEAL} onPress={() => openDm(latestAdminDmSlug)} />
                        ) : null}
                      </View>

                      <ScrollView
                        ref={scrollRef}
                        style={{ marginTop: 14, maxHeight: wide ? 520 : 410 }}
                        contentContainerStyle={{ paddingBottom: 6 }}
                        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
                      >
                        {messageLoading ? (
                          <View style={{ paddingVertical: 32, alignItems: "center" }}>
                            <ActivityIndicator color={TEAL} />
                          </View>
                        ) : messages.length ? (
                          messages.map((message) => <MessageRow key={message.id} message={message} meId={meId} onOpenDm={openDm} />)
                        ) : (
                          <View style={{ borderRadius: 16, padding: 14, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER }}>
                            <Text style={{ color: TEXT, fontWeight: "900" }}>No messages recorded.</Text>
                          </View>
                        )}
                      </ScrollView>

                      <View style={{ marginTop: 14, gap: 8 }}>
                        <FieldLabel>Reply</FieldLabel>
                        <TextInput
                          value={reply}
                          onChangeText={setReply}
                          multiline
                          placeholder="Write a reply"
                          placeholderTextColor="rgba(255,253,247,0.35)"
                          style={{ minHeight: 66, borderRadius: 14, borderWidth: 1, borderColor: BORDER, backgroundColor: "rgba(255,255,255,0.055)", color: TEXT, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, textAlignVertical: "top" }}
                        />
                        <PendingFiles files={replyFiles} onRemove={(id) => setReplyFiles((prev) => prev.filter((file) => file.id !== id))} />
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                          <PrimaryButton
                            label={picking === "reply" ? "Attaching" : "Attach proof"}
                            icon="document-attach-outline"
                            color={BLUE}
                            loading={picking === "reply"}
                            onPress={() => void pickProof("reply")}
                          />
                          <PrimaryButton
                            label={sending ? "Sending" : "Send"}
                            icon="send"
                            color={TEAL}
                            loading={sending}
                            disabled={!reply.trim() && !replyFiles.length}
                            onPress={submitReply}
                          />
                        </View>
                      </View>
                    </>
                  ) : (
                    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 40 }}>
                      <Ionicons name="chatbubbles-outline" size={32} color={FAINT} />
                      <Text style={{ marginTop: 12, color: TEXT, fontSize: 18, fontWeight: "900" }}>Select a ticket</Text>
                      <Text style={{ marginTop: 6, color: MUTED, fontSize: 13 }}>Create or choose a ticket to view the conversation.</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}
