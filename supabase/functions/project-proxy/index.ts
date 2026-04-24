import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SP_SITE_ID = Deno.env.get("SP_SITE_ID") ?? "";
const SP_CONTACTS_LIST_ID = Deno.env.get("SP_CONTACTS_LIST_ID") ?? "";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Decode Azure AD JWT payload without signature verification.
// supabase.auth.getUser() always fails with Microsoft-signed tokens (returns 401).
// We base64-decode the payload section directly to extract identity claims.
function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const pad = parts[1].length % 4;
    const b64 = parts[1] + (pad ? "=".repeat(4 - pad) : "");
    return JSON.parse(atob(b64.replace(/-/g, "+").replace(/_/g, "/")));
  } catch { return null; }
}

function sanitizeFolderName(projectNumber: string, address: string): string {
  return (projectNumber + "_" + address)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
    .substring(0, 240);
}

async function createSharePointFolder(token: string, folderName: string): Promise<{ id: string; webUrl: string } | null> {
  if (!SP_SITE_ID) { console.warn("SP_SITE_ID not set"); return null; }
  try {
    const res = await fetch(`${GRAPH_BASE}/sites/${SP_SITE_ID}/drive/root/children`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: folderName, folder: {}, "@microsoft.graph.conflictBehavior": "rename" }),
    });
    if (!res.ok) { const err = await res.json(); console.error("SP folder error:", err?.error?.message); return null; }
    const d = await res.json();
    return { id: d.id, webUrl: d.webUrl };
  } catch (e) { console.error("SP folder fetch threw:", e); return null; }
}

async function createSharePointContact(token: string, fields: Record<string, string>): Promise<string | null> {
  if (!SP_SITE_ID || !SP_CONTACTS_LIST_ID) return null;
  try {
    const res = await fetch(`${GRAPH_BASE}/sites/${SP_SITE_ID}/lists/${SP_CONTACTS_LIST_ID}/items`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d.id ?? null;
  } catch { return null; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    // Auth: decode the Azure AD JWT payload directly — no Supabase sig verification
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "").trim();
    if (!jwt) return json({ error: "No authorization header" }, 401);

    const payload = parseJwtPayload(jwt);
    if (!payload) return json({ error: "Invalid token" }, 401);

    // Azure AD uses 'oid' as the stable object ID; fall back to 'sub'
    const userId = (payload.oid ?? payload.sub) as string | undefined;
    if (!userId) return json({ error: "No user identity in token" }, 401);

    const body = await req.json();
    const { action, project, projectId, id, updates, taskId, milestoneId, providerToken } = body;

    // -- INSERT PROJECT -------------------------------------------------------
    if (action === "insert") {
      const { data: newProject, error: insertErr } = await supabase
        .from("projects").insert({ ...project, created_by: userId }).select().single();
      if (insertErr) return json({ error: insertErr.message }, 400);
      if (providerToken && newProject) {
        const folderName = sanitizeFolderName(
          newProject.project_number ?? String(newProject.id),
          newProject.address ?? "No_Address",
        );
        const folder = await createSharePointFolder(providerToken, folderName);
        if (folder) {
          const listItemId = await createSharePointContact(providerToken, {
            Title: newProject.client_name ?? "",
            ProjectNumber: newProject.project_number ?? "",
            Address: newProject.address ?? "",
            FolderURL: folder.webUrl,
          });
          const spUpdate: Record<string, string | null> = {
            sharepoint_folder_id: folder.id,
            sharepoint_folder_url: folder.webUrl,
          };
          if (listItemId) spUpdate.sharepoint_list_item_id = listItemId;
          await supabase.from("projects").update(spUpdate).eq("id", newProject.id);
          Object.assign(newProject, spUpdate);
        }
      }
      return json({ data: newProject });
    }

    // -- UPDATE PROJECT (general) --------------------------------------------
    if (action === "update") {
      if (!projectId) return json({ error: "projectId required" }, 400);
      const { data, error } = await supabase.from("projects")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", projectId).select().single();
      if (error) return json({ error: error.message }, 400);
      return json({ data });
    }

    // -- UPDATE PROJECT TEAM (pm_id / assistant_pm_id) -----------------------
    if (action === "update_project") {
      const targetId = id || projectId;
      if (!targetId) return json({ error: "id required" }, 400);
      const { pm_id, assistant_pm_id } = body;
      const teamUpdate: Record<string, string | null | undefined> = {
        updated_at: new Date().toISOString(),
      };
      if (pm_id !== undefined) teamUpdate.pm_id = pm_id || null;
      if (assistant_pm_id !== undefined) teamUpdate.assistant_pm_id = assistant_pm_id || null;
      const { data, error } = await supabase.from("projects")
        .update(teamUpdate).eq("id", targetId).select().single();
      if (error) return json({ error: error.message }, 400);
      return json({ data });
    }

    // -- UPDATE TASK ----------------------------------------------------------
    if (action === "update_task") {
      if (!taskId) return json({ error: "taskId required" }, 400);
      const { data, error } = await supabase.from("project_tasks")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", taskId).select().single();
      if (error) return json({ error: error.message }, 400);
      return json({ data });
    }

    // -- UPDATE MILESTONE -----------------------------------------------------
    // Accepts updates to: value (enum: Yes|No|Missing|N/A), milestone_date, notes
    // Always stamps updated_by with the Azure AD user id and updated_at = now()
    if (action === "update_milestone") {
      if (!milestoneId) return json({ error: "milestoneId required" }, 400);
      if (!updates || typeof updates !== "object") {
        return json({ error: "updates object required" }, 400);
      }

      // Whitelist allowed fields — never let the client pass arbitrary columns
      const allowed: Record<string, unknown> = {};
      if (updates.value !== undefined) {
        const validValues = ["Yes", "No", "Missing", "N/A"];
        if (!validValues.includes(updates.value)) {
          return json({ error: `Invalid value '${updates.value}'. Must be one of: ${validValues.join(", ")}` }, 400);
        }
        allowed.value = updates.value;
      }
      if (updates.milestone_date !== undefined) {
        // Accept null (to clear) or ISO date string
        allowed.milestone_date = updates.milestone_date || null;
      }
      if (updates.notes !== undefined) {
        allowed.notes = updates.notes || null;
      }

      if (Object.keys(allowed).length === 0) {
        return json({ error: "No valid fields to update" }, 400);
      }

      allowed.updated_by = userId;
      allowed.updated_at = new Date().toISOString();

      const { data, error } = await supabase.from("project_milestones")
        .update(allowed)
        .eq("id", milestoneId)
        .select("*, milestone_definitions(label, key, sort_order, active_from_stage)")
        .single();
      if (error) return json({ error: error.message }, 400);
      return json({ data });
    }

    // -- SELECT PROJECTS ------------------------------------------------------
    if (action === "select") {
      const { data, error } = await supabase.from("projects")
        .select("*").order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, 400);
      return json({ data });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("project-proxy unhandled:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});