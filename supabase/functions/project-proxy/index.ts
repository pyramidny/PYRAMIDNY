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

// Valid user_role values (from DB enum) — used to validate role updates
const VALID_ROLES = [
  "admin", "director_of_operations", "sales_rep", "estimating_coordinator",
  "estimator", "project_manager", "assistant_pm", "task_manager",
  "purchasing_manager", "billing_coordinator", "office_manager", "field_crew",
];

// ============================================================================
// Helpers
// ============================================================================

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

// Write to staff_audit_log — best-effort, never fails the parent operation
async function writeAudit(
  email: string,
  action: string,
  changedBy: string | null,
  oldValues: unknown,
  newValues: unknown,
  notes?: string,
) {
  try {
    await supabase.from("staff_audit_log").insert({
      email,
      action,
      changed_by: changedBy,
      old_values: oldValues ?? null,
      new_values: newValues ?? null,
      notes: notes ?? null,
    });
  } catch (e) {
    console.error("Audit write failed:", e);
  }
}

// Look up the caller's profile by azure_oid (JWT sub/oid claim)
async function lookupCallerProfile(userId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("id, email, role, is_active")
    .eq("azure_oid", userId)
    .maybeSingle();
  return data;
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
        newProject.id, newProject.division,
        {
          pm_id: newProject.pm_id,
          assistant_pm_id: newProject.assistant_pm_id,
          estimator_id: newProject.estimator_id,
        },
      );

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
    // BACKFILL PROJECT
    // ------------------------------------------------------------------------
    if (action === "backfill_project") {
      const targetId = id || projectId;
      if (!targetId) return json({ error: "projectId required" }, 400);

      const { data: proj, error: pe } = await supabase
        .from("projects").select("*").eq("id", targetId).single();
      if (pe || !proj) return json({ error: pe?.message ?? "project not found" }, 404);

      const meta: Record<string, unknown> = {
        project_number: proj.project_number,
        tasks_already: 0, tasks_seeded: 0,
        sp_already: !!proj.sharepoint_folder_id, sp_created: false, sp_subfolders: 0,
        production_already: false, production_created: false,
      };

      const { count: existingCount } = await supabase
        .from("project_tasks").select("*", { count: "exact", head: true }).eq("project_id", proj.id);
      meta.tasks_already = existingCount ?? 0;
      if (!existingCount) {
        meta.tasks_seeded = await seedTasksFromTemplates(
          proj.id, proj.division,
          { pm_id: proj.pm_id, assistant_pm_id: proj.assistant_pm_id, estimator_id: proj.estimator_id },
        );
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
    // UPDATE PROJECT TEAM
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
    // UPDATE TASK
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
        .update(allowed).eq("id", milestoneId)
        .select("*, milestone_definitions(label, key, sort_order, active_from_stage)")
        .single();
      if (error) return json({ error: error.message }, 400);
      return json({ data });
    }

    // ------------------------------------------------------------------------
    // UPLOAD FILE — now with proper category subfolder path
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
        category: category ?? "Files/Other",
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
    // DELETE FILE — soft-delete in DB, optionally remove from SharePoint
    // ------------------------------------------------------------------------
    if (action === "delete_file") {
      const docId = body.documentId;
      if (!docId) return json({ error: "documentId required" }, 400);

      const { data: doc } = await supabase
        .from("project_documents").select("*").eq("id", docId).single();
      if (!doc) return json({ error: "document not found" }, 404);

      // Soft delete in DB
      await supabase.from("project_documents")
        .update({ is_deleted: true }).eq("id", docId);

      // Attempt SharePoint removal (best-effort)
      if (providerToken && doc.sharepoint_item_id) {
        try {
          await fetch(
            `${GRAPH_BASE}/sites/${SP_SITE_ID}/drive/items/${doc.sharepoint_item_id}`,
            { method: "DELETE", headers: { Authorization: `Bearer ${providerToken}` } },
          );
        } catch (e) {
          console.error("SP delete failed:", e);
        }
      }

      return json({ data: { id: docId, is_deleted: true } });
    }

    // ========================================================================
    // STAFF MANAGEMENT ACTIONS
    // ========================================================================

    // ------------------------------------------------------------------------
    // UPSERT WHITELIST — invite a new person or update existing whitelist row
    // ------------------------------------------------------------------------
    if (action === "upsert_whitelist") {
      const caller = await lookupCallerProfile(userId);
      if (!caller || caller.role !== "admin") {
        return json({ error: "Admin only" }, 403);
      }

      const { email, display_name, full_name, role, division, phone, title } = body;
      if (!email || !full_name) {
        return json({ error: "email and full_name required" }, 400);
      }
      if (role && !VALID_ROLES.includes(role)) {
        return json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` }, 400);
      }

      const normalizedEmail = String(email).toLowerCase().trim();

      // Check if already exists
      const { data: existing } = await supabase
        .from("staff_whitelist").select("*").eq("email", normalizedEmail).maybeSingle();

      const record = {
        email: normalizedEmail,
        display_name: display_name ?? full_name.split(" ")[0],
        full_name,
        role: role ?? "field_crew",
        division: division ?? null,
        phone: phone ?? null,
        title: title ?? null,
        is_active: true,
      };

      const { data, error } = await supabase
        .from("staff_whitelist").upsert(record, { onConflict: "email" }).select().single();

      if (error) return json({ error: error.message }, 400);

      // Audit
      await writeAudit(
        normalizedEmail,
        existing ? "update_whitelist" : "invite",
        caller.id,
        existing ?? null,
        data,
      );

      // If a profile already exists (e.g. re-adding after deactivation), also
      // reactivate and update the profile to match the new whitelist data
      const { data: existingProfile } = await supabase
        .from("profiles").select("*").eq("email", normalizedEmail).maybeSingle();

      if (existingProfile) {
        await supabase.from("profiles").update({
          full_name: record.full_name,
          display_name: record.display_name,
          role: record.role,
          division: record.division,
          phone: record.phone,
          title: record.title,
          is_active: true,
          updated_at: new Date().toISOString(),
        }).eq("id", existingProfile.id);
      }

      return json({ data, meta: { reactivated_profile: !!existingProfile } });
    }

    // ------------------------------------------------------------------------
    // UPDATE PROFILE — change role, division, etc. for an existing user
    // ------------------------------------------------------------------------
    if (action === "update_profile") {
      const caller = await lookupCallerProfile(userId);
      if (!caller || caller.role !== "admin") {
        return json({ error: "Admin only" }, 403);
      }

      const profileId = body.profileId;
      if (!profileId) return json({ error: "profileId required" }, 400);

      const { data: existing } = await supabase
        .from("profiles").select("*").eq("id", profileId).single();
      if (!existing) return json({ error: "profile not found" }, 404);

      const allowed: Record<string, unknown> = {};
      if (updates?.role !== undefined) {
        if (!VALID_ROLES.includes(updates.role)) {
          return json({ error: `Invalid role` }, 400);
        }
        allowed.role = updates.role;
      }
      if (updates?.division !== undefined)     allowed.division = updates.division || null;
      if (updates?.display_name !== undefined) allowed.display_name = updates.display_name;
      if (updates?.full_name !== undefined)    allowed.full_name = updates.full_name;
      if (updates?.title !== undefined)        allowed.title = updates.title || null;
      if (updates?.phone !== undefined)        allowed.phone = updates.phone || null;

      if (Object.keys(allowed).length === 0) {
        return json({ error: "No valid fields to update" }, 400);
      }
      allowed.updated_at = new Date().toISOString();

      const { data, error } = await supabase.from("profiles")
        .update(allowed).eq("id", profileId).select().single();
      if (error) return json({ error: error.message }, 400);

      // Also mirror role/division changes to the whitelist for consistency
      if (allowed.role || allowed.division !== undefined) {
        const mirror: Record<string, unknown> = {};
        if (allowed.role !== undefined) mirror.role = allowed.role;
        if (allowed.division !== undefined) mirror.division = allowed.division;
        await supabase.from("staff_whitelist")
          .update(mirror).eq("email", existing.email);
      }

      await writeAudit(existing.email, "update_role", caller.id, existing, data);
      return json({ data });
    }

    // ------------------------------------------------------------------------
    // DEACTIVATE STAFF — soft off-boarding (reversible)
    // Flips is_active=false on BOTH profile and whitelist.
    // User can still be reactivated from the Inactive Staff tab.
    // ------------------------------------------------------------------------
    if (action === "deactivate_staff") {
      const caller = await lookupCallerProfile(userId);
      if (!caller || caller.role !== "admin") {
        return json({ error: "Admin only" }, 403);
      }

      const targetId = body.profileId;
      if (!targetId) return json({ error: "profileId required" }, 400);

      if (targetId === caller.id) {
        return json({ error: "Cannot deactivate yourself" }, 400);
      }

      const { data: existing } = await supabase
        .from("profiles").select("*").eq("id", targetId).single();
      if (!existing) return json({ error: "profile not found" }, 404);

      await supabase.from("profiles")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", targetId);

      await supabase.from("staff_whitelist")
        .update({ is_active: false }).eq("email", existing.email);

      await writeAudit(existing.email, "deactivate", caller.id, existing, { is_active: false });

      return json({ data: { profileId: targetId, email: existing.email, is_active: false } });
    }

    // ------------------------------------------------------------------------
    // REACTIVATE STAFF — restore a previously-deactivated person
    // ------------------------------------------------------------------------
    if (action === "reactivate_staff") {
      const caller = await lookupCallerProfile(userId);
      if (!caller || caller.role !== "admin") {
        return json({ error: "Admin only" }, 403);
      }

      const targetId = body.profileId;
      if (!targetId) return json({ error: "profileId required" }, 400);

      const { data: existing } = await supabase
        .from("profiles").select("*").eq("id", targetId).single();
      if (!existing) return json({ error: "profile not found" }, 404);

      await supabase.from("profiles")
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq("id", targetId);

      await supabase.from("staff_whitelist")
        .update({ is_active: true }).eq("email", existing.email);

      await writeAudit(existing.email, "reactivate", caller.id, existing, { is_active: true });

      return json({ data: { profileId: targetId, email: existing.email, is_active: true } });
    }

    // ------------------------------------------------------------------------
    // HARD DELETE STAFF — destructive, admin-panel-only
    // Wipes profile + whitelist. Keeps audit log row forever.
    // Requires confirm=true in body (caller UI must collect explicit confirmation).
    // ------------------------------------------------------------------------
    if (action === "hard_delete_staff") {
      const caller = await lookupCallerProfile(userId);
      if (!caller || caller.role !== "admin") {
        return json({ error: "Admin only" }, 403);
      }

      if (body.confirm !== true) {
        return json({ error: "confirm=true required for destructive action" }, 400);
      }

      const targetId = body.profileId;
      if (!targetId) return json({ error: "profileId required" }, 400);

      if (targetId === caller.id) {
        return json({ error: "Cannot delete yourself" }, 400);
      }

      const { data: existing } = await supabase
        .from("profiles").select("*").eq("id", targetId).single();
      if (!existing) return json({ error: "profile not found" }, 404);

      // Write audit FIRST (before we nuke the profile — FK reference needed)
      await writeAudit(
        existing.email, "hard_delete", caller.id, existing, null,
        body.reason ?? "Hard delete by admin",
      );

      // Wipe whitelist (no FK constraints)
      await supabase.from("staff_whitelist").delete().eq("email", existing.email);

      // Wipe profile — FK constraints on project_tasks.assigned_to_id etc. will
      // cascade NULL via the existing FK definitions. If any FK is ON DELETE RESTRICT,
      // this will fail safely and return an error.
      const { error: delErr } = await supabase.from("profiles").delete().eq("id", targetId);
      if (delErr) {
        return json({
          error: `Cannot hard delete: ${delErr.message}. Use deactivate instead.`,
        }, 400);
      }

      return json({ data: { profileId: targetId, email: existing.email, deleted: true } });
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
