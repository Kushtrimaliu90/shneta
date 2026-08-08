-- 77 · The announcement bar's pill is a link label, not a discount code
--
-- Migration 73 added `banners.code` for one job: showing a discount code in the announcement bar. The
-- bar then rendered that pill next to a **hardcoded** "Shop now" link, from `home.announcement.cta`.
--
-- That hardcoding is the bug. An announcement pointing at `/merchant/apply` still said "Shop now",
-- because the only author-controlled text was the code and the only link text was a translation key.
-- The two collapse into one thing: the pill *is* the link, and its label belongs to whoever wrote the
-- announcement.
--
-- `rename column` rather than add-copy-drop. It is a catalog-only operation — atomic, instant, and it
-- cannot lose a value, because there is no window in which the data exists in one place and not the
-- other. Nothing else referenced the column: no view, no RPC, no policy, and `seed.sql` never set it.
alter table banners rename column code to link_label;

comment on column banners.link_label is
  'Text on the clickable pill in the announcement bar. Rendered as a link to cta_href when both are '
  'set, as plain text when the label is set alone. Meaningless for other placements.';
