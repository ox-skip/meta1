import { supabase } from "@/services/supabase";
import { uploadToSupabaseStorage } from "@/services/market/storageUpload";

export type SupportTicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
export type SupportTicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type SupportAttachmentKind = "image" | "video" | "audio" | "file";

export type SupportTicket = {
  id: string;
  user_id: string;
  subject: string;
  category: string;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  related_order_id: string | null;
  assigned_admin_id: string | null;
  message_slug: string | null;
  last_message_at: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SupportAttachment = {
  id: string;
  message_id: string;
  ticket_id: string;
  uploaded_by: string;
  kind: SupportAttachmentKind;
  storage_bucket: string;
  storage_path: string;
  public_url: string | null;
  signed_url?: string | null;
  mime_type: string | null;
  file_name: string | null;
  file_size: number | null;
  created_at: string;
};

export type SupportAttachmentDraft = {
  kind: SupportAttachmentKind;
  storage_bucket: string;
  storage_path: string;
  public_url: string | null;
  mime_type: string | null;
  file_name: string | null;
  file_size: number | null;
};

export type SupportLocalFile = {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
  fileBody?: Blob | null;
};

export type SupportMessage = {
  id: string;
  ticket_id: string;
  sender_id: string;
  sender_kind: "USER" | "ADMIN";
  message_slug: string | null;
  body: string;
  created_at: string;
  attachments?: SupportAttachment[];
};

const SUPPORT_BUCKET = "market-support";
const TICKET_COLUMNS =
  "id,user_id,subject,category,priority,status,related_order_id,assigned_admin_id,message_slug,last_message_at,resolved_at,created_at,updated_at";

const MESSAGE_COLUMNS = "id,ticket_id,sender_id,sender_kind,message_slug,body,created_at";
const ATTACHMENT_COLUMNS =
  "id,message_id,ticket_id,uploaded_by,kind,storage_bucket,storage_path,public_url,mime_type,file_name,file_size,created_at";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanText(value: unknown, max = 3000) {
  return String(value ?? "").trim().slice(0, max);
}

function safeFileName(value?: string | null) {
  const raw = String(value || `proof-${Date.now()}`).trim();
  return raw.replace(/[^\w.\-]+/g, "_").slice(0, 120) || `proof-${Date.now()}`;
}

function mimeFromName(name?: string | null) {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "application/octet-stream";
}

function supportKind(mime?: string | null, name?: string | null): SupportAttachmentKind {
  const raw = String(mime || mimeFromName(name)).toLowerCase();
  if (raw.startsWith("image/")) return "image";
  if (raw.startsWith("video/")) return "video";
  if (raw.startsWith("audio/")) return "audio";
  return "file";
}

async function getCurrentUserId() {
  const { data } = await supabase.auth.getUser();
  const userId = data?.user?.id ?? null;
  if (!userId) throw new Error("Sign in to contact support.");
  return userId;
}

async function signedAttachmentUrl(attachment: SupportAttachment) {
  if (attachment.public_url) return attachment.public_url;
  if (!attachment.storage_path) return null;
  const { data } = await supabase.storage
    .from(attachment.storage_bucket || SUPPORT_BUCKET)
    .createSignedUrl(attachment.storage_path, 3600);
  return data?.signedUrl ?? null;
}

async function hydrateAttachments(rows: SupportAttachment[]) {
  return await Promise.all(
    rows.map(async (row) => {
      try {
        return { ...row, signed_url: await signedAttachmentUrl(row) };
      } catch {
        return { ...row, signed_url: row.public_url ?? null };
      }
    }),
  );
}

async function fetchAttachmentsForMessages(messageIds: string[]) {
  if (!messageIds.length) return new Map<string, SupportAttachment[]>();
  const { data, error } = await supabase
    .from("market_support_message_attachments")
    .select(ATTACHMENT_COLUMNS)
    .in("message_id", messageIds)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const hydrated = await hydrateAttachments((data ?? []) as SupportAttachment[]);
  const map = new Map<string, SupportAttachment[]>();
  hydrated.forEach((attachment) => {
    const list = map.get(attachment.message_id) ?? [];
    list.push(attachment);
    map.set(attachment.message_id, list);
  });
  return map;
}

export async function uploadSupportFiles(ticketId: string, messageId: string, files: SupportLocalFile[] = []) {
  const userId = await getCurrentUserId();
  const safeTicket = cleanText(ticketId, 80);
  const safeMessage = cleanText(messageId, 80);
  if (!safeTicket || !safeMessage || !files.length) return [];

  const drafts: SupportAttachmentDraft[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file?.uri) continue;
    const name = safeFileName(file.name || file.uri.split("/").pop());
    const mime = file.mimeType || mimeFromName(name);
    const path = `${userId}/${safeTicket}/${safeMessage}/${Date.now()}-${index}-${name}`;
    const uploaded = await uploadToSupabaseStorage({
      bucket: SUPPORT_BUCKET,
      path,
      localUri: file.uri,
      fileBody: file.fileBody ?? null,
      contentType: mime,
      upsert: false,
    });

    drafts.push({
      kind: supportKind(mime, name),
      storage_bucket: SUPPORT_BUCKET,
      storage_path: uploaded.storagePath,
      public_url: null,
      mime_type: mime,
      file_name: name,
      file_size: typeof file.size === "number" ? file.size : null,
    });
  }

  return drafts;
}

