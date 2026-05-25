insert into storage.buckets (id, name, public)
values ('rh-photos', 'rh-photos', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='rh-photos-public-read') then
    create policy "rh-photos-public-read"
      on storage.objects for select
      using (bucket_id = 'rh-photos');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='rh-photos-auth-upload') then
    create policy "rh-photos-auth-upload"
      on storage.objects for insert to authenticated
      with check (bucket_id = 'rh-photos');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='rh-photos-auth-update') then
    create policy "rh-photos-auth-update"
      on storage.objects for update to authenticated
      using (bucket_id = 'rh-photos');
  end if;
end$$;
