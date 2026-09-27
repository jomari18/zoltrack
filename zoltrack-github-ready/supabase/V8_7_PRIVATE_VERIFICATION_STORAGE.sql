-- ZolTrack v8.7 — Private Verification Document Storage
-- Run AFTER v8.6. This does not touch Auth users, roles, approvals, or operational data.

begin;

-- Private bucket: objects are never public URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'verification-documents',
  'verification-documents',
  false,
  5242880,
  array['image/jpeg','image/png','application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Users may upload only inside their own UUID folder.
drop policy if exists "v87 verification owner upload" on storage.objects;
create policy "v87 verification owner upload"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'verification-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Owner can remove an upload if profile update fails; Super Admin can review files.
drop policy if exists "v87 verification owner delete" on storage.objects;
create policy "v87 verification owner delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'verification-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "v87 verification superadmin read" on storage.objects;
create policy "v87 verification superadmin read"
on storage.objects for select
to authenticated
using (
  bucket_id = 'verification-documents'
  and public.current_user_role() = 'superadmin'
);

-- verification_document now stores a PRIVATE object path for new v8.7 submissions.
-- Existing Data URLs remain readable for backward compatibility and are not rewritten blindly.
comment on column public.profiles.verification_document is
  'v8.7+: private storage object path in verification-documents; pre-v8.7 rows may contain legacy Data URLs.';

commit;

-- Verification
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'verification-documents';

select policyname, cmd, roles
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname like 'v87 verification%'
order by policyname;
