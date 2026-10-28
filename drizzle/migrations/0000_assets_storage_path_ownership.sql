drop policy if exists "own assets all" on public.assets;
create policy "own assets all" on public.assets
  for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and storage_path like auth.uid()::text || '/%'
  );