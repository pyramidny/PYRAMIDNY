// supabase/functions/project-proxy/index.ts
// Service-role Edge Function — lets Azure AD users write to projects table.
// Azure AD PKCE tokens are signed by Microsoft, not Supabase, so PostgREST
// treats every request as anon. This function:
//   1. Extracts caller email from the Azure AD JWT
//   2. Verifies email is in staff_whitelist
//   3. Uses service_role key to execute the DB operation
//
// Deploy: supabase functions deploy project-proxy --project-ref izjaxmcdlsdkdliqjlei

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function parseJwtPayload(token: string) {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // 1. Extract caller email from Azure AD JWT
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization header" }, 401);

  const payload = parseJwtPayload(token);
  if (!payload) return json({ error: "Invalid token" }, 401);

  const callerEmail: string = (
    payload.preferred_username ?? payload.upn ?? payload.email ?? ""
  ).toLowerCase();
  if (!callerEmail) return json({ error: "Cannot determine caller email from token" }, 401);

  // 2. Parse request body
  let body: { action: string; table: string; data?: Record<string, unknown>; id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { action, table } = body;
  const ALLOWED_TABLES = ["projects", "project_tasks"];
  if (!ALLOWED_TABLES.includes(table)) {
    return json({ error: `Table '${table}' not allowed via proxy` }, 403);
  }

  // 3. Verify caller is in staff_whitelist
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: whitelisted, error: wlErr } = await admin
    .from("staff_whitelist")
    .select("email, role")
    .eq("email", callerEmail)
    .maybeSingle();

  if (wlErr) return json({ error: "Whitelist lookup failed" }, 500);
  if (!whitelisted) return json({ error: "Not authorized" }, 403);

  // Resolve profile id for created_by / updated_by fields
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("email", callerEmail)
    .maybeSingle();

  const profileId: string | null = profile?.id ?? null;

  // 4. Execute action
  try {
    if (action === "insert" && table === "projects") {
      const { data, error } = await admin
        .from("projects")
        .insert({
          ...body.data,
          created_by: profileId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ data });
    }

    if (action === "update" && table === "projects") {
      if (!body.id) return json({ error: "id required for update" }, 400);
      const { data, error } = await admin
        .from("projects")
        .update({ ...body.data, updated_at: new Date().toISOString() })
        .eq("id", body.id)
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ data });
    }

    return json({ error: `Unknown action '${action}'` }, 400);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});