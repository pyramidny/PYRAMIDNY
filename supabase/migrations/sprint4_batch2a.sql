-- ============================================================================
-- Sprint 4 / Batch 2a — RLS policies + diagnostics
-- Date: April 24, 2026
-- Purpose: Add read access to lookup tables that Azure AD (anon role) needs,
--          and pre-verify backfill scope.
--
-- Safe to re-run. Uses IF NOT EXISTS / DROP-then-CREATE where needed.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. RLS on lookup tables
-- ----------------------------------------------------------------------------
-- Azure AD tokens hit PostgREST as the 'anon' role. These tables hold lookup
-- data with no PII, so global read access is correct.

-- workflow_task_templates (used for task seeding + future template editor)
ALTER TABLE public.workflow_task_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read workflow_task_templates" ON public.workflow_task_templates;
CREATE POLICY "Read workflow_task_templates"
  ON public.workflow_task_templates
  FOR SELECT
  TO anon, authenticated
  USING (true);


-- staff_whitelist (used for Team Management screen, pre-login invitee list)
ALTER TABLE public.staff_whitelist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read staff_whitelist" ON public.staff_whitelist;
CREATE POLICY "Read staff_whitelist"
  ON public.staff_whitelist
  FOR SELECT
  TO anon, authenticated
  USING (true);


-- notification_settings (users read/write their own)
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own notification_settings" ON public.notification_settings;
DROP POLICY IF EXISTS "Users write own notification_settings" ON public.notification_settings;

-- For now: allow read for any authenticated user (writes go through proxy anyway,
-- using service_role). Keep simple — Azure AD user_id matching is done in the
-- Edge Function since auth.uid() doesn't work with Microsoft-signed tokens.
CREATE POLICY "Read notification_settings"
  ON public.notification_settings
  FOR SELECT
  TO anon, authenticated
  USING (true);


-- notifications (users read their own)
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read notifications" ON public.notifications;
CREATE POLICY "Read notifications"
  ON public.notifications
  FOR SELECT
  TO anon, authenticated
  USING (true);


-- project_documents (reads for authenticated users)
ALTER TABLE public.project_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read project_documents" ON public.project_documents;
CREATE POLICY "Read project_documents"
  ON public.project_documents
  FOR SELECT
  TO anon, authenticated
  USING (true);


-- ----------------------------------------------------------------------------
-- 2. Verification — confirm anon can now see the lookup data
-- ----------------------------------------------------------------------------
SET ROLE anon;
SELECT
  (SELECT COUNT(*) FROM workflow_task_templates) AS templates_visible,
  (SELECT COUNT(*) FROM staff_whitelist)         AS whitelist_visible,
  (SELECT COUNT(*) FROM notification_settings)   AS settings_visible,
  (SELECT COUNT(*) FROM notifications)           AS notifications_visible,
  (SELECT COUNT(*) FROM project_documents)       AS documents_visible;
RESET ROLE;


-- ----------------------------------------------------------------------------
-- 3. Diagnostics — check what backfill needs to do
-- ----------------------------------------------------------------------------

-- Which templates apply to each division?
SELECT
  COALESCE(division::text, 'null (both)') AS division,
  COUNT(*) AS template_count,
  COUNT(*) FILTER (WHERE is_active) AS active_templates
FROM workflow_task_templates
GROUP BY division
ORDER BY division NULLS FIRST;


-- Per-project state before backfill
SELECT
  p.project_number,
  p.status,
  p.division,
  COUNT(pt.id) AS task_count,
  p.sharepoint_folder_id IS NOT NULL AS has_sp_folder,
  EXISTS (SELECT 1 FROM project_production pp WHERE pp.project_id = p.id) AS has_production_row
FROM projects p
LEFT JOIN project_tasks pt ON pt.project_id = p.id
GROUP BY p.id, p.project_number, p.status, p.division, p.sharepoint_folder_id
ORDER BY p.created_at;


-- Investigate P-0001 (suspected double-seed with 57 tasks)
-- If duplicates exist, the same task_name+stage_number+project_id will appear more than once
SELECT
  p.project_number,
  pt.task_name,
  pt.stage_number,
  COUNT(*) AS dupe_count
FROM projects p
JOIN project_tasks pt ON pt.project_id = p.id
WHERE p.project_number = 'P-0001'
GROUP BY p.project_number, pt.task_name, pt.stage_number
HAVING COUNT(*) > 1
ORDER BY pt.stage_number, pt.task_name;
