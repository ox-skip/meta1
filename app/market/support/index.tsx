import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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
  type SupportMessage,
  type SupportTicket,
  type SupportTicketPriority,
  type SupportTicketStatus,
} from "@/services/market/support";

const BG0 = "#07100D";
const BG1 = "#16120B";
const PANEL = "rgba(255,253,247,0.07)";
const PANEL_STRONG = "rgba(13,18,15,0.92)";
const BORDER = "rgba(255,253,247,0.12)";
const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.67)";
const FAINT = "rgba(255,253,247,0.43)";
const TEAL = "#2DD4BF";
const AMBER = "#F4B75D";
const BLUE = "#38BDF8";
const ROSE = "#FB7185";
const LIME = "#A3E635";

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
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusColor(status: SupportTicketStatus) {
  if (status === "RESOLVED") return LIME;
  if (status === "CLOSED") return FAINT;
  if (status === "IN_PROGRESS") return BLUE;
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
        minHeight: 48,
        borderRadius: 8,
        paddingHorizontal: 16,
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
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: 260,
        borderRadius: 8,
        padding: 14,
        backgroundColor: selected ? "rgba(45,212,191,0.12)" : PANEL,
        borderWidth: 1,
        borderColor: selected ? "rgba(45,212,191,0.45)" : BORDER,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Pill label={labelFromKey(ticket.status)} color={tone} />
        <Pill label={labelFromKey(ticket.priority)} color={priorityColor(ticket.priority)} />
      </View>
      <Text numberOfLines={2} style={{ marginTop: 12, color: TEXT, fontSize: 15, fontWeight: "900", lineHeight: 20 }}>
        {ticket.subject}
      </Text>
      <Text style={{ marginTop: 7, color: MUTED, fontSize: 12 }}>
        {labelFromKey(ticket.category)} - {formatDate(ticket.last_message_at)}
      </Text>
    </Pressable>
  );
}

