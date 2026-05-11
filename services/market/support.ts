import { supabase } from "@/services/supabase";

export type SupportTicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
export type SupportTicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export type SupportTicket = {
  id: string;
  user_id: string;
  subject: string;
  category: string;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  related_order_id: string | null;
  assigned_admin_id: string | null;
  last_message_at: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SupportMessage = {
  id: string;
  ticket_id: string;
  sender_id: string;
  sender_kind: "USER" | "ADMIN";
  body: string;
  created_at: string;
};

const TICKET_COLUMNS =
  "id,user_id,subject,category,priority,status,related_order_id,assigned_admin_id,last_message_at,resolved_at,created_at,updated_at";

const MESSAGE_COLUMNS = "id,ticket_id,sender_id,sender_kind,body,created_at";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanText(value: unknown, max = 3000) {
  return String(value ?? "").trim().slice(0, max);
}

async function getCurrentUserId() {
  const { data } = await supabase.auth.getUser();
  const userId = data?.user?.id ?? null;
  if (!userId) throw new Error("Sign in to contact support.");
  return userId;
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
  return (data ?? []) as SupportMessage[];
}

export async function createSupportTicket(input: {
  subject: string;
  category: string;
  priority?: SupportTicketPriority;
  body: string;
  relatedOrderId?: string | null;
}) {
  const userId = await getCurrentUserId();
  const subject = cleanText(input.subject, 140);
  const body = cleanText(input.body, 3000);
  const category = cleanText(input.category, 48) || "general";
  const priority = input.priority ?? "NORMAL";
  const relatedOrderIdInput = cleanText(input.relatedOrderId, 80);
  const relatedOrderId = relatedOrderIdInput ? relatedOrderIdInput : null;

  if (subject.length < 3) throw new Error("Add a clear subject.");
  if (!body) throw new Error("Describe the issue before sending.");
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

  const { error: messageError } = await supabase.from("market_support_messages").insert({
    ticket_id: ticket.id,
    sender_id: userId,
    sender_kind: "USER",
    body,
  });

  if (messageError) throw new Error(messageError.message);
  return ticket as SupportTicket;
}

export async function sendSupportMessage(ticketId: string, bodyInput: string) {
  const userId = await getCurrentUserId();
  const ticket = cleanText(ticketId, 80);
  const body = cleanText(bodyInput, 3000);
  if (!ticket) throw new Error("Choose a support ticket.");
  if (!body) throw new Error("Write a reply before sending.");

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
  return data as SupportMessage;
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
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
