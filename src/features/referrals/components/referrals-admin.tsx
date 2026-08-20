'use client';

import { useActionState, useState } from 'react';
import { AlertTriangle, Gift, Plus, ShieldAlert } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { ActionForm } from '@/components/ui/action-form';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { formatPrice } from '@/lib/money';
import { cn } from '@/lib/utils';
import {
  createManualReferral,
  decideReferral,
  extendReferral,
  revokeAllReferrals,
  revokeReferral,
  type ReferralAdminErrorKey,
  type ReferralAdminState,
} from '@/features/referrals/admin-actions';
import type {
  AdminEarningRow,
  AdminReferralRow,
  FraudSignalRow,
  ReferralLiability,
} from '@/features/referrals/admin-queries';

/**
 * docs/17 §5 — one screen, five tabs.
 *
 * Tabs rather than five routes because the questions an operator arrives with are all versions of the
 * same one — "should this referral be paid?" — and answering it means moving between the queue, the
 * link's history and the fraud signals for the same referrer. Five URLs would make that three
 * navigations and lose the filter each time.
 *
 * Admin is English-only in v1 (CLAUDE.md §3), so the strings are literals rather than message keys.
 */

const ERRORS: Record<ReferralAdminErrorKey, string> = {
  'admin.errors.forbidden': 'Your role does not allow that.',
  'admin.errors.generic': 'Something went wrong. Please try again.',
  'referrals.errors.checkFields': 'Check the fields marked below.',
  'referrals.errors.notFound': 'That link no longer exists.',
  'referrals.errors.alreadyDecided':
    'That link has already been decided. Revoke it instead if it should stop.',
  'referrals.errors.notActive': 'Only an active link can be extended.',
  'referrals.errors.alreadyExtended':
    'This link has already been extended once, which is the limit.',
  'referrals.errors.reasonRequired': 'A reason is required — it is what the audit row records.',
  'referrals.errors.noteRequired': 'A note is required.',
  'referrals.errors.refereeNotFound': 'No customer with that email address.',
  'referrals.errors.linkRefused':
    'The rules refused it: the two accounts are the same person, already linked, or would form a loop.',
};

const TABS = ['queue', 'links', 'manual', 'earnings', 'fraud'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  queue: 'Queue',
  links: 'Links',
  manual: 'Link by hand',
  earnings: 'Earnings',
  fraud: 'Fraud signals',
};

const inputClass =
  'mt-1 h-10 w-full rounded-sm border border-line-strong bg-surface px-3 text-sm text-ink-900';
const labelClass = 'block text-xs font-medium text-ink-900';

/** The status palette from `OrderStatusPill`: a solid fill and the word, never a tint. */
const STATUS_TONES: Record<AdminReferralRow['status'], string> = {
  pending: 'bg-warning text-white',
  approved: 'bg-success text-white',
  rejected: 'bg-ink-600 text-white',
  revoked: 'bg-error text-white',
  expired: 'bg-ink-600 text-white',
};

function message(state: ReferralAdminState): { tone: 'error' | 'success'; text: string } | null {
  if (!state) return null;
  if (state.ok) return { tone: 'success', text: state.data.message ?? 'Done.' };
  return { tone: 'error', text: ERRORS[state.error] ?? ERRORS['admin.errors.generic'] };
}

function StatusChip({ status }: { status: AdminReferralRow['status'] }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm px-2 py-0.5 font-ui text-xs font-semibold whitespace-nowrap',
        STATUS_TONES[status],
      )}
    >
      {status}
    </span>
  );
}

/**
 * The signup gap, coloured.
 *
 * docs/17 §5 asks for it in the queue, and the reason is that it is the cheapest tell there is: two
 * accounts created minutes apart are usually one person. Under a day is worth a second look; the
 * colour is a prompt, not a verdict, so the number is always shown.
 */
function SignupGap({ days }: { days: number | null }) {
  if (days === null) return <span className="text-ink-500">—</span>;
  return (
    <span className={cn('font-ui text-xs', days < 1 ? 'font-semibold text-error' : 'text-ink-600')}>
      {days === 0 ? 'same day' : `${days}d apart`}
    </span>
  );
}

function RiskFlags({ flags }: { flags: string[] }) {
  if (flags.length === 0) return <span className="text-ink-500">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((flag) => (
        <span
          key={flag}
          className="inline-flex items-center gap-1 rounded-sm bg-warning px-1.5 py-0.5 font-ui text-[11px] font-semibold text-white"
        >
          <AlertTriangle className="size-3" aria-hidden="true" />
          {flag.replace(/_/g, ' ')}
        </span>
      ))}
    </span>
  );
}

