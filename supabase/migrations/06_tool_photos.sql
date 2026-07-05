-- ============================================================================
-- 06_tool_photos.sql  —  Tool Control: multi-photo support
-- Run in: Supabase SQL Editor (PYRAMID CLIENT COMMAND / izjaxmcdlsdkdliqjlei).
-- Additive only. Adds an array of SharePoint photo URLs to tools (reference
-- photos captured at enrollment) and to tool_transactions (condition photos
-- per check-out / check-in). The old single photo_url column is left in place.
-- ============================================================================

ALTER TABLE public.tools
  ADD COLUMN IF NOT EXISTS photo_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.tool_transactions
  ADD COLUMN IF NOT EXISTS photo_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ============================================================================
-- END 06_tool_photos.sql
-- ============================================================================
