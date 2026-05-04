export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-session, x-admin-token",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

function withCors(extra?: Record<string, string>) {
  return { ...CORS_HEADERS, ...(extra || {}) };
}

export function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: withCors({ "Content-Type": "application/json" }),
  });
}

export function ok(body: unknown) {
  return json(200, body);
}

export function bad(message: string, extra: any = {}) {
  return json(400, { error: message, ...extra });
}

export function unauth() {
  return json(401, { error: "Unauthorized" });
}

export function methodNotAllowed(req?: Request) {
  if (req?.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: withCors() });
  }
  return new Response("Method not allowed", { status: 405, headers: withCors() });
}

export function requireFields(obj: any, fields: string[]) {
  for (const f of fields) {
    if (obj?.[f] === undefined || obj?.[f] === null || obj?.[f] === "") {
      throw new Error(`Missing field: ${f}`);
    }
  }
}
