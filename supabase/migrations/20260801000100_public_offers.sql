-- =============================================================================
-- 15 · Public coupons for /offers (docs/05 §11)
-- =============================================================================

/*
 * `/offers` presents active public coupons as claimable codes. `coupons` is staff-read only
 * (`p_staff_read`), which is right — the table carries `max_uses`, internal notes and every
 * system coupon — so an anonymous visitor cannot select from it at all.
 *
 * A read policy for anon was the obvious alternative and the wrong one. "Public coupon" is not
 * a row the anon role may see, it is a **question**: not system, active, and inside its window
 * right now. Encoded as a policy that question would be re-answered by every caller, and the
 * first caller to forget `now() between starts_at and ends_at` would put an expired code on the
 * page — which docs/05 §11 names as its one acceptance criterion.
 *
 * So it is a function, returning only the four fields the page renders. `max_uses`, `note` and
 * the per-user cap stay where they were.
 */
create or replace function public.list_public_coupons()
returns table (
  code text,
  type discount_type,
  value int,
  min_subtotal_cents int,
  ends_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select c.code::text, c.type, c.value, c.min_subtotal_cents, c.ends_at
    from coupons c
   where c.is_active
     and not c.is_system
     and (c.starts_at is null or c.starts_at <= now())
     and (c.ends_at is null or c.ends_at > now())
     -- A coupon that has been fully redeemed is not claimable, and listing it is a promise
     -- the checkout will refuse to keep.
     and (
       c.max_uses is null
       or (select count(*) from coupon_redemptions r where r.coupon_id = c.id) < c.max_uses
     )
   order by c.value desc, c.code;
$$;

revoke all on function public.list_public_coupons() from public;
grant execute on function public.list_public_coupons() to anon, authenticated, service_role;
