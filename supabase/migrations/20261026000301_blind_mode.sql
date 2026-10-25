-- Phase 5 (agent B): blind mode (spec §5, "Blind mode", hospital plan).
-- When an organization turns blind mode on, every NEW session is created with blind = true, so staff and
-- viewers can't see its result (sessions / session_files / storage RLS already hide blind rows from non-admins).
-- Existing sessions are not changed.

alter table public.organizations add column if not exists blind_new_sessions boolean not null default false;

-- Org admins switch blind mode for new sessions. Hospital plan only (lib/research/plans.ts "blind_mode").
create or replace function public.set_org_blind(p_org uuid, p_on boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_plan public.org_type;
begin
  if p_org is null or not public.has_role(p_org, '{admin}') then raise exception 'not_allowed'; end if;
  select plan into v_plan from public.organizations where id = p_org;
  if coalesce(p_on, false) and v_plan is distinct from 'hospital' then raise exception 'feature_not_in_plan'; end if;
  update public.organizations set blind_new_sessions = coalesce(p_on, false) where id = p_org;
  insert into public.audit_log (org_id, user_id, action, target)
  values (p_org, auth.uid(), 'set_blind_mode', case when coalesce(p_on, false) then 'on' else 'off' end);
  return coalesce(p_on, false);
end $$;

-- Same checks and idempotency as the init migration; new sessions copy the organization's blind setting.
create or replace function public.start_session(p_child uuid, p_client_session_id uuid, p_engine text default 'mediapipe')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; o public.organizations; v_id uuid;
begin
  select id into v_id from public.sessions where client_session_id = p_client_session_id;
  if v_id is not null then
    if not public.has_role((select org_id from public.sessions where id = v_id), '{admin,staff}') then
      raise exception 'not_allowed';
    end if;
    return v_id;
  end if;

  select org_id into v_org from public.children where id = p_child;
  if v_org is null or not public.has_role(v_org, '{admin,staff}') then raise exception 'not_allowed'; end if;

  select * into o from public.organizations where id = v_org;
  if o.expires_on < current_date then raise exception 'plan_expired'; end if;
  if o.screening_quota is not null and o.screenings_used >= o.screening_quota then raise exception 'quota_reached'; end if;
  if not exists (
    select 1 from public.consents where child_id = p_child and org_id = v_org and withdrawn_at is null
  ) then
    raise exception 'no_consent';
  end if;

  insert into public.sessions (client_session_id, org_id, child_id, staff_id, engine, blind)
  values (
    p_client_session_id, v_org, p_child, auth.uid(), coalesce(p_engine, 'mediapipe'),
    coalesce(o.blind_new_sessions, false) and o.plan = 'hospital'
  )
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.set_org_blind(uuid, boolean) from public, anon;
revoke all on function public.start_session(uuid, uuid, text) from public, anon;
grant execute on function public.set_org_blind(uuid, boolean) to authenticated;
grant execute on function public.start_session(uuid, uuid, text) to authenticated;
