import { supabase } from "@/services/supabase";
import { uploadToSupabaseStorage } from "@/services/market/storageUpload";

export type DisputeAttachmentKind = "image" | "video" | "audio" | "file";
export type DisputeSenderKind = "BUYER" | "SELLER" | "ADMIN";

export type DisputeAttachment = {
  id: string;
  dispute_id: string;
  message_id: string;
  order_id: string;
  uploaded_by: string;
  kind: DisputeAttachmentKind;
  storage_bucket: string;
  storage_path: string;
  public_url: string | null;
  signed_url?: string | null;
  mime_type: string | null;
  file_name: string | null;
  file_size: number | null;
  created_at: string;
};

export type DisputeMessage = {
  id: string;
  dispute_id: string;
  order_id: string;
  sender_id: string;
  sender_kind: DisputeSenderKind;
  body: string;
  created_at: string;
  attachments?: DisputeAttachment[];
};

export type MarketDispute = {
  id: string;
  order_id: string;
  opened_by: string;
  reason: string;
  status: "OPEN" | "UNDER_REVIEW" | "RESOLVED";
  resolution: string | null;
  resolved_by: string | null;
  resolved_at?: string | null;
  resolution_note?: string | null;
  created_at: string;
  updated_at: string;
};

export type DisputeLocalFile = {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
  fileBody?: Blob | null;
};

type DisputeAttachmentDraft = {
  kind: DisputeAttachmentKind;
  storage_bucket: string;
  storage_path: string;
  public_url: string | null;
  mime_type: string | null;
  file_name: string | null;
  file_size: number | null;
};

const DISPUTE_BUCKET = "market-disputes";
const DISPUTE_COLUMNS =
  "id,order_id,opened_by,reason,status,resolution,resolved_by,resolved_at,resolution_note,created_at,updated_at";
const MESSAGE_COLUMNS = "id,dispute_id,order_id,sender_id,sender_kind,body,created_at";
const ATTACHMENT_COLUMNS =
  "id,dispute_id,message_id,order_id,uploaded_by,kind,storage_bucket,storage_path,public_url,mime_type,file_name,file_size,created_at";

function cleanText(value: unknown, max = 4000) {
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
  return "application/octet-stream";
}

function attachmentKind(mime?: string | null, name?: string | null): DisputeAttachmentKind {
  const raw = String(mime || mimeFromName(name)).toLowerCase();
  if (raw.startsWith("image/")) return "image";
  if (raw.startsWith("video/")) return "video";
  if (raw.startsWith("audio/")) return "audio";
  return "file";
}

async function currentUserId() {
  const { data } = await supabase.auth.getUser();
  const userId = data?.user?.id ?? null;
  if (!userId) throw new Error("Sign in to continue this dispute.");
  return userId;
}

async function signedAttachmentUrl(attachment: DisputeAttachment) {
  if (attachment.public_url) return attachment.public_url;
  if (!attachment.storage_path) return null;
  const { data } = await supabase.storage
    .from(attachment.storage_bucket || DISPUTE_BUCKET)
    .createSignedUrl(attachment.storage_path, 3600);
  return data?.signedUrl ?? null;
}

async function hydrateAttachments(rows: DisputeAttachment[]) {
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
  if (!messageIds.length) return new Map<string, DisputeAttachment[]>();
  const { data, error } = await supabase
    .from("market_dispute_attachments")
    .select(ATTACHMENT_COLUMNS)
    .in("message_id", messageIds)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const hydrated = await hydrateAttachments((data ?? []) as DisputeAttachment[]);
  const map = new Map<string, DisputeAttachment[]>();
  hydrated.forEach((attachment) => {
    const list = map.get(attachment.message_id) ?? [];
    list.push(attachment);
    map.set(attachment.message_id, list);
  });
  return map;
}

async function uploadDisputeFiles(orderId: string, messageId: string, files: DisputeLocalFile[] = []) {
  const userId = await currentUserId();
  const safeOrder = cleanText(orderId, 80);
  const safeMessage = cleanText(messageId, 80);
  if (!safeOrder || !safeMessage || !files.length) return [];

  const drafts: DisputeAttachmentDraft[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file?.uri) continue;
    const name = safeFileName(file.name || file.uri.split("/").pop());
    const mime = file.mimeType || mimeFromName(name);
    const path = `${userId}/${safeOrder}/${safeMessage}/${Date.now()}-${index}-${name}`;
    const uploaded = await uploadToSupabaseStorage({
      bucket: DISPUTE_BUCKET,
      path,
      localUri: file.uri,
      fileBody: file.fileBody ?? null,
      contentType: mime,
      upsert: false,
    });

    drafts.push({
      kind: attachmentKind(mime, name),
      storage_bucket: DISPUTE_BUCKET,
      storage_path: uploaded.storagePath,
      public_url: null,
      mime_type: mime,
      file_name: name,
      file_size: typeof file.size === "number" ? file.size : null,
    });
  }

  return drafts;
}