async function insertSupportAttachments(ticketId: string, messageId: string, drafts: SupportAttachmentDraft[]) {
  if (!drafts.length) return [];
  const userId = await getCurrentUserId();
  const rows = drafts.map((draft) => ({
    message_id: messageId,
    ticket_id: ticketId,
    uploaded_by: userId,
    kind: draft.kind,
    storage_bucket: draft.storage_bucket || SUPPORT_BUCKET,
    storage_path: draft.storage_path,
    public_url: draft.public_url ?? null,
    mime_type: draft.mime_type ?? null,
    file_name: draft.file_name ?? null,
    file_size: draft.file_size ?? null,
  }));
  const { data, error } = await supabase
    .from("market_support_message_attachments")
    .insert(rows)
    .select(ATTACHMENT_COLUMNS);
  if (error) throw new Error(error.message);
  return hydrateAttachments((data ?? []) as SupportAttachment[]);
}

export async function fetchMySupportTickets(limit = 50) {
  await getCurrentUserId();

  const { data, error } = await supabase
    .from("market_support_tickets")
    .select(TICKET_COLUMNS)
    .order("last_message_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as SupportTicket[];
}

export async function fetchSupportMessages(ticketId: string, limit = 120) {
  await getCurrentUserId();
  const id = cleanText(ticketId, 80);
  if (!id) return [];

  const { data, error } = await supabase
    .from("market_support_messages")
    .select(MESSAGE_COLUMNS)
    .eq("ticket_id", id)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);
  const rows = (data ?? []) as SupportMessage[];
  const attachments = await fetchAttachmentsForMessages(rows.map((row) => row.id));
  return rows.map((row) => ({ ...row, attachments: attachments.get(row.id) ?? [] }));
}

export async function createSupportTicket(input: {
  subject: string;
  category: string;
  priority?: SupportTicketPriority;
  body: string;
  relatedOrderId?: string | null;
  attachments?: SupportLocalFile[];
}) {
  const userId = await getCurrentUserId();
  const subject = cleanText(input.subject, 140);
  const body = cleanText(input.body, 3000);
  const category = cleanText(input.category, 48) || "general";
  const priority = input.priority ?? "NORMAL";
  const relatedOrderIdInput = cleanText(input.relatedOrderId, 80);
  const relatedOrderId = relatedOrderIdInput ? relatedOrderIdInput : null;
  const attachments = input.attachments ?? [];

  if (subject.length < 3) throw new Error("Add a clear subject.");
  if (!body && !attachments.length) throw new Error("Describe the issue or attach proof before sending.");
  if (relatedOrderId && !UUID_RE.test(relatedOrderId)) throw new Error("Enter a valid order ID or leave it empty.");

  const { data: ticket, error: ticketError } = await supabase
    .from("market_support_tickets")
    .insert({
      user_id: userId,
      subject,
      category,
      priority,
      related_order_id: relatedOrderId,
    })
    .select(TICKET_COLUMNS)
    .single();

  if (ticketError) throw new Error(ticketError.message);
  if (!ticket?.id) throw new Error("Support ticket was not created.");

  const { data: message, error: messageError } = await supabase
    .from("market_support_messages")
    .insert({
      ticket_id: ticket.id,
      sender_id: userId,
      sender_kind: "USER",
      body,
    })
    .select(MESSAGE_COLUMNS)
    .single();

  if (messageError) throw new Error(messageError.message);

  const drafts = await uploadSupportFiles(ticket.id, message.id, attachments);
  await insertSupportAttachments(ticket.id, message.id, drafts);
  return ticket as SupportTicket;
}

export async function sendSupportMessage(ticketId: string, bodyInput: string, attachments: SupportLocalFile[] = []) {
  const userId = await getCurrentUserId();
  const ticket = cleanText(ticketId, 80);
  const body = cleanText(bodyInput, 3000);
  if (!ticket) throw new Error("Choose a support ticket.");
  if (!body && !attachments.length) throw new Error("Write a reply or attach proof before sending.");

  const { data, error } = await supabase
    .from("market_support_messages")
    .insert({
      ticket_id: ticket,
      sender_id: userId,
      sender_kind: "USER",
      body,
    })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  const drafts = await uploadSupportFiles(ticket, data.id, attachments);
  const rows = await insertSupportAttachments(ticket, data.id, drafts);
  return { ...(data as SupportMessage), attachments: rows };
}

export async function subscribeToMySupportTickets(onChange: () => void) {
  const userId = await getCurrentUserId();
  const channel = supabase
    .channel(`market-support-tickets-${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "market_support_tickets",
        filter: `user_id=eq.${userId}`,
      },
      onChange,
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export async function subscribeToSupportMessages(ticketId: string, onChange: () => void) {
  await getCurrentUserId();
  const id = cleanText(ticketId, 80);
  if (!id) return () => undefined;

  const channel = supabase
    .channel(`market-support-messages-${id}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "market_support_messages",
        filter: `ticket_id=eq.${id}`,
      },
      onChange,
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "market_support_message_attachments",
        filter: `ticket_id=eq.${id}`,
      },
      onChange,
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
