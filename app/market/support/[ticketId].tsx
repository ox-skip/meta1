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
  generateSupportAiTriage,
  loadAdminSupportTicket,
  runAdminAction,
  type MarketSupportAiTriageResult,
} from "@/services/market/admin";
import {
  fetchSupportMessages,
  fetchSupportTicket,
  sendSupportMessage,
  subscribeToSupportMessages,
  uploadSupportFiles,
  type SupportAttachment,
  type SupportLocalFile,
  type SupportMessage,
  type SupportTicket,
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
const FAINT = "rgba(255,253,247,0.46)";
const TEAL = "#2DD4BF";
const LIME = "#8AE66E";
const AMBER = "#F59E0B";
const BLUE = "#60A5FA";
const ROSE = "#FB7185";

type PickedFile = SupportLocalFile & { id: string };
type MessageLike = SupportMessage & { sender?: any };
type TicketLike = SupportTicket & {
  user?: any;
  assigned_admin?: any;
  messages?: MessageLike[];
};

function paramString(value: string | string[] | undefined) {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

function shortId(value?: string | null) {
  const raw = String(value ?? "").replace(/-/g, "");
  return raw ? raw.slice(0, 8).toUpperCase() : "CASE";
}

function labelFromKey(value?: string | null) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value?: string | null) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusColor(status?: string | null) {
  const raw = String(status || "").toUpperCase();
  if (raw === "RESOLVED" || raw === "CLOSED") return LIME;
  if (raw === "IN_PROGRESS") return BLUE;
  return TEAL;
}

function priorityColor(priority?: string | null) {
  const raw = String(priority || "").toUpperCase();
  if (raw === "URGENT") return ROSE;
  if (raw === "HIGH") return AMBER;
  if (raw === "LOW") return FAINT;
  return TEAL;
}

function personLabel(user: any) {
  return String(
    user?.seller?.display_name ||
      user?.seller?.business_name ||
      user?.seller?.market_username ||
      user?.profile?.full_name ||
      user?.profile?.username ||
      user?.profile?.email ||
      shortId(user?.id),
  );
}

function caseSlug(ticket?: TicketLike | null) {
  if (!ticket?.id) return "support-case";
  return `support-${shortId(ticket.id).toLowerCase()}`;
}

function messageSlug(message: MessageLike) {
  const slug = String(message.message_slug || "").trim();
  return slug ? `@${slug}` : `msg-${shortId(message.id).toLowerCase()}`;
}

function fileIcon(kind?: string | null): keyof typeof Ionicons.glyphMap {
  const raw = String(kind || "").toLowerCase();
  if (raw === "image") return "image-outline";
  if (raw === "video") return "videocam-outline";
  if (raw === "audio") return "mic-outline";
  return "document-attach-outline";
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View
      style={{
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
        backgroundColor: `${color}18`,
        borderWidth: 1,
        borderColor: `${color}38`,
      }}
    >
      <Text style={{ color, fontSize: 11, fontWeight: "900" }}>{label}</Text>
    </View>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text style={{ color: MUTED, fontSize: 12, fontWeight: "900", textTransform: "uppercase" }}>{children}</Text>;
}

function ActionButton({
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
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => ({
        minHeight: 44,
        borderRadius: 14,
        paddingHorizontal: 13,
        paddingVertical: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        backgroundColor: disabled ? "rgba(255,255,255,0.05)" : `${color}18`,
        borderWidth: 1,
        borderColor: disabled ? BORDER : `${color}45`,
        opacity: pressed ? 0.82 : disabled ? 0.5 : 1,
      })}
    >
      {loading ? <ActivityIndicator color={color} /> : <Ionicons name={icon} size={17} color={color} />}
      <Text style={{ color, fontSize: 13, fontWeight: "900" }}>{label}</Text>
    </Pressable>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ minWidth: 130, flex: 1 }}>
      <Text style={{ color: FAINT, fontSize: 11, fontWeight: "800", textTransform: "uppercase" }}>{label}</Text>
      <Text numberOfLines={1} style={{ marginTop: 4, color: TEXT, fontSize: 13, fontWeight: "900" }}>{value}</Text>
    </View>
  );
}

