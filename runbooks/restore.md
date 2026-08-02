# Runbook — restore from backup

docs/10 §7. **Read the whole page before touching anything.** A restore is one of the few
operations here that can lose data if run in the wrong order.

## Before you start

Answer these three, out loud, and write the answers in the incident notes:

1. **What is broken?** Corrupted rows, a bad migration, or a deleted table are three different
   restores. A bad migration usually wants a down-script, not a restore.
2. **What is the acceptable data loss?** PITR restores to a point in time. Every order placed
   between that point and now is gone unless you extract it first — see step 3.
3. **Is the site still taking orders?** If yes, decide whether to stop it. A restore while orders
   are arriving loses exactly those orders.

> **The single-project warning (docs/14 §7).** Dev, test and production are currently the same
> Supabase project. There is no second database to fall back on and no staging copy to rehearse
> against. Until that changes, every step below is being performed against live customer data.

## 1 · Stop the bleeding

```bash
# Vercel: roll back to the last known-good deployment. Instant, reversible, no data involved.
vercel rollback
```

If the fault is in the database rather than the code, put the shop into a state where it cannot
take more orders while you work:

- Settings → Payments → uncheck **Cash on delivery**, save. Checkout will refuse.
- Or, faster and blunter, pause the Vercel deployment.

Note the exact UTC time you did this. It is the upper bound of the data you must preserve.

## 2 · Confirm the damage before restoring

Supabase Dashboard → SQL Editor. Do not skip this — a restore based on a guess about what is
broken usually finds out afterwards that something else was.

```sql
-- Orders in the suspect window
select id, order_number, status, total_cents, placed_at
  from orders
 where placed_at > now() - interval '24 hours'
 order by placed_at desc;

-- The invariants. Every row either of these returns is a real problem.
select * from v_stock_ledger_drift;              -- on_hand vs the movement ledger
select * from tables_without_rls();              -- must be empty

-- Loyalty: the balance must equal the ledger
select p.id, p.loyalty_points, coalesce(sum(l.points), 0) as ledger
  from profiles p
  left join loyalty_transactions l on l.user_id = p.id
 group by p.id, p.loyalty_points
having p.loyalty_points <> coalesce(sum(l.points), 0);
```

## 3 · Extract anything the restore will destroy

**This is the step people skip and regret.** A PITR restore to 03:00 destroys everything after
03:00. Orders taken since then are real money owed to real people.

```bash
# Export the at-risk rows before restoring. Adjust the timestamp to your restore target.
psql "$DATABASE_URL" -c "\copy (
  select * from orders where placed_at > '2026-08-02T03:00:00Z'
) to 'orders-after-restore-point.csv' csv header"

psql "$DATABASE_URL" -c "\copy (
  select oi.* from order_items oi
    join orders o on o.id = oi.order_id
   where o.placed_at > '2026-08-02T03:00:00Z'
) to 'order-items-after-restore-point.csv' csv header"
```

Keep the files. They are re-entered by hand in step 6.

## 4 · Restore

Supabase Dashboard → Database → Backups.

- **PITR** (production, once enabled): choose the timestamp from step 2. Prefer a few minutes
  _before_ the first bad write, not after — you can always replay forward, you cannot un-restore.
- **Daily backup**: only if PITR is unavailable. Coarser, and you will lose up to a day.

Restore **into a new project** if the dashboard offers it, and compare before switching over.
Restoring in place is faster and gives you nothing to compare against.

## 5 · Re-apply anything the backup predates

```bash
supabase link --project-ref <ref>
supabase db push          # migrations newer than the backup
pnpm db:types:linked      # regenerate types; commit if they changed
```

Storage buckets are **not** included in a database restore. Product images, brand logos and lab
reports live in Supabase Storage and are backed up separately (docs/10 §7 — currently a Phase 2
item, which means: right now, they are not). If the restore predates an image upload, the row
will reference a path that has no object behind it and the PDP will show a placeholder.

## 6 · Replay the extracted orders

Re-enter the CSVs from step 3 by hand, through the admin panel, as new orders. **Not** by
inserting rows: `checkout_create_order` decrements stock, writes the movement ledger, records
payment rows and stamps the order number. An insert skips all of it and leaves the invariants
broken in a way that surfaces weeks later.

Contact each affected customer. An order that vanished and reappeared with a different number
needs a sentence of explanation, not silence.

## 7 · Verify before reopening

```bash
pnpm test:integration     # 87 tests against the restored database
```

And by hand:

- [ ] `select * from v_stock_ledger_drift;` returns nothing
- [ ] `select * from tables_without_rls();` returns nothing
- [ ] The seven staff accounts still exist with the right roles (Settings → Team)
- [ ] `/api/health` returns `{"status":"ok","database":"ok"}`
- [ ] One test order end to end, then cancel it
- [ ] Re-enable cash on delivery if you disabled it in step 1

## 8 · Afterwards

Write what happened in the incident notes while it is fresh: what broke, what the restore point
was, how many orders were replayed, and what would have caught it earlier. That last one is the
only part that changes anything.

## The drill

docs/10 §7 asks for a **quarterly restore drill** to a scratch project. Do it when nothing is on
fire, because every instruction above is a guess until someone has followed it once.

Record in `docs/14 §1`: the date, who ran it, how long the restore took, and every step of this
page that turned out to be wrong.
