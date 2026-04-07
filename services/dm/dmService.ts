import { supabase } from "@/services/supabase";
import { uploadToSupabaseStorage } from "@/services/market/storageUpload";

export type UserIdentity = {
  id: string;
  username: string | null;
  full_name: string | null;
  seller_profile?: {
    user_id: string;
    market_username: string | null;
    business_name: string | null;
    logo_path: string | null;
    active: boolean;
  } | null;
};

export type InboxThread = {
  id: string;
  a_user_id: string;
  b_user_id: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  created_at: string;
  other: UserIdentity;
  unread: boolean;
};

export type DMMessage = {
  id: string;
  thread_id: string;
  sender_id: string;
  body: string | null;
  created_at: string;
  meta: any;
  has_attachments: boolean | null;
  reply_to_message_id?: string | null;
  reply_to?: {
    id: string;
    sender_id: string;
    body: string | null;
    created_at: string;
  } | null;
  dm_message_attachments?: DMAttachment[];
  reactions?: DMReaction[];
};

export type DMReaction = {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

export type DMAttachment = {
  id: string;
  message_id: string;
  kind: "image" | "video" | "audio" | "file";
  storage_bucket: string;
  storage_path: string;
  public_url: string | null;
  mime_type: string | null;
  duration_sec: number | null;
  meta: any;
  created_at: string;
};

export async function getUserByUsername(username: string): Promise<UserIdentity | null> {
  const handle = String(username || "").trim().toLowerCase();
  if (!handle) return null;
  const isUuidHandle = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    handle,
  );

  if (isUuidHandle) {
    const { data: prof, error: pErr } = await supabase
      .from("profiles")
      .select("id,username,full_name")
      .eq("id", handle)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!prof?.id) return null;

    const { data: seller, error: sErr } = await supabase
      .from("market_seller_profiles")
      .select("user_id,market_username,business_name,logo_path,active")
      .eq("user_id", prof.id)
      .eq("active", true)
      .maybeSingle();
    if (sErr) throw new Error(sErr.message);

    return {
      id: prof.id,
      username: prof.username ?? null,
      full_name: prof.full_name ?? null,
      seller_profile: (seller as any) ?? null,
    };
  }

  // Prefer seller profiles if active
  const { data: seller, error: sErr } = await supabase
    .from("market_seller_profiles")
    .select("user_id,market_username,business_name,logo_path,active")
    .eq("market_username", handle)
    .eq("active", true)
    .maybeSingle();

  if (sErr) throw new Error(sErr.message);

  if (seller?.user_id) {
    const { data: prof, error: pErr } = await supabase
      .from("profiles")
      .select("id,username,full_name")
      .eq("id", seller.user_id)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);

    return {
      id: seller.user_id,
      username: prof?.username ?? null,
      full_name: prof?.full_name ?? null,
      seller_profile: seller as any,
    };
  }

  const { data: prof, error: pErr } = await supabase
    .from("profiles")
    .select("id,username,full_name")
    .eq("username", handle)
    .maybeSingle();

  if (pErr) throw new Error(pErr.message);
  if (!prof?.id) return null;

  return {
    id: prof.id,
    username: prof.username ?? null,
    full_name: prof.full_name ?? null,
    seller_profile: null,
  };
}