export function ReferralsAdmin({
  queue,
  links,
  earnings,
  fraud,
  liability,
  pointValueCents,
  canManage,
}: {
  queue: AdminReferralRow[];
  links: AdminReferralRow[];
  earnings: AdminEarningRow[];
  fraud: FraudSignalRow[];
  liability: ReferralLiability;
  pointValueCents: number;
  canManage: boolean;
}) {
  const [tab, setTab] = useState<Tab>('queue');

  return (
    <div className="mt-6">
      {/* ── Liability, always visible ─────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-line bg-forest-50 p-4">
          <p className="eyebrow">Owed, not yet paid</p>
          <p className="mt-1 font-display text-2xl font-semibold text-forest-900" data-numeric>
            {formatPrice(liability.unpostedCents, 'sq')}
          </p>
          <p className="mt-1 text-xs text-ink-600">
            {liability.unpostedPoints} points earned and not yet in a wallet. With monthly posting
            this is normal for most of the month.
          </p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="eyebrow">Awarded all time</p>
          <p className="mt-1 font-display text-2xl font-semibold text-forest-900" data-numeric>
            {formatPrice(liability.totalCents, 'sq')}
          </p>
          <p className="mt-1 text-xs text-ink-600">
            Net of clawbacks. {liability.totalPoints} points at {pointValueCents}c each.
          </p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="eyebrow">Waiting for a decision</p>
          <p className="mt-1 font-display text-2xl font-semibold text-forest-900" data-numeric>
            {queue.length}
          </p>
          <p className="mt-1 text-xs text-ink-600">
            The clock starts at approval, so a slow queue costs the referrer nothing.
          </p>
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Referral views"
        className="mt-6 flex gap-1 overflow-x-auto border-b border-line"
      >
        {TABS.map((name) => (
          <button
            key={name}
            role="tab"
            type="button"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={cn(
              'min-h-11 shrink-0 rounded-t-sm px-3 font-ui text-sm',
              tab === name
                ? 'bg-forest-100 font-semibold text-forest-900'
                : 'text-ink-600 hover:bg-forest-50',
            )}
          >
            {TAB_LABELS[name]}
            {name === 'queue' && queue.length > 0 && (
              <span className="ml-1.5 font-semibold text-forest-900" data-numeric>
                {queue.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === 'queue' && <Queue rows={queue} />}
        {tab === 'links' && <Links rows={links} canManage={canManage} />}
        {tab === 'manual' && <ManualLink canManage={canManage} />}
        {tab === 'earnings' && <Earnings rows={earnings} />}
        {tab === 'fraud' && <Fraud rows={fraud} canManage={canManage} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

function Queue({ rows }: { rows: AdminReferralRow[] }) {
  const [state, action] = useActionState<ReferralAdminState, FormData>(decideReferral, null);
  const note = message(state);

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm text-ink-600">
        Nothing waiting. New links land here when somebody enters a code.
      </p>
    );
  }

  return (
    <div>
      {note && (
        <Alert tone={note.tone} className="mb-4">
          {note.text}
        </Alert>
      )}

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[52rem] text-sm">
          <caption className="sr-only">Referrals waiting for a decision</caption>
          <thead className="bg-forest-50 text-left">
            <tr>
              <Th>Referrer</Th>
              <Th>New customer</Th>
              <Th>Signup gap</Th>
              <Th>Flags</Th>
              <Th>Source</Th>
              <Th>Decide</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.id} className="align-top">
                <Td>
                  <span className="block text-ink-900">{row.referrer.name ?? '—'}</span>
                  <span className="block text-xs text-ink-500">{row.referrer.email}</span>
                  <span className="block font-ui text-xs text-ink-500">{row.referrer.code}</span>
                </Td>
                <Td>
                  <span className="block text-ink-900">{row.referee.name ?? '—'}</span>
                  <span className="block text-xs text-ink-500">{row.referee.email}</span>
                </Td>
                <Td>
                  <SignupGap days={row.signupGapDays} />
                </Td>
                <Td>
                  <RiskFlags flags={row.riskFlags} />
                </Td>
                <Td>
                  <span className="font-ui text-xs text-ink-600">{row.source}</span>
                </Td>
                <Td>
                  <ActionForm action={action} state={state} className="flex flex-col gap-2">
                    <input type="hidden" name="linkId" value={row.id} />
                    <input
                      name="note"
                      placeholder="Note (optional)"
                      maxLength={300}
                      className="h-9 w-44 rounded-sm border border-line-strong bg-surface px-2 text-xs"
                      aria-label={`Note for ${row.referee.email}`}
                    />
                    <div className="flex gap-2">
                      <SubmitButton name="approve" value="true" size="sm" loadingLabel="Saving…">
                        Approve
                      </SubmitButton>
                      <SubmitButton
                        name="approve"
                        value="false"
                        size="sm"
                        variant="secondary"
                        loadingLabel="Saving…"
                      >
                        Reject
                      </SubmitButton>
                    </div>
                  </ActionForm>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

function Links({ rows, canManage }: { rows: AdminReferralRow[]; canManage: boolean }) {
  const [revokeState, revokeAction] = useActionState<ReferralAdminState, FormData>(
    revokeReferral,
    null,
  );
  const [extendState, extendAction] = useActionState<ReferralAdminState, FormData>(
    extendReferral,
    null,
  );
  const note = message(revokeState) ?? message(extendState);
  const [open, setOpen] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm text-ink-600">
        No links match.
      </p>
    );
  }

  return (
    <div>
      {note && (
        <Alert tone={note.tone} className="mb-4">
          {note.text}
        </Alert>
      )}

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[56rem] text-sm">
          <caption className="sr-only">All referral links</caption>
          <thead className="bg-forest-50 text-left">
            <tr>
              <Th>Referrer</Th>
              <Th>New customer</Th>
              <Th>Status</Th>
              <Th>Ends</Th>
              <Th>Points</Th>
              <Th>Flags</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.id} className="align-top">
                <Td>
                  <span className="block text-ink-900">{row.referrer.email}</span>
                  <span className="block font-ui text-xs text-ink-500">{row.referrer.code}</span>
                </Td>
                <Td>
                  <span className="block text-ink-900">{row.referee.email}</span>
                  <span className="block text-xs text-ink-500">
                    joined {row.createdAt.slice(0, 10)}
                  </span>
                </Td>
                <Td>
                  <StatusChip status={row.status} />
                  {row.revokeReason && (
                    <span className="mt-1 block max-w-48 text-xs text-ink-500">
                      {row.revokeReason}
                    </span>
                  )}
                </Td>
                <Td>
                  <span className="text-xs text-ink-600">{row.expiresAt?.slice(0, 10) ?? '—'}</span>
                  {row.extendedCount > 0 && (
                    <span className="mt-1 block text-xs text-ink-500">extended once</span>
                  )}
                </Td>
                <Td>
                  <span data-numeric className="text-ink-900">
                    {row.pointsEarned}
                  </span>
                </Td>
                <Td>
                  <RiskFlags flags={row.riskFlags} />
                </Td>
                <Td>
                  {row.status === 'approved' || row.status === 'pending' ? (
                    <div className="flex flex-col gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => setOpen(open === row.id ? null : row.id)}
                        aria-expanded={open === row.id}
                      >
                        {open === row.id ? 'Close' : 'Stop / extend'}
                      </Button>

                      {open === row.id && (
                        <div className="flex flex-col gap-3 rounded-sm border border-line bg-surface p-2">
                          <ActionForm
                            action={revokeAction}
                            state={revokeState}
                            className="flex flex-col gap-1.5"
                          >
                            <input type="hidden" name="linkId" value={row.id} />
                            <label className={labelClass} htmlFor={`reason-${row.id}`}>
                              Reason to stop
                            </label>
                            <input
                              id={`reason-${row.id}`}
                              name="reason"
                              required
                              minLength={3}
                              maxLength={300}
                              className="h-9 w-52 rounded-sm border border-line-strong bg-surface px-2 text-xs"
                            />
                            <SubmitButton size="sm" variant="secondary" loadingLabel="Stopping…">
                              Stop this link
                            </SubmitButton>
                          </ActionForm>

                          {canManage && row.status === 'approved' && row.extendedCount === 0 && (
                            <ActionForm
                              action={extendAction}
                              state={extendState}
                              className="flex flex-col gap-1.5"
                            >
                              <input type="hidden" name="linkId" value={row.id} />
                              <label className={labelClass} htmlFor={`months-${row.id}`}>
                                Extend by months (once only)
                              </label>
                              <input
                                id={`months-${row.id}`}
                                name="months"
                                type="number"
                                min={1}
                                max={12}
                                defaultValue={3}
                                className="h-9 w-24 rounded-sm border border-line-strong bg-surface px-2 text-xs"
                                data-numeric
                              />
                              <input
                                name="note"
                                required
                                minLength={3}
                                maxLength={300}
                                placeholder="Why"
                                className="h-9 w-52 rounded-sm border border-line-strong bg-surface px-2 text-xs"
                                aria-label="Reason for extending"
                              />
                              <SubmitButton size="sm" variant="secondary" loadingLabel="Saving…">
                                Extend
                              </SubmitButton>
                            </ActionForm>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-ink-500">—</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manual link
// ---------------------------------------------------------------------------

function ManualLink({ canManage }: { canManage: boolean }) {
  const [state, action] = useActionState<ReferralAdminState, FormData>(createManualReferral, null);
  const note = message(state);

  if (!canManage) {
    return (
      <p className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm text-ink-600">
        Only an admin can create a link by hand.
      </p>
    );
  }

  return (
    <div className="max-w-xl">
      {note && (
        <Alert tone={note.tone} className="mb-4">
          {note.text}
        </Alert>
      )}

      <p className="text-sm text-ink-600">
        For the case the software cannot see — somebody bought on a friend&apos;s recommendation and
        never entered the code. Every rule still applies: no self-referral, no loop, no second
        referrer, and not two accounts sharing a phone number.
      </p>

      <ActionForm action={action} state={state} className="mt-4 flex flex-col gap-3">
        <div>
          <label className={labelClass} htmlFor="manual-code">
            Referrer&apos;s code
          </label>
          <input
            id="manual-code"
            name="code"
            required
            placeholder="BIO-XXXXX"
            autoCapitalize="characters"
            spellCheck={false}
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="manual-email">
            New customer&apos;s email
          </label>
          <input
            id="manual-email"
            name="email"
            type="email"
            required
            className={inputClass}
            autoComplete="off"
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="manual-backdate">
            Start the clock this many days ago
          </label>
          <input
            id="manual-backdate"
            name="backdateDays"
            type="number"
            min={0}
            max={365}
            defaultValue={0}
            className={inputClass}
            data-numeric
          />
          <p className="mt-1 text-[11px] text-ink-500">
            Leave at 0 to start today. Backdating shortens the twelve months, so use it only when
            the recommendation genuinely happened then.
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor="manual-note">
            Note (recorded in the audit log)
          </label>
          <input
            id="manual-note"
            name="note"
            required
            minLength={3}
            maxLength={300}
            className={inputClass}
          />
        </div>

        <SubmitButton loadingLabel="Linking…" className="self-start">
          <Plus className="size-4" aria-hidden="true" />
          Link and approve
        </SubmitButton>
      </ActionForm>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Earnings
// ---------------------------------------------------------------------------

function Earnings({ rows }: { rows: AdminEarningRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm text-ink-600">
        No earnings yet. They appear when a referred customer&apos;s order is delivered.
      </p>
    );
  }

  /*
   * CSV built on the client from the rows already rendered, so there is no second endpoint that could
   * disagree with the table — and nothing extra reaches the browser that is not already on screen.
   */
  const csv = [
    'date,reason,order,referrer,new_customer,base_cents,points,posted',
    ...rows.map((row) =>
      [
        row.createdAt,
        row.reason,
        row.orderNumber ?? '',
        row.referrerEmail,
        row.refereeEmail,
        row.baseCents,
        row.points,
        row.posted ? 'yes' : 'no',
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(','),
    ),
  ].join('\n');

  return (
    <div>
      <a
        href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}
        download="referral-earnings.csv"
        className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-line-strong px-3 font-ui text-sm text-forest-800"
      >
        <Gift className="size-4" aria-hidden="true" />
        Download CSV ({rows.length})
      </a>

      <div className="mt-4 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[52rem] text-sm">
          <caption className="sr-only">Referral earnings</caption>
          <thead className="bg-forest-50 text-left">
            <tr>
              <Th>When</Th>
              <Th>Reason</Th>
              <Th>Order</Th>
              <Th>Referrer</Th>
              <Th>New customer</Th>
              <Th>Eligible spend</Th>
              <Th>Points</Th>
              <Th>Posted</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.id}>
                <Td>{row.createdAt.slice(0, 10)}</Td>
                <Td>{row.reason}</Td>
                <Td>
                  <span className="font-ui text-xs">{row.orderNumber ?? '—'}</span>
                </Td>
                <Td>{row.referrerEmail}</Td>
                <Td>{row.refereeEmail}</Td>
                <Td>
                  <span data-numeric>{formatPrice(Math.abs(row.baseCents), 'sq')}</span>
                </Td>
                <Td>
                  <span
                    data-numeric
                    className={row.points < 0 ? 'font-semibold text-error' : 'text-ink-900'}
                  >
                    {row.points}
                  </span>
                </Td>
                <Td>{row.posted ? 'yes' : 'not yet'}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fraud signals
// ---------------------------------------------------------------------------

function Fraud({ rows, canManage }: { rows: FraudSignalRow[]; canManage: boolean }) {
  const [state, action] = useActionState<ReferralAdminState, FormData>(revokeAllReferrals, null);
  const note = message(state);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div>
      {note && (
        <Alert tone={note.tone} className="mb-4">
          {note.text}
        </Alert>
      )}

      <Alert tone="info" className="mb-4">
        Signals, not verdicts. Every one of these has an innocent explanation — a family shares an
        address, a couple shares a phone, a popular person really does invite six friends in a week.
        Read the row, then decide.
      </Alert>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm text-ink-600">
          Nothing stands out. Referrers with one link and no flags are not listed.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[54rem] text-sm">
            <caption className="sr-only">Referrers with signals worth reviewing</caption>
            <thead className="bg-forest-50 text-left">
              <tr>
                <Th>Referrer</Th>
                <Th>Links</Th>
                <Th>Last 7 days</Th>
                <Th>Never ordered</Th>
                <Th>Flags</Th>
                <Th>Points</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.referrerId} className="align-top">
                  <Td>
                    <span className="block text-ink-900">{row.referrerName ?? '—'}</span>
                    <span className="block text-xs text-ink-500">{row.referrerEmail}</span>
                    <span className="block font-ui text-xs text-ink-500">{row.referrerCode}</span>
                  </Td>
                  <Td>
                    <span data-numeric>{row.linksTotal}</span>
                    <span className="block text-xs text-ink-500">{row.linksApproved} approved</span>
                  </Td>
                  <Td>
                    <span
                      data-numeric
                      className={row.linksLast7d >= 3 ? 'font-semibold text-error' : ''}
                    >
                      {row.linksLast7d}
                    </span>
                  </Td>
                  <Td>
                    {/* The cheapest tell: a real advocate brings people who buy something. */}
                    <span
                      data-numeric
                      className={
                        row.linksTotal > 2 && row.refereesWithoutOrders === row.linksTotal
                          ? 'font-semibold text-error'
                          : ''
                      }
                    >
                      {row.refereesWithoutOrders} of {row.linksTotal}
                    </span>
                  </Td>
                  <Td>
                    <RiskFlags
                      flags={[
                        ...(row.flagSameAddress > 0 ? ['same_address'] : []),
                        ...(row.flagRapidSignup > 0 ? ['rapid_signup'] : []),
                        ...(row.flagCapReached > 0 ? ['cap_reached'] : []),
                      ]}
                    />
                  </Td>
                  <Td>
                    <span data-numeric>{row.pointsTotal}</span>
                  </Td>
                  <Td>
                    {canManage ? (
                      <div className="flex flex-col gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => setOpen(open === row.referrerId ? null : row.referrerId)}
                          aria-expanded={open === row.referrerId}
                        >
                          <ShieldAlert className="size-4" aria-hidden="true" />
                          {open === row.referrerId ? 'Close' : 'Stop all'}
                        </Button>
                        {open === row.referrerId && (
                          <ActionForm
                            action={action}
                            state={state}
                            className="flex flex-col gap-1.5"
                          >
                            <input type="hidden" name="referrerId" value={row.referrerId} />
                            <label className={labelClass} htmlFor={`all-${row.referrerId}`}>
                              Reason
                            </label>
                            <input
                              id={`all-${row.referrerId}`}
                              name="reason"
                              required
                              minLength={3}
                              maxLength={300}
                              className="h-9 w-52 rounded-sm border border-line-strong bg-surface px-2 text-xs"
                            />
                            {/*
                              Says what it will and will not do, next to the button. Revocation stops
                              future accrual and keeps points already paid — removing those is a
                              separate, deliberate adjustment (docs/17 §1).
                            */}
                            <p className="max-w-52 text-[11px] text-ink-500">
                              Stops every pending and active link. Points already paid stay.
                            </p>
                            <SubmitButton size="sm" variant="secondary" loadingLabel="Stopping…">
                              Stop all links
                            </SubmitButton>
                          </ActionForm>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-ink-500">admin only</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2.5 font-ui text-xs font-semibold text-ink-900">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="text-ink-700 px-3 py-2.5">{children}</td>;
}