async function insertDisputeAttachments(
  disputeId: string,
  orderId: string,
  messageId: string,
  drafts: DisputeAttachmentDraft[],
) {
  if (!drafts.length) return [];
  const userId = await currentUserId();
  const rows = drafts.map((draft) => ({
    dispute_id: disputeId,
    message_id: messageId,
    order_id: orderId,
    uploaded_by: userId,
    kind: draft.kind,
    storage_bucket: draft.storage_bucket || DISPUTE_BUCKET,
    storage_path: draft.storage_path,
    public_url: draft.public_url ?? null,
    mime_type: draft.mime_type ?? null,
    file_name: draft.file_name ?? null,
    file_size: draft.file_size ?? null,
  }));

  const { data, error } = await supabase
    .from("market_dispute_attachments")
    .insert(rows)
    .select(ATTACHMENT_COLUMNS);
  if (error) throw new Error(error.message);
  return hydrateAttachments((data ?? []) as DisputeAttachment[]);
}

async function insertDisputeMessage(input: {
  disputeId: string;
  orderId: string;
  senderKind: Exclude<DisputeSenderKind, "ADMIN">;
  body: string;
  attachments?: DisputeLocalFile[];
}) {
  const userId = await currentUserId();
  const body = cleanText(input.body);
  const attachments = input.attachments ?? [];
  if (!body && !attachments.length) throw new Error("Explain what happened or attach proof before sending.");

  const { data, error } = await supabase
    .from("market_dispute_messages")
    .insert({
      dispute_id: input.disputeId,
      order_id: input.orderId,
      sender_id: userId,
      sender_kind: input.senderKind,
      body,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) throw new Error(error.message);

  const drafts = await uploadDisputeFiles(input.orderId, data.id, attachments);
  const rows = await insertDisputeAttachments(input.disputeId, input.orderId, data.id, drafts);
  return { ...(data as DisputeMessage), attachments: rows };
}

export async function fetchOrderDispute(orderId: string) {
  await currentUserId();
  const id = cleanText(orderId, 80);
  if (!id) return null;

  const { data: dispute, error } = await supabase
    .from("market_disputes")
    .select(DISPUTE_COLUMNS)
    .eq("order_id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!dispute) return null;

  const { data: messages, error: messageError } = await supabase
    .from("market_dispute_messages")
    .select(MESSAGE_COLUMNS)
    .eq("dispute_id", dispute.id)
    .order("created_at", { ascending: true })
    .limit(120);
  if (messageError) throw new Error(messageError.message);

  const rows = (messages ?? []) as DisputeMessage[];
  const attachments = await fetchAttachmentsForMessages(rows.map((row) => row.id));

  return {
    dispute: dispute as MarketDispute,
    messages: rows.map((row) => ({ ...row, attachments: attachments.get(row.id) ?? [] })),
  };
}

export async function openOrderDispute(input: {
  orderId: string;
  senderKind: Exclude<DisputeSenderKind, "ADMIN">;
  reason: string;
  body: string;
  attachments?: DisputeLocalFile[];
}) {
  const reason = cleanText(input.reason, 1000) || "Order dispute";
  const { data, error } = await supabase.rpc("market_open_dispute_rpc", {
    p_order_id: input.orderId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);

  const dispute = data as MarketDispute | null;
  const disputeId = dispute?.id || (await fetchOrderDispute(input.orderId))?.dispute?.id;
  if (!disputeId) throw new Error("Dispute was not created.");

  await insertDisputeMessage({
    disputeId,
    orderId: input.orderId,
    senderKind: input.senderKind,
    body: input.body,
    attachments: input.attachments,
  });

  return fetchOrderDispute(input.orderId);
}

export async function sendDisputeMessage(input: {
  disputeId: string;
  orderId: string;
  senderKind: Exclude<DisputeSenderKind, "ADMIN">;
  body: string;
  attachments?: DisputeLocalFile[];
}) {
  await insertDisputeMessage(input);
  return fetchOrderDispute(input.orderId);
}