export async function getOrCreateThread(otherUserId: string) {
  const { data, error } = await supabase.rpc("dm_get_or_create_thread", {
    p_other_user_id: otherUserId,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function listInboxThreads(): Promise<InboxThread[]> {
  const { data: auth } = await supabase.auth.getUser();
  const me = auth?.user;
  if (!me) throw new Error("Not authenticated");

  const { data: threads, error } = await supabase
    .from("dm_threads")
    .select("id,a_user_id,b_user_id,last_message_at,last_message_preview,created_at")
    .or(`a_user_id.eq.${me.id},b_user_id.eq.${me.id}`)
    .order("last_message_at", { ascending: false });

  if (error) throw new Error(error.message);
  const rows = (threads ?? []) as any[];
  const otherIds = Array.from(
    new Set(
      rows
        .map((t) => (t.a_user_id === me.id ? t.b_user_id : t.a_user_id))
        .filter(Boolean),
    ),
  );

  const readsMap: Record<string, string | null> = {};
  if (rows.length) {
    const { data: reads } = await supabase
      .from("dm_thread_reads")
      .select("thread_id,last_read_at")
      .eq("user_id", me.id)
      .in(
        "thread_id",
        rows.map((r) => r.id),
      );
    (reads ?? []).forEach((r: any) => {
      readsMap[r.thread_id] = r.last_read_at ?? null;
    });
  }

  const profiles =
    otherIds.length > 0
      ? (
          await supabase
            .from("profiles")
            .select("id,username,full_name")
            .in("id", otherIds)
        ).data
      : [];

  const sellers =
    otherIds.length > 0
      ? (
          await supabase
            .from("market_seller_profiles")
            .select("user_id,market_username,business_name,logo_path,active")
            .in("user_id", otherIds)
            .eq("active", true)
        ).data
      : [];

  const profileMap = new Map<string, any>();
  (profiles ?? []).forEach((p: any) => profileMap.set(p.id, p));

  const sellerMap = new Map<string, any>();
  (sellers ?? []).forEach((s: any) => sellerMap.set(s.user_id, s));

  return rows.map((t) => {
    const otherId = t.a_user_id === me.id ? t.b_user_id : t.a_user_id;
    const prof = profileMap.get(otherId);
    const seller = sellerMap.get(otherId) ?? null;
    const lastRead = readsMap[t.id] ?? null;
    const unread =
      !!t.last_message_at &&
      (!lastRead || new Date(t.last_message_at).getTime() > new Date(lastRead).getTime());

    return {
      id: t.id,
      a_user_id: t.a_user_id,
      b_user_id: t.b_user_id,
      last_message_at: t.last_message_at ?? null,
      last_message_preview: t.last_message_preview ?? null,
      created_at: t.created_at,
      other: {
        id: otherId,
        username: prof?.username ?? null,
        full_name: prof?.full_name ?? null,
        seller_profile: seller,
      },
      unread,
    };
  });
}

export async function fetchMessages(threadId: string, limit = 50) {
  const { data, error } = await supabase
    .from("dm_messages")
    .select("id,thread_id,sender_id,body,created_at,meta,has_attachments,reply_to_message_id")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);
  const rows: DMMessage[] = ((data ?? []) as DMMessage[]).map(
    (m): DMMessage => ({
      ...m,
      dm_message_attachments: [] as DMAttachment[],
      reply_to: null,
    }),
  );
  const messageIds = rows.map((m) => m.id);
  const replyIds = Array.from(
    new Set(rows.map((m) => m.reply_to_message_id).filter(Boolean) as string[]),
  );

  if (messageIds.length) {
    const { data: atts, error: attErr } = await supabase
      .from("dm_message_attachments")
      .select("id,message_id,kind,storage_bucket,storage_path,public_url,mime_type,duration_sec,meta,created_at")
      .in("message_id", messageIds);
    if (attErr) throw new Error(attErr.message);
    const attMap = new Map<string, DMAttachment[]>();
    (atts ?? []).forEach((a: any) => {
      const list = attMap.get(a.message_id) ?? [];
      list.push(a as DMAttachment);
      attMap.set(a.message_id, list);
    });
    rows.forEach((m: DMMessage) => {
      m.dm_message_attachments = attMap.get(m.id) ?? [];
    });
  }

  if (replyIds.length) {
    const { data: replies, error: repErr } = await supabase
      .from("dm_messages")
      .select("id,sender_id,body,created_at")
      .in("id", replyIds);
    if (repErr) throw new Error(repErr.message);
    const repMap = new Map<string, any>();
    (replies ?? []).forEach((r: any) => repMap.set(r.id, r));
    rows.forEach((m: DMMessage) => {
      const rid = m.reply_to_message_id ?? "";
      m.reply_to = rid ? (repMap.get(rid) ?? null) : null;
    });
  }

  const reactionsMap = new Map<string, DMReaction[]>();
  if (messageIds.length) {
    const { data: reactions } = await supabase
      .from("dm_message_reactions")
      .select("id,message_id,user_id,emoji,created_at")
      .in("message_id", messageIds);
    (reactions ?? []).forEach((r: any) => {
      const list = reactionsMap.get(r.message_id) ?? [];
      list.push(r as any);
      reactionsMap.set(r.message_id, list);
    });
  }
  const hydrated = await Promise.all(
    rows.map(async (m: DMMessage): Promise<DMMessage> => {
      if (!m.dm_message_attachments?.length) return m;
      const att = await Promise.all(
        m.dm_message_attachments.map(async (a: DMAttachment): Promise<DMAttachment> => {
          if (a.public_url) return a;
          try {
            const { data: signed } = await supabase.storage
              .from(a.storage_bucket || "dm-media")
              .createSignedUrl(a.storage_path, 3600);
            return { ...a, public_url: signed?.signedUrl ?? null };
          } catch {
            return a;
          }
        }),
      );
      return { ...m, dm_message_attachments: att as DMAttachment[] };
    }),
  );
  return hydrated.map((m) => ({ ...m, reactions: reactionsMap.get(m.id) ?? [] }));
}

export async function sendText(threadId: string, text: string, replyToId?: string | null) {
  const { data: auth } = await supabase.auth.getUser();
  const me = auth?.user;
  if (!me) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("dm_messages")
    .insert({
      thread_id: threadId,
      sender_id: me.id,
      body: text.trim(),
      has_attachments: false,
      reply_to_message_id: replyToId ?? null,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return data?.id as string;
}

async function inferMimeFromUri(uri: string) {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".m4a")) return "audio/m4a";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  return "application/octet-stream";
}

function inferExtensionFromMime(mime: string, kind: "image" | "video" | "audio" | "file") {
  const raw = String(mime || "").trim().toLowerCase();
  if (!raw) {
    if (kind === "audio") return "m4a";
    if (kind === "video") return "mp4";
    if (kind === "image") return "jpg";
    return "bin";
  }
  if (raw.includes("png")) return "png";
  if (raw.includes("webp")) return "webp";
  if (raw.includes("heic") || raw.includes("heif")) return "heic";
  if (raw.includes("jpeg") || raw.includes("jpg")) return "jpg";
  if (raw.includes("quicktime")) return "mov";
  if (raw.includes("webm")) return "webm";
  if (raw.includes("mpeg")) return kind === "audio" ? "mp3" : "mpeg";
  if (raw.includes("aac")) return "aac";
  if (raw.includes("wav")) return "wav";
  if (raw.includes("m4a")) return "m4a";
  if (raw.includes("mp4")) return "mp4";
  return kind === "audio" ? "m4a" : kind === "video" ? "mp4" : kind === "image" ? "jpg" : "bin";
}

function inferExtensionFromUri(uri: string, mime: string, kind: "image" | "video" | "audio" | "file") {
  const clean = String(uri || "").split("#")[0]?.split("?")[0] ?? "";
  const match = clean.match(/\.([a-z0-9]{2,5})$/i);
  if (match?.[1]) return match[1].toLowerCase();
  return inferExtensionFromMime(mime, kind);
}

export async function sendMedia(params: {
  threadId: string;
  kind: "image" | "video" | "audio" | "file";
  uri: string;
  mime_type?: string | null;
  duration_sec?: number | null;
  body?: string | null;
  reply_to_message_id?: string | null;
}) {
  const { data: auth } = await supabase.auth.getUser();
  const me = auth?.user;
  if (!me) throw new Error("Not authenticated");

  const { threadId, kind, uri, duration_sec, body, reply_to_message_id } = params;
  const mime_type = params.mime_type || (await inferMimeFromUri(uri));

  const { data: msg, error: mErr } = await supabase
    .from("dm_messages")
    .insert({
      thread_id: threadId,
      sender_id: me.id,
      body: body?.trim() || null,
      has_attachments: true,
      meta: { kind },
      reply_to_message_id: reply_to_message_id ?? null,
    })
    .select("id")
    .single();

  if (mErr) throw new Error(mErr.message);
  const messageId = msg?.id as string;

  try {
    const ext = inferExtensionFromUri(uri, mime_type || "", kind);
    const path = `${threadId}/${messageId}/${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`;

    const up = await uploadToSupabaseStorage({
      bucket: "dm-media",
      path,
      localUri: uri,
      contentType: mime_type || "application/octet-stream",
      upsert: false,
    });

    const { error: aErr } = await supabase
      .from("dm_message_attachments")
      .insert({
        message_id: messageId,
        kind,
        storage_bucket: "dm-media",
        storage_path: up.storagePath,
        public_url: up.publicUrl ?? null,
        mime_type: mime_type ?? null,
        duration_sec: duration_sec ?? null,
        meta: {},
      });

    if (aErr) throw new Error(aErr.message);
    return messageId;
  } catch (e) {
    await supabase.from("dm_messages").delete().eq("id", messageId);
    throw e;
  }
}

export async function markRead(threadId: string) {
  const { data: auth } = await supabase.auth.getUser();
  const me = auth?.user;
  if (!me) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("dm_thread_reads")
    .upsert(
      { thread_id: threadId, user_id: me.id, last_read_at: new Date().toISOString() },
      { onConflict: "thread_id,user_id" },
    );

  if (error) throw new Error(error.message);
}

export async function reactToMessage(messageId: string, emoji: string) {
  const { data: auth } = await supabase.auth.getUser();
  const me = auth?.user;
  if (!me) throw new Error("Not authenticated");
  if (!messageId) throw new Error("Missing message id");

  const { error } = await supabase
    .from("dm_message_reactions")
    .upsert(
      { message_id: messageId, user_id: me.id, emoji },
      { onConflict: "message_id,user_id" },
    );

  if (error) throw new Error(error.message);
}

export async function removeReaction(messageId: string) {
  const { data: auth } = await supabase.auth.getUser();
  const me = auth?.user;
  if (!me) throw new Error("Not authenticated");
  if (!messageId) throw new Error("Missing message id");

  const { error } = await supabase
    .from("dm_message_reactions")
    .delete()
    .eq("message_id", messageId)
    .eq("user_id", me.id);

  if (error) throw new Error(error.message);
}
