-- Phase 4+5 security review fixes (lead).

-- L6: a site sees only its own study_sites row; the lead org sees every site of its study.
-- (The app reads sites through the service role after its own checks; this closes the direct API path.)
create or replace function public.is_study_lead(p_study uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.studies s where s.id = p_study and public.is_member(s.lead_org_id));
$$;
revoke all on function public.is_study_lead(uuid) from public, anon;
grant execute on function public.is_study_lead(uuid) to authenticated;

drop policy if exists study_sites_select on public.study_sites;
create policy study_sites_select on public.study_sites for select to authenticated
  using (public.is_study_lead(study_id) or public.is_member(org_id));

-- L5: the offline start time can be set once (first sync only), only on a session that is still
-- 'started', never earlier than 30 days before the server start, and never before the child's
-- current consent was signed.
create or replace function public.mark_session_offline(p_session uuid, p_started_at timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  s public.sessions;
  v_consent timestamptz;
begin
  select * into s from public.sessions where id = p_session for update;
  if s.id is null
     or not (
       (s.staff_id = auth.uid() and public.has_role(s.org_id, '{admin,staff}'))
       or public.has_role(s.org_id, '{admin}')
     ) then
    raise exception 'not_allowed';
  end if;

  select max(signed_at) into v_consent
    from public.consents
   where child_id = s.child_id and org_id = s.org_id and withdrawn_at is null;

  update public.sessions set
    created_offline   = true,
    offline_synced_at = coalesce(offline_synced_at, now()),
    started_at        = case
      when s.offline_synced_at is null
       and s.status = 'started'
       and p_started_at is not null
       and p_started_at <= s.started_at
       and p_started_at >= s.started_at - interval '30 days'
       and (v_consent is null or p_started_at >= v_consent)
      then p_started_at
      else s.started_at
    end
  where id = s.id;
end $$;

revoke all on function public.mark_session_offline(uuid, timestamptz) from public, anon;
grant execute on function public.mark_session_offline(uuid, timestamptz) to authenticated;
