-- =============================================================================
-- 30 · M12 · The KYB document bucket — private, and scoped by path
-- Source: docs/16 §4.
-- =============================================================================

/*
 * Business registrations, VAT certificates, ID documents and import licences.
 *
 * **Private**, obviously — but the part worth getting right is that a merchant must not be able to
 * read another merchant's folder, and `storage.objects` policies cannot see `merchant_documents`.
 * So the merchant id is carried **in the path** and the policy parses it:
 *
 *     merchants/<merchant_id>/<filename>
 *
 * `(storage.foldername(name))[2]` is the second path segment. Comparing it to
 * `current_merchant_ids()` gives the same isolation the tables have, in the one place that has no
 * foreign key to lean on.
 *
 * `10 MB` and PDF-or-image only. A scan of a registration certificate is one or the other, and
 * every additional mime type is a file format the storage layer will happily serve back to a
 * browser.
 */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'merchant-docs', 'merchant-docs', false, 10 * 1024 * 1024,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/*
 * Read: staff, and the owning merchant.
 *
 * Even for staff this is a private bucket — every read goes through a server-generated signed URL,
 * the same way `lab-reports` does. A public bucket holding scans of identity documents is the kind
 * of thing that is only found out about afterwards.
 */
create policy "merchant-docs read" on storage.objects for select
  using (
    bucket_id = 'merchant-docs'
    and (
      (select public.is_staff())
      or ((storage.foldername(name))[2])::uuid = any (public.current_merchant_ids())
    )
  );

/*
 * Insert: the owning merchant only.
 *
 * `::uuid` deliberately, rather than comparing text. A path segment that is not a uuid raises
 * instead of quietly failing to match — a malformed path is a bug to surface, not a request to
 * silently ignore.
 */
create policy "merchant-docs insert" on storage.objects for insert
  with check (
    bucket_id = 'merchant-docs'
    and ((storage.foldername(name))[2])::uuid = any (public.current_merchant_ids())
  );

/*
 * No update and no delete policy for anyone, including staff and the merchant.
 *
 * A KYB document is evidence of who somebody claimed to be at the moment they were approved.
 * Replacing one in place would leave the `merchant_documents` row pointing at different bytes than
 * the reviewer verified, with nothing recording that it changed. A corrected document is a new
 * upload and a new row; the old one stays.
 *
 * Deletion is a service-role operation, for the GDPR erasure path only.
 */
