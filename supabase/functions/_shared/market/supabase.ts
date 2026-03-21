import { createClient } from "https://esm.sh/@supabase/supabase-js@2.87.1";
import { getAnonKey, getServiceKey, getSupabaseUrl } from "./env.ts";

export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  return token.length ? token : null;
}

export function supabaseUserClient(req: Request) {
  const supabaseUrl = getSupabaseUrl();
  const anon = getAnonKey();

  const token = extractBearerToken(req);

  // IMPORTANT:
  // - persistSession/autoRefreshToken should be false in Edge Functions
  // - set the Authorization header (if present)
  return createClient(supabaseUrl, anon, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
}

export function supabaseAdminClient() {
  const supabaseUrl = getSupabaseUrl();
  const service = getServiceKey();

  return createClient(supabaseUrl, service, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
