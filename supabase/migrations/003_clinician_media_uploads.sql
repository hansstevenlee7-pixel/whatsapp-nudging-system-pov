alter table public.media_assets add column if not exists storage_path text;
alter table public.media_assets add column if not exists mime_type text;
alter table public.media_assets add column if not exists file_size bigint;

create unique index if not exists media_assets_storage_path_key
  on public.media_assets (storage_path)
  where storage_path is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'clinician-media',
  'clinician-media',
  false,
  104857600,
  array[
    'video/mp4',
    'video/webm',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Upload and download URLs are signed by authenticated server endpoints. No
-- browser-facing storage.objects policy is created for this private bucket.
