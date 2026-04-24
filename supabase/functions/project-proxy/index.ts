import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SP_SITE_ID = Deno.env.get("SP_SITE_ID") ?? "";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================================
// SharePoint subfolder structure per project
// Files   -> paperwork (PDFs, docs) organized by document type
// Pictures -> jobsite photos organized by phase
// ============================================================================
const SP_SUBFOLDER_TREE: Record<string, string[]> = {
  Files: [
    "Contracts", "Change_Orders", "Permits", "Insurance_COI_CCI",
    "Submittals", "Plans_Drawings", "Inspections", "Correspondence",
    "Closeout", "Other",
  ],
  Pictures: [
    "Before", "Progress", "After", "Permits_Posted", "Damage", "Other",
  ],
};

// ============================================================================
// Helpers
// ============================================================================

// Decode Azure AD JWT payload without signature verification.
// supabase.auth.getUser() fails with Microsoft-signed tokens (returns 401).
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

// Create a single folder as a child of the given parent folder id (or root if null)
async function createGraphFolder(
  token: string,
  name: string,
  parentId: string | null,
): Promise<{ id: string; webUrl: string } | null> {
  const url = parentId
    ? `${GRAPH_BASE}/sites/${SP_SITE_ID}/drive/items/${parentId}/children`
    : `${GRAPH_BASE}/sites/${SP_SITE_ID}/drive/root/children`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        folder: {},
        "@microsoft.graph.conflictBehavior": "rename",
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error(`SP folder "${name}" failed:`, err?.error?.message ?? res.status);
      return null;
    }
    const d = await res.json();
    return { id: d.id, webUrl: d.webUrl };
  } catch (e) {
    console.error(`SP folder "${name}" threw:`, e);
    return null;
  }
}

// Build the full per-project tree: root -> (Files, Pictures) -> subfolders.
// Best-effort: if any subfolder fails, continue with others.
async function createProjectFolderTree(
  token: string,
  rootName: string,
): Promise<{ id: string; webUrl: string; subfolders: Record<string, string> } | null> {
  if (!SP_SITE_ID) { console.warn("SP_SITE_ID not set"); return null; }

  const root = await createGraphFolder(token, rootName, null);
  if (!root) return null;

  const subfolders: Record<string, string> = {};

  for (const [topLevel, children] of Object.entries(SP_SUBFOLDER_TREE)) {
    const top = await createGraphFolder(token, topLevel, root.id);
    if (!top) continue;
    subfolders[topLevel] = top.id;
    for (const child of children) {
      const sub = await createGraphFolder(token, child, top.id);
      if (sub) subfolders[`${topLevel}/${child}`] = sub.id;
    }
  }

  return { id: root.id, webUrl: root.webUrl, subfolders };
}

// Seed project_tasks from workflow_task_templates based on division.
// Templates with division=null apply to both regular and IRA.
async function seedTasksFromTemplates(
  projectId: string,
  division: string,
  roleMap: { pm_id?: string | null; assistant_pm_id?: string | null; estimator_id?: string | null },
): Promise<number> {
  const { data: templates, error } = await supabase
    .from("workflow_task_templates")
    .select("*")
    .eq("is_active", true)
    .or(`division.eq.${division},division.is.null`)
    .order("stage_number")
    .order("sort_order");

  if (error || !templates || templates.length === 0) {
    console.error("Template fetch failed:", error?.message);
    return 0;
  }

  const rows = templates.map((t) => {
    let assigned_to_id: string | null = null;
    if (t.assigned_role === "project_manager") assigned_to_id = roleMap.pm_id ?? null;
    if (t.assigned_role === "assistant_pm")    assigned_to_id = roleMap.assistant_pm_id ?? null;
    if (t.assigned_role === "estimator")       assigned_to_id = roleMap.estimator_id ?? null;

    return {
      project_id: projectId,
      template_id: t.id,
      task_name: t.task_name,
      stage_number: t.stage_number,
      assigned_role: t.assigned_role,
      assigned_to_id,
      status: "pending",
      is_recurring: t.is_recurring ?? false,
      recurrence_type: t.recurrence_type ?? "none",
      recurrence_day_of_week: t.recurrence_day_of_week,
    };
  });

  const { error: insErr } = await supabase.from("project_tasks").insert(rows);
  if (insErr) {
    console.error("Task seed failed:", insErr.message);
    return 0;
  }
  return rows.length;
}

