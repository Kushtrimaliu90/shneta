-- =============================================================================
-- Fix: coupon codes were case-SENSITIVE despite being declared citext.
--
-- `coupons.code` is `extensions.citext`, and PostgREST resolves it correctly, so
-- `.eq('code', 'welcome10')` from the app finds `WELCOME10`. Inside
-- `checkout_create_order` it did not, and the reason is subtle enough to write down.
--
-- The function was declared `set search_path = public`. The citext type is
-- schema-qualified at every use site (`::extensions.citext`), so the cast resolved —
-- but the `=` OPERATOR for citext also lives in `extensions`, and operators are not
-- schema-qualifiable in an expression. With `extensions` off the search_path Postgres
-- could not see `=(citext, citext)`; because citext is binary-coercible to text it
-- silently resolved `=(text, text)` instead. No error, no warning: the comparison just
-- quietly became case-sensitive.
--
-- Effect on customers: a coupon printed as WELCOME10 and typed `welcome10` — which is
-- what autocorrect and phone keyboards produce — came back COUPON_INVALID. Caught by
-- `e2e/checkout.spec.ts`, which deliberately types the code in lower case, and pinned by
-- `tests/integration/checkout.test.ts`.
--
-- `alter function … set search_path` rather than `create or replace`: the body is 200
-- lines and re-stating it here to change one configuration parameter would create two
-- copies to keep in step. This changes exactly the thing that is wrong.
--
-- `triggers.sql` (search vector, needs unaccent) and `rpc_support.sql`'s search function
-- already use `public, extensions` — this brings the checkout RPC in line with them.
-- =============================================================================

alter function public.checkout_create_order(
  uuid, text, text, jsonb, jsonb, uuid, payment_provider, text, text, text
) set search_path = public, extensions;
