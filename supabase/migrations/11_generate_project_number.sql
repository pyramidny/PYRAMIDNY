-- ============================================================================
-- Migration 11 — generate_project_number rewrite  (CUTOVER numbering)
-- Project: izjaxmcdlsdkdliqjlei (PYRAMID CLIENT COMMAND)
-- Applied MANUALLY in the SQL Editor. VERIFY the project slug first.
-- ============================================================================
-- WHY
--   The live generate_project_number() does SUBSTRING(project_number FROM 3),
--   which strips TWO characters ("P1"), not one. On the demo format 'P-0013'
--   that happened to work (FROM 3 = '0013'); the moment legacy 'P11637' data
--   lands it reads '1637' AND emits 'P-1637' (dash + 4-pad) -- wrong value in
--   the wrong format. This rewrite:
--     1. Parses the FULL numeric part (first digit run), dash-agnostic, so
--        'P11637' -> 11637, 'P-0013' -> 13, 'A10000' -> 10000 all read right.
--     2. Emits P#####/A##### (5 digits, NO dash) to match the server folder
--        naming (P11375-, A11354-, ...).
--     3. Clamps to a per-division FLOOR, so an app-minted number can NEVER
--        collide with a legacy number below it -- whether that legacy number
--        was imported (kept its real value) or still exists only as a server
--        bid folder that was never imported. THIS is the key safety property:
--        the DB max can be lower than the true server max, so max+1 alone is
--        not safe; the floor sits above the server.
--
-- FLOORS (set 2026-08-08; RE-VERIFY ON LOCK DAY -- bids are still minting
--   ~30 P / ~15 A per month; server was at P11637 / A11365 on 8/7):
--     regular -> P11700      ira -> A11400
--   If the P-series crosses 11700 before cutover, raise the floor here.
--
-- TRIGGER auto_project_number() is UNCHANGED and already correct: it only
--   generates when project_number is null/empty, so imported rows that carry
--   their real P#####/A##### are left untouched. (No trigger DDL in this file.)
-- ============================================================================

create or replace function public.generate_project_number(p_division text)
returns text
language plpgsql
as $$
declare
  prefix    text;
  floor_num int;
  max_num   int;
  next_num  int;
begin
  if p_division = 'regular' then
    prefix := 'P'; floor_num := 11700;
  else
    prefix := 'A'; floor_num := 11400;   -- any non-'regular' division -> IRA/A
  end if;

  -- Highest numeric part already used in this division. First digit run only,
  -- so legacy 'P11637', demo 'P-0013' and new 'P11700' all parse the same way.
  select coalesce(max( (regexp_match(project_number, '[0-9]+'))[1]::int ), 0)
    into max_num
  from public.projects
  where division = p_division
    and project_number ~ '[0-9]';

  next_num := greatest(max_num + 1, floor_num);

  return prefix || lpad(next_num::text, 5, '0');   -- P#####, no dash
end;
$$;

-- ---------------------------------------------------------------------------
-- READ-ONLY CHECK: what the NEXT app-minted numbers would be right now.
-- Nothing is inserted. On a clean (post-purge) DB this returns P11700 / A11400.
-- ---------------------------------------------------------------------------
select generate_project_number('regular') as next_regular,
       generate_project_number('ira')     as next_ira;
