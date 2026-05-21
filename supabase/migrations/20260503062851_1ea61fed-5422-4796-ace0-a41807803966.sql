
drop policy if exists "generated public read" on storage.objects;
create policy "generated public read by path" on storage.objects for select
  using (bucket_id = 'generated' and name is not null);

revoke execute on function public.handle_new_user() from public, anon, authenticated;