// ============================================================================
// Main handler
// ============================================================================
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "").trim();
    if (!jwt) return json({ error: "No authorization header" }, 401);

    const payload = parseJwtPayload(jwt);
    if (!payload) return json({ error: "Invalid token" }, 401);

    const userId = (payload.oid ?? payload.sub) as string | undefined;
    if (!userId) return json({ error: "No user identity in token" }, 401);

    const body = await req.json();
    const { action, project, projectId, id, updates, taskId, milestoneId, providerToken } = body;

    // ------------------------------------------------------------------------
    // INSERT PROJECT
    // ------------------------------------------------------------------------
    if (action === "insert") {
      const { data: newProject, error: insertErr } = await supabase
        .from("projects")
        .insert({ ...project, created_by: userId })
        .select()
        .single();
      if (insertErr) return json({ error: insertErr.message }, 400);
      if (!newProject) return json({ error: "Insert returned no row" }, 500);

      const taskCount = await seedTasksFromTemplates(
        newProject.id,
        newProject.division,
        {
          pm_id: newProject.pm_id,
          assistant_pm_id: newProject.assistant_pm_id,
          estimator_id: newProject.estimator_id,
        },
      );

      // Production row (ignore duplicate error via maybeSingle)
      await supabase.from("project_production")
        .insert({ project_id: newProject.id, pm_id: newProject.pm_id ?? null });

      let spResult = null;
      if (providerToken) {
        const folderName = sanitizeFolderName(
          newProject.project_number ?? String(newProject.id),
          newProject.project_address ?? "No_Address",
        );
        spResult = await createProjectFolderTree(providerToken, folderName);
        if (spResult) {
          await supabase.from("projects").update({
            sharepoint_folder_id: spResult.id,
            sharepoint_folder_url: spResult.webUrl,
          }).eq("id", newProject.id);
          Object.assign(newProject, {
            sharepoint_folder_id: spResult.id,
            sharepoint_folder_url: spResult.webUrl,
          });
        }
      }

      return json({
        data: newProject,
        meta: {
          tasks_seeded: taskCount,
          sharepoint_created: !!spResult,
          sharepoint_subfolders: spResult?.subfolders ? Object.keys(spResult.subfolders).length : 0,
        },
      });
    }

    // ------------------------------------------------------------------------
    // BACKFILL PROJECT — idempotent fix for missing tasks / SP folder / production
    // ------------------------------------------------------------------------
    if (action === "backfill_project") {
      const targetId = id || projectId;
      if (!targetId) return json({ error: "projectId required" }, 400);

      const { data: proj, error: pe } = await supabase
        .from("projects").select("*").eq("id", targetId).single();
      if (pe || !proj) return json({ error: pe?.message ?? "project not found" }, 404);

      const meta: Record<string, unknown> = {
        project_number: proj.project_number,
        tasks_already: 0,
        tasks_seeded: 0,
        sp_already: !!proj.sharepoint_folder_id,
        sp_created: false,
        sp_subfolders: 0,
        production_already: false,
        production_created: false,
      };

      const { count: existingCount } = await supabase
        .from("project_tasks")
        .select("*", { count: "exact", head: true })
        .eq("project_id", proj.id);

      meta.tasks_already = existingCount ?? 0;
      if (!existingCount) {
        const seeded = await seedTasksFromTemplates(
          proj.id,
          proj.division,
          { pm_id: proj.pm_id, assistant_pm_id: proj.assistant_pm_id, estimator_id: proj.estimator_id },
        );
        meta.tasks_seeded = seeded;
      }

      const { data: existingProd } = await supabase
        .from("project_production").select("id").eq("project_id", proj.id).maybeSingle();
      meta.production_already = !!existingProd;
      if (!existingProd) {
        const { error: prodErr } = await supabase
          .from("project_production").insert({ project_id: proj.id, pm_id: proj.pm_id ?? null });
        meta.production_created = !prodErr;
      }

      if (!proj.sharepoint_folder_id && providerToken) {
        const folderName = sanitizeFolderName(
          proj.project_number ?? String(proj.id),
          proj.project_address ?? "No_Address",
        );
        const spResult = await createProjectFolderTree(providerToken, folderName);
        if (spResult) {
          await supabase.from("projects").update({
            sharepoint_folder_id: spResult.id,
            sharepoint_folder_url: spResult.webUrl,
          }).eq("id", proj.id);
          meta.sp_created = true;
          meta.sp_subfolders = Object.keys(spResult.subfolders).length;
        }
      }

      return json({ data: proj, meta });
    }

    // ------------------------------------------------------------------------
    // UPDATE PROJECT (general)
    // ------------------------------------------------------------------------
    if (action === "update") {
      if (!projectId) return json({ error: "projectId required" }, 400);
      const { data, error } = await supabase.from("projects")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", projectId).select().single();
      if (error) return json({ error: error.message }, 400);
      return json({ data });
    }

    // ------------------------------------------------------------------------
    // UPDATE PROJECT TEAM (pm_id / assistant_pm_id)
    // ------------------------------------------------------------------------
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

    // ------------------------------------------------------------------------
    // UPDATE TASK (status, assigned_to_id, notes, etc.)
    // ------------------------------------------------------------------------
    if (action === "update_task") {
      if (!taskId) return json({ error: "taskId required" }, 400);
      const taskUpdate: Record<string, unknown> = { ...updates, updated_at: new Date().toISOString() };
      if (updates?.status === "completed" && !updates.completed_at) {
        taskUpdate.completed_at = new Date().toISOString();
        taskUpdate.completed_by = userId;
      }
      const { data, error } = await supabase.from("project_tasks")
        .update(taskUpdate).eq("id", taskId).select().single();
      if (error) return json({ error: error.message }, 400);
      return json({ data });
    }

    // ------------------------------------------------------------------------
    // UPDATE MILESTONE
    // ------------------------------------------------------------------------
    if (action === "update_milestone") {
      if (!milestoneId) return json({ error: "milestoneId required" }, 400);
      if (!updates || typeof updates !== "object") {
        return json({ error: "updates object required" }, 400);
      }

      const allowed: Record<string, unknown> = {};
      if (updates.value !== undefined) {
        const valid = ["Yes", "No", "Missing", "N/A"];
        if (!valid.includes(updates.value)) {
          return json({ error: `Invalid value '${updates.value}'. Must be one of: ${valid.join(", ")}` }, 400);
        }
        allowed.value = updates.value;
      }
      if (updates.milestone_date !== undefined) allowed.milestone_date = updates.milestone_date || null;
      if (updates.notes !== undefined)          allowed.notes = updates.notes || null;

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

    // ------------------------------------------------------------------------
    // UPLOAD FILE — SharePoint + project_documents record
    // ------------------------------------------------------------------------
    if (action === "upload_file") {
      const targetId = projectId || id;
      const { category, fileName, fileContent, document_type } = body;
      if (!targetId || !fileName || !fileContent) {
        return json({ error: "projectId, fileName, fileContent required" }, 400);
      }
      if (!providerToken) return json({ error: "providerToken required for SharePoint upload" }, 400);

      const { data: proj, error: pe } = await supabase
        .from("projects").select("id, sharepoint_folder_id").eq("id", targetId).single();
      if (pe || !proj?.sharepoint_folder_id) {
        return json({ error: "Project has no SharePoint folder. Run backfill first." }, 400);
      }

      const safeName = fileName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
      const safePath = category
        ? `${category.split("/").map((s: string) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")).join("/")}/${safeName}`
        : safeName;
      const uploadUrl = `${GRAPH_BASE}/sites/${SP_SITE_ID}/drive/items/${proj.sharepoint_folder_id}:/${safePath}:/content`;

      const bytes = Uint8Array.from(atob(fileContent), (c) => c.charCodeAt(0));

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { Authorization: `Bearer ${providerToken}`, "Content-Type": "application/octet-stream" },
        body: bytes,
      });

      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}));
        return json({ error: `SharePoint upload failed: ${err?.error?.message ?? uploadRes.status}` }, 500);
      }

      const driveItem = await uploadRes.json();

      const { data: profile } = await supabase
        .from("profiles").select("id").eq("azure_oid", userId).maybeSingle();

      const { data: doc } = await supabase.from("project_documents").insert({
        project_id: targetId,
        document_type: document_type ?? null,
        name: fileName,
        sharepoint_item_id: driveItem.id,
        sharepoint_url: driveItem.webUrl,
        sharepoint_drive_id: driveItem.parentReference?.driveId ?? null,
        file_size_bytes: driveItem.size ?? null,
        mime_type: driveItem.file?.mimeType ?? null,
        uploaded_by: profile?.id ?? null,
      }).select().single();

      return json({ data: doc, meta: { sharepoint_url: driveItem.webUrl } });
    }

    // ------------------------------------------------------------------------
    // SELECT PROJECTS
    // ------------------------------------------------------------------------
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
