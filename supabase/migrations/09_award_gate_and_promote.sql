-- ============================================================================
-- Migration 09 — Stage 3 (Awarded) gate + prospect -> client auto-promote
-- Project: izjaxmcdlsdkdliqjlei  (PYRAMID CLIENT COMMAND)
-- Date:    2026-08-08
--
-- WHY THIS ATTACHES TO status, NOT current_stage:
--   Advancement is status-driven. sync_stage_from_status (BEFORE UPDATE OF
--   status) derives current_stage from status. The existing on_stage_advance
--   trigger is AFTER UPDATE OF current_stage — and Postgres evaluates
--   "UPDATE OF <col>" against the statement's SET list, NOT against columns a
--   BEFORE trigger changed. The app only ever writes status, so on_stage_advance
--   does not fire on real advances. Gate + promote therefore key off the
--   status string and are order-independent.
--
--   Awarded-or-later (stage >= 3) = ('Job Awarded','Active Job','Job Closed').
--
-- Two NEW functions + two NEW triggers. Nothing existing is modified.
-- Idempotent: safe to re-run (create or replace + drop trigger if exists).
-- ============================================================================


-- ── GATE: block awarded-or-later without client + site (BEFORE) ─────────────
create or replace function public.enforce_award_requirements()
returns trigger
language plpgsql
as $$
begin
  if NEW.status in ('Job Awarded','Active Job','Job Closed') then
    if NEW.client_id is null or NEW.site_id is null then
      raise exception
        'Cannot set status to "%": a Client and Job Site are required at Stage 3 (Awarded). Missing: %.',
        NEW.status,
        concat_ws(' and ',
          case when NEW.client_id is null then 'Client'   end,
          case when NEW.site_id   is null then 'Job Site' end)
        using errcode = 'check_violation';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists enforce_award_requirements on public.projects;
create trigger enforce_award_requirements
  before insert or update of status on public.projects
  for each row execute function public.enforce_award_requirements();


-- ── PROMOTE: prospect -> client on award (AFTER, idempotent) ────────────────
create or replace function public.auto_promote_client_on_award()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.status in ('Job Awarded','Active Job','Job Closed')
     and NEW.status is distinct from OLD.status
     and NEW.client_id is not null then
    update public.clients
       set relationship_status = 'client',
           updated_at = now()
     where id = NEW.client_id
       and relationship_status = 'prospect';
  end if;
  return NEW;
end;
$$;

drop trigger if exists auto_promote_client_on_award on public.projects;
create trigger auto_promote_client_on_award
  after insert or update of status on public.projects
  for each row execute function public.auto_promote_client_on_award();


-- ── VERIFY: both triggers present on projects ───────────────────────────────
-- select tgname, pg_get_triggerdef(oid)
-- from pg_trigger
-- where tgrelid = 'public.projects'::regclass and not tgisinternal
-- order by tgname;


-- ============================================================================
-- TEST — self-contained, ROLLS BACK. Paste and run as a block.
-- Expect two notices:  GATE (missing site) blocked? = t
--                      PROMOTE relationship_status now: client
-- ============================================================================
-- begin;
-- do $test$
-- declare
--   c_id uuid; s_id uuid; p_id uuid;
--   gate_fired boolean := false;
--   promoted   text;
-- begin
--   insert into clients (name, client_type, relationship_status)
--     values ('ZZ_GATE_TEST', 'managing_agent', 'prospect') returning id into c_id;
--   insert into sites (client_id, name)
--     values (c_id, 'ZZ_GATE_TEST_SITE') returning id into s_id;
--
--   insert into projects (project_address, status, client_id)
--     values ('ZZ gate test', 'New Bid', c_id) returning id into p_id;
--
--   -- 1) awarded with NO site -> must be blocked
--   begin
--     update projects set status='Job Awarded' where id=p_id;
--   exception when others then
--     gate_fired := true;
--   end;
--   raise notice 'GATE (missing site) blocked?  %', gate_fired;      -- expect t
--
--   -- 2) awarded WITH client+site -> passes AND promotes the prospect
--   update projects set site_id=s_id where id=p_id;
--   update projects set status='Job Awarded' where id=p_id;
--   select relationship_status into promoted from clients where id=c_id;
--   raise notice 'PROMOTE relationship_status now:  %', promoted;     -- expect client
-- end;
-- $test$;
-- rollback;
