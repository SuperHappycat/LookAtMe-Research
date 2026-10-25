-- Offline mode (agent E, spec §5.4): mark a session that was run offline and synced later.
-- Called by the browser's offline-session uploader after start_session (same clientSessionId).
-- Sets created_offline, offline_synced_at (first sync only) and, while the session is still
-- 'started', the real start time on the device (only earlier, by at most 30 days).
create or replace function public.mark_session_offline(p_session uuid, p_started_at timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare s public.sessions;
begin
  select * into s from public.sessions where id = p_session for update;
  if s.id is null
     or not (
       (s.staff_id = auth.uid() and public.has_role(s.org_id, '{admin,staff}'))
       or public.has_role(s.org_id, '{admin}')
     ) then
    raise exception 'not_allowed';
  end if;

  update public.sessions set
    created_offline   = true,
    offline_synced_at = coalesce(offline_synced_at, now()),
    started_at        = case
      when s.status = 'started'
       and p_started_at is not null
       and p_started_at <= s.started_at
       and p_started_at >= s.started_at - interval '30 days'
      then p_started_at
      else s.started_at
    end
  where id = s.id;
end $$;

revoke all on function public.mark_session_offline(uuid, timestamptz) from public, anon;
grant execute on function public.mark_session_offline(uuid, timestamptz) to authenticated;
