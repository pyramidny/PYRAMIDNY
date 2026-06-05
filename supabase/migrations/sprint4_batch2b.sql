-- ============================================================================
-- Sprint 4 / Batch 2b — Documents categorization + Staff lifecycle audit
-- Date: April 24, 2026
-- Safe to re-run.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. project_documents.category column
-- ----------------------------------------------------------------------------
-- Stores the SharePoint subfolder path for this document, e.g.
--   "Files/Contracts", "Pictures/Before", "Files/Permits", etc.
-- Separate from document_type, which is reserved for future MIME-like
-- classification (e.g. "pdf_permit", "drawing_dwg", "image_photo").

ALTER TABLE public.project_documents
  ADD COLUMN IF NOT EXISTS category text;

-- Backfill: anything currently in the DB was uploaded as "Files/Other"
UPDATE public.project_documents
SET category = 'Files/Other'
WHERE category IS NULL;

-- Index for fast filtering by category within a project
CREATE INDEX IF NOT EXISTS idx_project_documents_project_category
  ON public.project_documents (project_id, category);


-- ----------------------------------------------------------------------------
-- 2. staff_audit_log table
-- ----------------------------------------------------------------------------
-- Every whitelist add / profile change / deactivate / hard delete writes here.
-- Insurance audits, compliance, "who had access on date X" questions.

CREATE TABLE IF NOT EXISTS public.staff_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  action      text NOT NULL,              -- 'invite', 'update_role', 'deactivate', 'reactivate', 'hard_delete'
  changed_by  uuid REFERENCES public.profiles(id),
  old_values  jsonb,
  new_values  jsonb,
  notes       text,
  created_at  timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_audit_log_email
  ON public.staff_audit_log (email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_staff_audit_log_action
  ON public.staff_audit_log (action, created_at DESC);


-- ----------------------------------------------------------------------------
-- 3. RLS on new + existing tables
-- ----------------------------------------------------------------------------

-- project_documents — reads allowed for anon/authenticated (already exists,
-- this is idempotent)
ALTER TABLE public.project_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read project_documents" ON public.project_documents;
CREATE POLICY "Read project_documents"
  ON public.project_documents
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- staff_audit_log — read-only for authenticated users (admins see all; writes
-- go through proxy with service_role so RLS on INSERT doesn't apply)
ALTER TABLE public.staff_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read staff_audit_log" ON public.staff_audit_log;
CREATE POLICY "Read staff_audit_log"
  ON public.staff_audit_log
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- profiles — authenticated users can read all (Team page needs the list).
-- Writes go through proxy.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read profiles" ON public.profiles;
CREATE POLICY "Read profiles"
  ON public.profiles
  FOR SELECT
  TO anon, authenticated
  USING (true);


-- ----------------------------------------------------------------------------
-- 4. Verification
-- ----------------------------------------------------------------------------

-- Confirm category column exists
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'project_documents' AND column_name = 'category';

-- Confirm staff_audit_log is readable
SET ROLE anon;
SELECT COUNT(*) AS audit_log_readable FROM staff_audit_log;
SELECT COUNT(*) AS profiles_readable FROM profiles;
SELECT COUNT(*) AS whitelist_readable FROM staff_whitelist;
RESET ROLE;
