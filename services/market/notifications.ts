import { Platform } from "react-native";

import { supabase } from "@/services/supabase";

export type AccountNotification = {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  route: string | null;
  entity_type: string | null;
  entity_id: string | null;
  actor_id: string | null;
  metadata: Record<string, any> | null;
  read_at: string | null;
  created_at: string;
  updated_at: string;
};

type SessionNotificationKind = "signed_in" | "signed_out" | "expired";

const SESSION_NOTIFICATION_DEDUP_MS = 5 * 60 * 1000;

const SELECT_COLUMNS =
  "id,user_id,kind,title,body,route,entity_type,entity_id,actor_id,metadata,read_at,created_at,updated_at";

export async function fetchAccountNotifications(limit = 100) {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("account_notifications")
    .select(SELECT_COLUMNS)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as AccountNotification[];
}

export async function fetchAccountNotificationById(id: string) {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("account_notifications")
    .select(SELECT_COLUMNS)
    .eq("user_id", user.id)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as AccountNotification | null) ?? null;
}

export async function getUnreadAccountNotificationCount() {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return 0;

  const { count, error } = await supabase
    .from("account_notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("read_at", null);

  if (error) throw new Error(error.message);
  return Number(count ?? 0);
}

export async function markAccountNotificationRead(id: string) {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("account_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("id", id)
    .is("read_at", null);

  if (error) throw new Error(error.message);
}

export async function markAllAccountNotificationsRead() {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("account_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);

  if (error) throw new Error(error.message);
}

export async function subscribeToAccountNotifications(onChange: () => void) {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return () => undefined;

  const channel = supabase
    .channel(`account-notifications-${user.id}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "account_notifications",
        filter: `user_id=eq.${user.id}`,
      },
      () => onChange(),
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

function getSessionEventPayload(kind: SessionNotificationKind) {
  const label = Platform.OS === "web" ? "browser" : Platform.OS;
  const userAgent =
    Platform.OS === "web" && typeof navigator !== "undefined"
      ? String(navigator.userAgent || "").slice(0, 180)
      : null;

  return {
    kind:
      kind === "signed_in"
        ? "session_signed_in"
        : kind === "expired"
          ? "session_expired"
          : "session_signed_out",
    title:
      kind === "signed_in"
        ? "New sign-in detected"
        : kind === "expired"
          ? "Session expired"
          : "Signed out",
    body:
      kind === "signed_in"
        ? `A new session was opened on ${label}.`
        : kind === "expired"
          ? `A session on ${label} expired and needs sign-in again.`
          : `Your session was signed out on ${label}.`,
    route: "/market/notification",
    entity_type: "auth_session",
    entity_id: null,
    metadata: {
      platform: Platform.OS,
      surface: label,
      reason: kind,
      user_agent: userAgent,
    },
  };
}

async function wasRecentSessionNotification(userId: string, kind: string) {
  const { data, error } = await supabase
    .from("account_notifications")
    .select("created_at")
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("entity_type", "auth_session")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.created_at) return false;

  const createdAt = new Date(data.created_at).getTime();
  if (!Number.isFinite(createdAt)) return false;
  return Date.now() - createdAt < SESSION_NOTIFICATION_DEDUP_MS;
}

export async function recordAuthSessionNotification(kind: SessionNotificationKind) {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return;

  const payload = getSessionEventPayload(kind);
  if (await wasRecentSessionNotification(user.id, payload.kind)) {
    return;
  }

  const { error } = await supabase.from("account_notifications").insert({
    user_id: user.id,
    kind: payload.kind,
    title: payload.title,
    body: payload.body,
    route: payload.route,
    entity_type: payload.entity_type,
    entity_id: payload.entity_id,
    metadata: payload.metadata,
  });

  if (error) {
    console.warn("[account-notifications] session event insert failed", error.message);
  }
}
