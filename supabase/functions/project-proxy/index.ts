import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SP_SITE_ID                = Deno.env.get("SP_SITE_ID") ?? "";

const SP_CONTACTS_LIST_ID       = Deno.env.get("SP_CONTACTS_LIST_ID") ?? "";
const GRAPH_BASE                = "https://graph.microsoft.com/v1.0";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",h
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function sanitizeFolderName(projectNumber: string, address: string): string {
  return `${projectNumber}_${address}`
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 240);
}

async function createSharePointFolder(
  token: string,
  folderName: string,
): Promise<{ id: string; webUrl: string } | null> {
    if (!SP_SITE_ID) {
          console.warn("SP_SITE_ID not set - skipping folder creation");
    return null;
  }
  try {
    const res = await fetch(
              `${GRAPH_BASE}/sites/${SP_SITE_ID}/drive/root/children`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: folderName,
          folder: {},
          "@microsoft.graph.conflictBehavior": "rename",
        }),
      },
    );
    if (!res.ok) {
      const err = await res.json();
      console.error("SP folder error:", err?.error?.message);
      return null; // non-fatal
    }
    const d = await res.json();
    return { id: d.id, webUrl: d.webUrl };
  } catch (e) {
    console.error("SP folder fetch threw:", e);
    return null;
  }
}

async function createSharePointContact(
  token: string,
  fields: Record<string, string>,
): Promise<string | null> {
  if (!SP_SITE_ID || !SP_CONTACTS_LIST_ID) return null;
  try {
    const res = await fetch(
      `${GRAPH_BASE}/sites/${SP_SITE_ID}/lists/${SP_CONTACTS_LIST_ID}/items`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      },
    );
    if (!res.ok) return null;
    const d = await res.json();
    return d.id ?? null;
  } catch {
    return null;
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    // Verify caller is an authenticated Supabase user
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "").trim();
    if (!jwt) return json({ error: "No authorization header" }, 401);

    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const { action, project, projectId, updates, taskId, providerToken } = body;

    // ── INSERT PROJECT ──────────────────────────────────────────────────────
    if (action === "insert") {
      const { data: newProject, error: insertErr } = await supabase
        .from("projects")
        .insert({ ...project, created_by: user.id })
        .select()
        .single();

      if (insertErr) return json({ error: insertErr.message }, 400);

      // SharePoint folder creation — non-fatal
      if (providerToken && newProject) {
        const folderName = sanitizeFolderName(
          newProject.project_number ?? String(newProject.id),
          newProject.address ?? "No_Address",
        );

        const folder = await createSharePointFolder(providerToken, folderName);

        if (folder) {
          // Create SP contact list item in parallel
          const listItemId = await createSharePointContact(providerToken, {
            Title:         newProject.client_name ?? "",
            ProjectNumber: newProject.project_number ?? "",
            Address:       newProject.address ?? "",
            FolderURL:     folder.webUrl,
          });

          const spUpdate: Record<string, string | null> = {
            sharepoint_folder_id:  folder.id,
            sharepoint_folder_url: folder.webUrl,
          };
          if (listItemId) spUpdate.sharepoint_list_item_id = listItemId;

          await supabase.from("projects").update(spUpdate).eq("id", newProject.id);

          Object.assign(newProject, spUpdate);
        }
      }

      return json({ data: newProject });
    }

    // ── UPDATE PROJECT ──────────────────────────────────────────────────────
    if (action === "update") {
      if (!projectId) return json({ error: "projectId required" }, 400);
      const { data, error } = await supabase
        .from("projects")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", projectId)
        .select()
        .single();
      if (error) return json({ error: error.message }, 400);
      return json({ data });
    }

    // ── UPDATE TASK ─────────────────────────────────────────────────────────
    if (action === "update_task") {
      if (!taskId) return json({ error: "taskId required" }, 400);
      const { data, error } = await supabase
        .from("project_tasks")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", taskId)
        .select()
        .single();
      if (error) return json({ error: error.message }, 400);
      return json({ data });
    }

    // ── SELECT PROJECTS ─────────────────────────────────────────────────────
    // Use this only if direct reads fail due to RLS / anon role issue
    if (action === "select") {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, 400);
      return json({ data });
    }

    return json({ error: `Unknown action: ${action}` }, 400);

  } catch (e) {
    console.error("project-proxy unhandled:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
