-- =============================================================================
-- 51 · one image row per file per product
-- Source: docs/11 §10 (the image pipeline), docs/13 §X16 (one path convention).
-- =============================================================================

/*
 * `product_images` had no unique constraint, so nothing stopped the same file being registered twice
 * against one product — two rows, one object, the same photograph rendered twice in the gallery.
 *
 * That was theoretical while the only writer was a person clicking Upload in the editor. It stops
 * being theoretical the moment a **script** writes here, and two now do: `pnpm seed:images`, which a
 * photographer's folder will be run through more than once as photographs are re-shot, and
 * `promote_proposal_to_draft`'s image copy (docs/16 §9), which runs per approval.
 *
 * With the constraint, "upload this folder again" is an upsert rather than a duplication — which is
 * what makes the import safe to re-run, and re-running it is the normal case, not the exception.
 *
 * Idempotent, and it reports rather than failing silently: if duplicates already exist the index
 * cannot be created, so they are collapsed first, keeping the oldest row of each pair.
 */
delete from product_images pi
 where exists (
   select 1 from product_images other
    where other.product_id = pi.product_id
      and other.storage_path = pi.storage_path
      and other.created_at < pi.created_at
 );

create unique index if not exists product_images_one_per_file
  on product_images (product_id, storage_path);

comment on index product_images_one_per_file is
  'One row per file per product, so an image import can be re-run. docs/11 §10.';