function MessageRow({ message }: { message: SupportMessage }) {
  const fromAdmin = message.sender_kind === "ADMIN";
  const color = fromAdmin ? TEAL : AMBER;
  return (
    <View style={{ alignSelf: fromAdmin ? "flex-start" : "flex-end", maxWidth: "86%", marginTop: 10 }}>
      <View
        style={{
          borderRadius: 8,
          padding: 12,
          backgroundColor: fromAdmin ? "rgba(45,212,191,0.12)" : "rgba(244,183,93,0.13)",
          borderWidth: 1,
          borderColor: `${color}38`,
        }}
      >
        <Text style={{ color, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>
          {fromAdmin ? "Support" : "You"}
        </Text>
        <Text style={{ marginTop: 6, color: TEXT, fontSize: 14, lineHeight: 20 }}>{message.body}</Text>
      </View>
      <Text style={{ marginTop: 4, color: FAINT, fontSize: 10, textAlign: fromAdmin ? "left" : "right" }}>
        {formatDate(message.created_at)}
      </Text>
    </View>
  );
}

export default function MarketSupportScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ ticket?: string }>();
  const { width } = useWindowDimensions();
  const wide = width >= 920;
  const scrollRef = useRef<ScrollView>(null);

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [messageLoading, setMessageLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("order");
  const [priority, setPriority] = useState<SupportTicketPriority>("NORMAL");
  const [relatedOrderId, setRelatedOrderId] = useState("");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedId) ?? null,
    [selectedId, tickets],
  );

  const loadTickets = useCallback(async (preferredId?: string | null) => {
    const rows = await fetchMySupportTickets();
    setTickets(rows);
    setSelectedId((current) => {
      const preferred = String(preferredId ?? "").trim();
      if (preferred && rows.some((ticket) => ticket.id === preferred)) return preferred;
      if (current && rows.some((ticket) => ticket.id === current)) return current;
      return rows[0]?.id ?? null;
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
      });
      setSubject("");
      setBody("");
      setRelatedOrderId("");
      setPriority("NORMAL");
      setCategory("order");
      setSelectedId(ticket.id);
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
      await sendSupportMessage(selectedId, reply);
      setReply("");
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
            paddingBottom: insets.bottom + 130,
          }}
        >
          <View style={{ width: "100%", maxWidth: 1180, alignSelf: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Pressable
                onPress={() => router.back()}
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 8,
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
                <Text style={{ marginTop: 5, color: TEXT, fontSize: wide ? 30 : 25, fontWeight: "900" }}>Report an issue</Text>
                <Text style={{ marginTop: 5, color: MUTED, fontSize: 13, lineHeight: 20 }}>
                  Order, payment, listing, account, and safety cases go straight to support admins.
                </Text>
              </View>
            </View>

            {error ? (
              <View style={{ marginTop: 16, borderRadius: 8, padding: 13, backgroundColor: "rgba(251,113,133,0.13)", borderWidth: 1, borderColor: "rgba(251,113,133,0.35)" }}>
                <Text style={{ color: "#FDA4AF", fontWeight: "900" }}>{error}</Text>
              </View>
            ) : null}
            {notice ? (
              <View style={{ marginTop: 16, borderRadius: 8, padding: 13, backgroundColor: "rgba(45,212,191,0.12)", borderWidth: 1, borderColor: "rgba(45,212,191,0.32)" }}>
                <Text style={{ color: TEAL, fontWeight: "900" }}>{notice}</Text>
              </View>
            ) : null}

            <View style={{ marginTop: 18, flexDirection: wide ? "row" : "column", gap: 14, alignItems: "flex-start" }}>
              <View style={{ width: wide ? 390 : "100%", borderRadius: 8, padding: 16, backgroundColor: PANEL_STRONG, borderWidth: 1, borderColor: BORDER }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <View>
                    <Text style={{ color: TEXT, fontSize: 18, fontWeight: "900" }}>New ticket</Text>
                    <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>Send the case details once.</Text>
                  </View>
                  <View style={{ width: 42, height: 42, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(45,212,191,0.12)", borderWidth: 1, borderColor: "rgba(45,212,191,0.3)" }}>
                    <Ionicons name="help-buoy-outline" size={20} color={TEAL} />
                  </View>
                </View>

                <View style={{ marginTop: 16, gap: 12 }}>
                  <View style={{ gap: 7 }}>
                    <FieldLabel>Subject</FieldLabel>
                    <TextInput
                      value={subject}
                      onChangeText={setSubject}
                      placeholder="Short summary"
                      placeholderTextColor="rgba(255,253,247,0.35)"
                      style={{ minHeight: 46, borderRadius: 8, borderWidth: 1, borderColor: BORDER, backgroundColor: "rgba(255,255,255,0.055)", color: TEXT, paddingHorizontal: 12, fontSize: 14 }}
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
                      style={{ minHeight: 46, borderRadius: 8, borderWidth: 1, borderColor: BORDER, backgroundColor: "rgba(255,255,255,0.055)", color: TEXT, paddingHorizontal: 12, fontSize: 14 }}
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
                      style={{ minHeight: 118, borderRadius: 8, borderWidth: 1, borderColor: BORDER, backgroundColor: "rgba(255,255,255,0.055)", color: TEXT, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, textAlignVertical: "top" }}
                    />
                  </View>

                  <PrimaryButton
                    label={creating ? "Sending" : "Send ticket"}
                    icon="paper-plane-outline"
                    color={TEAL}
                    loading={creating}
                    disabled={!subject.trim() || !body.trim()}
                    onPress={submitTicket}
                  />
                </View>
              </View>

              <View style={{ flex: 1, width: wide ? undefined : "100%", minWidth: 0 }}>
                <View style={{ borderRadius: 8, padding: 16, backgroundColor: PANEL_STRONG, borderWidth: 1, borderColor: BORDER }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <View>
                      <Text style={{ color: TEXT, fontSize: 18, fontWeight: "900" }}>Tickets</Text>
                      <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>{tickets.length} active record{tickets.length === 1 ? "" : "s"}</Text>
                    </View>
                    <PrimaryButton label="Refresh" icon="refresh" color={AMBER} onPress={() => void loadTickets(selectedId)} />
                  </View>

                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ marginTop: 14, gap: 10, paddingRight: 4 }}>
                    {tickets.length ? tickets.map((ticket) => (
                      <TicketCard key={ticket.id} ticket={ticket} selected={ticket.id === selectedId} onPress={() => setSelectedId(ticket.id)} />
                    )) : (
                      <View style={{ width: wide ? 480 : 300, borderRadius: 8, padding: 16, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER }}>
                        <Text style={{ color: TEXT, fontWeight: "900" }}>No support tickets yet.</Text>
                        <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 19 }}>Open a ticket when you need help with a marketplace issue.</Text>
                      </View>
                    )}
                  </ScrollView>
                </View>

                <View style={{ marginTop: 14, borderRadius: 8, padding: 16, backgroundColor: PANEL_STRONG, borderWidth: 1, borderColor: BORDER, minHeight: 380 }}>
                  {selectedTicket ? (
                    <>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                        <View style={{ flex: 1, minWidth: 220 }}>
                          <Text style={{ color: TEXT, fontSize: 20, fontWeight: "900" }}>{selectedTicket.subject}</Text>
                          <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>
                            {labelFromKey(selectedTicket.category)} - Created {formatDate(selectedTicket.created_at)}
                          </Text>
                        </View>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                          <Pill label={labelFromKey(selectedTicket.status)} color={statusColor(selectedTicket.status)} />
                          <Pill label={labelFromKey(selectedTicket.priority)} color={priorityColor(selectedTicket.priority)} />
                        </View>
                      </View>

                      {selectedTicket.related_order_id ? (
                        <Pressable
                          onPress={() => router.push(`/market/order/${selectedTicket.related_order_id}` as any)}
                          style={{ marginTop: 12, alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "rgba(56,189,248,0.12)", borderWidth: 1, borderColor: "rgba(56,189,248,0.3)", flexDirection: "row", alignItems: "center", gap: 8 }}
                        >
                          <Ionicons name="receipt-outline" size={15} color={BLUE} />
                          <Text style={{ color: BLUE, fontWeight: "900", fontSize: 12 }}>Open order</Text>
                        </Pressable>
                      ) : null}

                      <ScrollView
                        ref={scrollRef}
                        style={{ marginTop: 14, maxHeight: wide ? 420 : 360 }}
                        contentContainerStyle={{ paddingBottom: 6 }}
                        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
                      >
                        {messageLoading ? (
                          <View style={{ paddingVertical: 32, alignItems: "center" }}>
                            <ActivityIndicator color={TEAL} />
                          </View>
                        ) : messages.length ? (
                          messages.map((message) => <MessageRow key={message.id} message={message} />)
                        ) : (
                          <View style={{ borderRadius: 8, padding: 14, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER }}>
                            <Text style={{ color: TEXT, fontWeight: "900" }}>No messages yet.</Text>
                          </View>
                        )}
                      </ScrollView>

                      <View style={{ marginTop: 14, gap: 8 }}>
                        <FieldLabel>Reply</FieldLabel>
                        <View style={{ flexDirection: wide ? "row" : "column", alignItems: wide ? "flex-end" : "stretch", gap: 10 }}>
                          <TextInput
                            value={reply}
                            onChangeText={setReply}
                            multiline
                            placeholder="Write a reply"
                            placeholderTextColor="rgba(255,253,247,0.35)"
                            style={{ flex: 1, minHeight: 58, borderRadius: 8, borderWidth: 1, borderColor: BORDER, backgroundColor: "rgba(255,255,255,0.055)", color: TEXT, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, textAlignVertical: "top" }}
                          />
                          <PrimaryButton
                            label={sending ? "Sending" : "Send"}
                            icon="send"
                            color={TEAL}
                            loading={sending}
                            disabled={!reply.trim()}
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
