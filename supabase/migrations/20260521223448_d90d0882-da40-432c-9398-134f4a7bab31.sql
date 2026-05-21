
-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "own profile select" on public.profiles for select using (auth.uid() = id);
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)));
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Events
create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  brand_color text default '#111111',
  status text not null default 'draft',
  asset_count int not null default 0,
  top_pick_count int not null default 0,
  post_count int not null default 0,
  audience text default 'general',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.events enable row level security;
create policy "own events all" on public.events for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index on public.events(user_id, created_at desc);

-- Assets
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  public_url text,
  kind text not null default 'image',
  filename text,
  width int,
  height int,
  quality_score numeric,
  has_faces boolean,
  emotion text,
  scene text,
  ai_summary text,
  is_top_pick boolean not null default false,
  analyzed boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.assets enable row level security;
create policy "own assets all" on public.assets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index on public.assets(event_id);

-- Generated posts
create table public.generated_posts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_asset_id uuid references public.assets(id) on delete set null,
  platform text not null,
  format text not null,
  caption text,
  hashtags text[],
  image_url text,
  storage_path text,
  audience text,
  best_time text,
  predicted_engagement numeric,
  metrics jsonb NOT NULL DEFAULT '{"likes":0,"shares":0,"reach":0,"comments":0}'::jsonb,
  engagement_score numeric,
  created_at timestamptz not null default now()
);
alter table public.generated_posts enable row level security;
create policy "own posts all" on public.generated_posts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index on public.generated_posts(event_id);

-- Agent logs
create table public.agent_logs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  agent text not null,
  level text not null default 'info',
  message text not null,
  created_at timestamptz not null default now()
);
alter table public.agent_logs enable row level security;
create policy "own logs select" on public.agent_logs for select using (auth.uid() = user_id);
create policy "own logs insert" on public.agent_logs for insert with check (auth.uid() = user_id);
create index on public.agent_logs(event_id, created_at);

alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.assets;
alter publication supabase_realtime add table public.generated_posts;
alter publication supabase_realtime add table public.agent_logs;

-- Storage buckets
insert into storage.buckets (id, name, public) values ('event-media','event-media', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('generated','generated', true)
  on conflict (id) do nothing;

create policy "event-media own read" on storage.objects for select
  using (bucket_id = 'event-media' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "event-media own insert" on storage.objects for insert
  with check (bucket_id = 'event-media' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "event-media own delete" on storage.objects for delete
  using (bucket_id = 'event-media' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "generated public read by path" on storage.objects for select
  using (bucket_id = 'generated' and name is not null);
create policy "generated own write" on storage.objects for insert
  with check (bucket_id = 'generated' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "generated own delete" on storage.objects for delete
  using (bucket_id = 'generated' and auth.uid()::text = (storage.foldername(name))[1]);

revoke execute on function public.handle_new_user() from public, anon, authenticated;