function PendingFiles({ files, onRemove }: { files: PickedFile[]; onRemove: (id: string) => void }) {
  if (!files.length) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {files.map((file) => (
        <Pressable
          key={file.id}
          onPress={() => onRemove(file.id)}
          style={{
            maxWidth: "100%",
            borderRadius: 999,
            paddingHorizontal: 10,
            paddingVertical: 7,
            flexDirection: "row",
            alignItems: "center",
            gap: 7,
            backgroundColor: "rgba(96,165,250,0.12)",
            borderWidth: 1,
            borderColor: "rgba(96,165,250,0.28)",
          }}
        >
          <Ionicons name="document-attach-outline" size={14} color={BLUE} />
          <Text numberOfLines={1} style={{ maxWidth: 180, color: TEXT, fontSize: 12, fontWeight: "900" }}>
            {file.name || "proof"}
          </Text>
          <Ionicons name="close" size={14} color={FAINT} />
        </Pressable>
      ))}
    </View>
  );
}

function AttachmentList({
  attachments,
  onOpen,
}: {
  attachments?: SupportAttachment[];
  onOpen: (attachment: SupportAttachment) => void;
}) {
  if (!attachments?.length) return null;
  return (
    <View style={{ marginTop: 9, gap: 8 }}>
      {attachments.map((attachment) => {
        const url = attachment.signed_url || attachment.public_url;
        const label = attachment.file_name || labelFromKey(attachment.kind);
        return (
          <Pressable
            key={attachment.id}
            onPress={() => onOpen(attachment)}
            style={{
              borderRadius: 14,
              padding: 8,
              backgroundColor: "rgba(0,0,0,0.18)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.11)",
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            {attachment.kind === "image" && url ? (
              <Image source={{ uri: url }} style={{ width: 38, height: 38, borderRadius: 10 }} />
            ) : (
              <View style={{ width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.07)" }}>
                <Ionicons name={fileIcon(attachment.kind)} size={18} color={attachment.kind === "video" ? BLUE : attachment.kind === "audio" ? AMBER : TEAL} />
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: TEXT, fontSize: 12, fontWeight: "900" }}>{label}</Text>
              <Text style={{ marginTop: 2, color: FAINT, fontSize: 10, fontWeight: "800" }}>{labelFromKey(attachment.kind)}</Text>
            </View>
            <Ionicons name="open-outline" size={15} color={MUTED} />
          </Pressable>
        );
      })}
    </View>
  );
}

function MessageBubble({
  message,
  adminMode,
  meId,
  onOpenAttachment,
}: {
  message: MessageLike;
  adminMode: boolean;
  meId: string | null;
  onOpenAttachment: (attachment: SupportAttachment) => void;
}) {
  const fromAdmin = String(message.sender_kind || "").toUpperCase() === "ADMIN";
  const alignRight = adminMode ? fromAdmin : fromAdmin ? false : message.sender_id === meId || String(message.sender_kind).toUpperCase() === "USER";
  const color = fromAdmin ? TEAL : AMBER;
  return (
    <View
      style={{
        alignSelf: alignRight ? "flex-end" : "flex-start",
        width: "100%",
        maxWidth: 760,
      }}
    >
      <View
        style={{
          alignSelf: alignRight ? "flex-end" : "flex-start",
          maxWidth: "92%",
          borderRadius: 18,
          padding: 12,
          backgroundColor: fromAdmin ? "rgba(45,212,191,0.12)" : "rgba(245,158,11,0.11)",
          borderWidth: 1,
          borderColor: fromAdmin ? "rgba(45,212,191,0.28)" : "rgba(245,158,11,0.25)",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <Text style={{ color, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>
            {fromAdmin ? "Support admin" : "User"} - {formatDate(message.created_at)}
          </Text>
          <Text style={{ color: FAINT, fontSize: 11, fontWeight: "900" }}>{messageSlug(message)}</Text>
        </View>
        {message.body ? <Text style={{ marginTop: 7, color: TEXT, fontSize: 14, lineHeight: 21 }}>{message.body}</Text> : null}
        <AttachmentList attachments={message.attachments as SupportAttachment[] | undefined} onOpen={onOpenAttachment} />
      </View>
    </View>
  );
}

export default function SupportTicketThreadScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const params = useLocalSearchParams<{ ticketId?: string | string[]; admin?: string | string[]; mode?: string | string[] }>();
  const ticketId = useMemo(() => decodeURIComponent(paramString(params.ticketId)).trim(), [params.ticketId]);
  const adminMode = useMemo(() => {
    const raw = `${paramString(params.admin)} ${paramString(params.mode)}`.toLowerCase();
    return raw.includes("1") || raw.includes("admin");
  }, [params.admin, params.mode]);

  const scrollRef = useRef<ScrollView | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [ticket, setTicket] = useState<TicketLike | null>(null);
  const [messages, setMessages] = useState<MessageLike[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [picking, setPicking] = useState(false);
  const [workingStatus, setWorkingStatus] = useState<SupportTicketStatus | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<MarketSupportAiTriageResult | null>(null);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadThread = useCallback(async (silent = false) => {
    if (!ticketId) {
      setError("Support ticket is missing.");
      setLoading(false);
      return;
    }

    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getUser();
      setMeId(data?.user?.id ?? null);

      if (adminMode) {
        const result = await loadAdminSupportTicket(ticketId);
        setTicket(result.ticket as TicketLike);
        setMessages(((result.ticket?.messages ?? []) as MessageLike[]).slice());
      } else {
        const [ticketRow, messageRows] = await Promise.all([
          fetchSupportTicket(ticketId),
          fetchSupportMessages(ticketId),
        ]);
        setTicket(ticketRow as TicketLike);
        setMessages(messageRows as MessageLike[]);
      }
    } catch (e: any) {
      setError(e?.message || "Could not load support chat.");
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  }, [adminMode, ticketId]);

  useEffect(() => {
    void loadThread();
  }, [loadThread]);

  useEffect(() => {
    if (!ticketId) return undefined;
    let cleanup: undefined | (() => void);
    subscribeToSupportMessages(ticketId, () => {
      void loadThread(true);
    })
      .then((fn) => {
        cleanup = fn;
      })
      .catch(() => undefined);
    return () => {
      cleanup?.();
    };
  }, [loadThread, ticketId]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  async function pickProof() {
    setError(null);
    setPicking(true);
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
          name: asset.name ?? `support-proof-${Date.now()}`,
          mimeType: asset.mimeType ?? null,
          size: typeof asset.size === "number" ? asset.size : null,
          fileBody: asset.file ?? null,
        }));
      if (picked.length) setFiles((prev) => [...prev, ...picked].slice(0, 8));
    } catch (e: any) {
      setError(e?.message || "Could not attach proof.");
    } finally {
      setPicking(false);
    }
  }

  async function openAttachment(attachment: SupportAttachment) {
    try {
      const bucket = String(attachment.storage_bucket || "market-support");
      const path = String(attachment.storage_path || "");
      let url = String(attachment.signed_url || attachment.public_url || "");
      if (!url && path) {
        const { data, error: signError } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
        if (signError) throw signError;
        url = String(data?.signedUrl || "");
      }
      if (url) await Linking.openURL(url);
    } catch (e: any) {
      setError(e?.message || "Could not open attachment.");
    }
  }

  async function submitReply() {
    const cleanBody = reply.trim();
    if (!ticketId || (!cleanBody && !files.length)) return;
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      if (adminMode) {
        const uploadBatch = files.length ? await uploadSupportFiles(ticketId, `admin-${Date.now()}`, files) : [];
        await runAdminAction({
          action: "support_reply",
          ticket_id: ticketId,
          body: cleanBody,
          attachments: uploadBatch,
        });
      } else {
        await sendSupportMessage(ticketId, cleanBody, files);
      }
      setReply("");
      setFiles([]);
      setNotice(adminMode ? "Support admin reply sent." : "Reply sent.");
      await loadThread(true);
    } catch (e: any) {
      setError(e?.message || "Could not send reply.");
    } finally {
      setSending(false);
    }
  }

  async function updateStatus(status: SupportTicketStatus) {
    if (!adminMode || !ticketId) return;
    setWorkingStatus(status);
    setError(null);
    setNotice(null);
    try {
      await runAdminAction({ action: "support_update_status", ticket_id: ticketId, status });
      setNotice(`Ticket marked ${labelFromKey(status)}.`);
      await loadThread(true);
    } catch (e: any) {
      setError(e?.message || "Could not update ticket status.");
    } finally {
      setWorkingStatus(null);
    }
  }

  async function runTriage(force = false) {
    if (!adminMode || !ticketId) return;
    setAiLoading(true);
    setError(null);
    setNotice(null);
    try {
      const result = await generateSupportAiTriage(ticketId, { force });
      setAiResult(result);
      if (!reply.trim() && result.triage?.suggested_admin_reply) {
        setReply(result.triage.suggested_admin_reply);
      }
      setNotice("Gemini triage ready.");
    } catch (e: any) {
      setError(e?.message || "Could not run Gemini triage.");
    } finally {
      setAiLoading(false);
    }
  }

  const status = String(ticket?.status ?? "OPEN").toUpperCase() as SupportTicketStatus;
  const ticketUserSlug = String(ticket?.message_slug || "").trim();

  if (loading) {
    return (
      <LinearGradient colors={[BG1, BG0]} style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <ActivityIndicator color={TEAL} />
        <Text style={{ marginTop: 12, color: TEXT, fontWeight: "900" }}>Opening support chat</Text>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={[BG1, BG0]} start={{ x: 0.08, y: 0 }} end={{ x: 0.94, y: 1 }} style={{ flex: 1, paddingTop: Math.max(insets.top, 12) }}>
      <AppHeader title={adminMode ? "Support admin" : "Support"} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ flex: 1, paddingHorizontal: wide ? 24 : 14, paddingTop: 10, paddingBottom: insets.bottom + 12 }}>
          <View style={{ width: "100%", maxWidth: 1060, alignSelf: "center", flex: 1, gap: 12 }}>
            <View
              style={{
                borderRadius: 22,
                padding: 14,
                backgroundColor: PANEL_STRONG,
                borderWidth: 1,
                borderColor: BORDER,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                <Pressable
                  onPress={() => router.back()}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
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
                  <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <Text style={{ color: TEAL, fontSize: 12, fontWeight: "900", textTransform: "uppercase" }}>
                      {adminMode ? "Support admin chat" : "Support chat"}
                    </Text>
                    <Pill label={caseSlug(ticket)} color={TEAL} />
                    {ticketUserSlug ? <Pill label={`@${ticketUserSlug}`} color={AMBER} /> : null}
                  </View>
                  <Text numberOfLines={2} style={{ marginTop: 7, color: TEXT, fontSize: wide ? 24 : 20, fontWeight: "900" }}>
                    {ticket?.subject || "Support ticket"}
                  </Text>
                  <Text style={{ marginTop: 5, color: MUTED, fontSize: 13, lineHeight: 19 }}>
                    {adminMode ? "Replies here are sent as marketplace support, separate from normal user DMs." : "This thread is your support case. Each message keeps its own slug and proof trail."}
                  </Text>
                </View>
              </View>

              {ticket ? (
                <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                  <InfoLine label="Status" value={labelFromKey(ticket.status)} />
                  <InfoLine label="Priority" value={labelFromKey(ticket.priority)} />
                  <InfoLine label={adminMode ? "User" : "Created"} value={adminMode ? personLabel(ticket.user) : formatDate(ticket.created_at)} />
                  <InfoLine label="Last message" value={formatDate(ticket.last_message_at)} />
                </View>
              ) : null}

              <View style={{ marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {ticket ? <Pill label={labelFromKey(status)} color={statusColor(status)} /> : null}
                {ticket ? <Pill label={labelFromKey(ticket.priority)} color={priorityColor(ticket.priority)} /> : null}
                {ticket?.related_order_id ? (
                  <ActionButton
                    label="Open order"
                    icon="receipt-outline"
                    color={BLUE}
                    onPress={() => router.push(`/market/order/${ticket.related_order_id}` as any)}
                  />
                ) : null}
                <ActionButton
                  label={refreshing ? "Refreshing" : "Refresh"}
                  icon="refresh"
                  color={AMBER}
                  loading={refreshing}
                  onPress={() => void loadThread(true)}
                />
                {adminMode ? (
                  <ActionButton
                    label={aiLoading ? "Triage" : "Gemini triage"}
                    icon="sparkles-outline"
                    color={LIME}
                    loading={aiLoading}
                    disabled={!ticket}
                    onPress={() => void runTriage()}
                  />
                ) : null}
              </View>

              {adminMode ? (
                <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  <ActionButton
                    label="In progress"
                    icon="eye-outline"
                    color={BLUE}
                    disabled={!ticket || status === "IN_PROGRESS"}
                    loading={workingStatus === "IN_PROGRESS"}
                    onPress={() => void updateStatus("IN_PROGRESS")}
                  />
                  <ActionButton
                    label="Resolve"
                    icon="checkmark-circle-outline"
                    color={LIME}
                    disabled={!ticket || status === "RESOLVED"}
                    loading={workingStatus === "RESOLVED"}
                    onPress={() => void updateStatus("RESOLVED")}
                  />
                  <ActionButton
                    label="Reopen"
                    icon="refresh-outline"
                    color={AMBER}
                    disabled={!ticket || status === "OPEN"}
                    loading={workingStatus === "OPEN"}
                    onPress={() => void updateStatus("OPEN")}
                  />
                </View>
              ) : null}
            </View>

            {error ? (
              <View style={{ borderRadius: 15, padding: 13, backgroundColor: "rgba(251,113,133,0.13)", borderWidth: 1, borderColor: "rgba(251,113,133,0.35)" }}>
                <Text style={{ color: "#FDA4AF", fontWeight: "900" }}>{error}</Text>
              </View>
            ) : null}
            {notice ? (
              <View style={{ borderRadius: 15, padding: 13, backgroundColor: "rgba(45,212,191,0.12)", borderWidth: 1, borderColor: "rgba(45,212,191,0.32)" }}>
                <Text style={{ color: TEAL, fontWeight: "900" }}>{notice}</Text>
              </View>
            ) : null}

            {aiResult?.triage ? (
              <View style={{ borderRadius: 18, padding: 13, backgroundColor: "rgba(138,230,110,0.10)", borderWidth: 1, borderColor: "rgba(138,230,110,0.25)", gap: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Ionicons name="sparkles-outline" size={16} color={LIME} />
                  <Text style={{ color: TEXT, fontWeight: "900" }}>Gemini triage</Text>
                  <Pill label={labelFromKey(aiResult.triage.priority)} color={priorityColor(aiResult.triage.priority)} />
                  <Pill label={labelFromKey(aiResult.triage.confidence)} color={TEAL} />
                </View>
                <Text style={{ color: MUTED, fontSize: 13, lineHeight: 20 }}>{aiResult.triage.summary}</Text>
                {aiResult.triage.recommended_next_action ? (
                  <Text style={{ color: LIME, fontSize: 12, lineHeight: 18 }}>{aiResult.triage.recommended_next_action}</Text>
                ) : null}
              </View>
            ) : null}

            <View style={{ flex: 1, minHeight: 0, borderRadius: 22, backgroundColor: PANEL_STRONG, borderWidth: 1, borderColor: BORDER, overflow: "hidden" }}>
              <ScrollView
                ref={scrollRef}
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: wide ? 18 : 12, gap: 10, paddingBottom: 18 }}
                onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
              >
                {messages.length ? (
                  messages.map((message) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      adminMode={adminMode}
                      meId={meId}
                      onOpenAttachment={openAttachment}
                    />
                  ))
                ) : (
                  <View style={{ paddingVertical: 42, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="chatbubbles-outline" size={32} color={FAINT} />
                    <Text style={{ marginTop: 10, color: TEXT, fontSize: 17, fontWeight: "900" }}>No messages yet</Text>
                    <Text style={{ marginTop: 5, color: MUTED, fontSize: 13 }}>Start the support thread from the composer below.</Text>
                  </View>
                )}
              </ScrollView>

              <View style={{ padding: wide ? 16 : 12, borderTopWidth: 1, borderTopColor: BORDER, gap: 10, backgroundColor: "rgba(6,16,13,0.96)" }}>
                <FieldLabel>{adminMode ? "Reply as support admin" : "Reply to support"}</FieldLabel>
                <TextInput
                  value={reply}
                  onChangeText={setReply}
                  multiline
                  placeholder={adminMode ? "Write the official support reply" : "Write your reply"}
                  placeholderTextColor="rgba(255,253,247,0.35)"
                  style={{
                    minHeight: 72,
                    maxHeight: 150,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: BORDER,
                    backgroundColor: "rgba(255,255,255,0.055)",
                    color: TEXT,
                    paddingHorizontal: 12,
                    paddingVertical: 11,
                    fontSize: 14,
                    textAlignVertical: "top",
                  }}
                />
                <PendingFiles files={files} onRemove={(id) => setFiles((prev) => prev.filter((file) => file.id !== id))} />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "flex-end" }}>
                  <ActionButton
                    label={picking ? "Attaching" : "Attach proof"}
                    icon="document-attach-outline"
                    color={BLUE}
                    loading={picking}
                    disabled={!ticket}
                    onPress={() => void pickProof()}
                  />
                  <ActionButton
                    label={sending ? "Sending" : "Send"}
                    icon="send-outline"
                    color={TEAL}
                    loading={sending}
                    disabled={!ticket || (!reply.trim() && !files.length)}
                    onPress={() => void submitReply()}
                  />
                </View>
              </View>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}
