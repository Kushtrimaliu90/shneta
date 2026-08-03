'use client';

import { useActionState, useState } from 'react';
import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  approveMerchant,
  rejectMerchant,
  requestMerchantInfo,
  type MerchantState,
} from '@/features/merchants/actions';
import type { MerchantRow } from '@/features/merchants/admin-queries';

/**
 * docs/16 §4 — reviewing one application.
 *
 * The screen exists to make one decision well, so it puts everything that decision rests on in one
 * place: who they say they are, what they say they will sell, whether the documents back it, and the
 * commercial terms that will apply if the answer is yes.
 *
 * **Approval sets the commission and the shipping arrangement in the same act.** They are inputs on
 * this form rather than defaults applied silently, because a merchant going live on a commission
 * nobody chose is a commercial decision made by a database default — noticed for the first time on a
 * statement, weeks later.
 */
export function ApplicationReview({
  merchant,
  defaultCommission,
  defaultShipping,
}: {
  merchant: MerchantRow;
  defaultCommission: number;
  defaultShipping: 'biocode' | 'merchant' | 'customer';
}) {
  const [panel, setPanel] = useState<'approve' | 'reject' | 'info' | null>(null);

  const hasRegistration = merchant.documents.some(
    (doc) => doc.kind === 'business_registration',
  );

  return (
    <article className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold text-forest-900">
            {merchant.displayName}
          </h3>
          <p className="text-sm text-ink-600">
            {merchant.legalName} · ARBK {merchant.businessNo}
            {merchant.vatNo && ` · VAT ${merchant.vatNo}`}
          </p>
        </div>
        <StatusChip status={merchant.status} />
      </header>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Row label="Contact">
          {merchant.contactName} · {merchant.contactEmail} · {merchant.contactPhone}
        </Row>
        <Row label="Address">
          {[merchant.address.line1, merchant.address.city, merchant.address.postal_code]
            .filter(Boolean)
            .join(', ') || '—'}
        </Row>
        <Row label="Bank">
          {merchant.bankName ?? '—'}
          {/* Last four only. A review screen gets screenshotted; the full IBAN stays in the row. */}
          {merchant.ibanLast4 && ` · IBAN ••••${merchant.ibanLast4}`}
        </Row>
        <Row label="Portal account">
          {merchant.ownerEmails.length > 0 ? merchant.ownerEmails.join(', ') : 'not linked yet'}
        </Row>
        <Row label="Terms accepted">
          {merchant.termsVersion
            ? `v${merchant.termsVersion} · ${merchant.termsAcceptedAt?.slice(0, 10) ?? ''}`
            : 'not recorded'}
        </Row>
        <Row label="Applied">{merchant.createdAt.slice(0, 10)}</Row>
      </dl>

      {merchant.applicationNote && (
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
            What they say they will sell
          </p>
          <p className="mt-1 text-sm whitespace-pre-line text-ink-900">
            {merchant.applicationNote}
          </p>
        </div>
      )}

      <div>
        <p className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">Documents</p>
        {merchant.documents.length === 0 ? (
          /*
           * Not a blocker in the code — the action does not refuse — but stated plainly here.
           * A hard block would strand an application whose documents arrived by email during an
           * outage, and the person clicking Approve is the person who should weigh that.
           */
          <p className="mt-1 text-sm text-warning">
            None uploaded. The registration certificate is required before approving.
          </p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-2">
            {merchant.documents.map((doc) => (
              <li key={doc.id}>
                <a
                  href={`/admin/merchants/document/${doc.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-sm border border-line-strong px-2 py-1 text-xs text-forest-800 hover:bg-forest-50"
                >
                  <FileText className="size-3.5" aria-hidden="true" />
                  {doc.kind.replace(/_/g, ' ')}
                  {doc.verified && <span className="text-success">✓</span>}
                </a>
              </li>
            ))}
          </ul>
        )}
        {!hasRegistration && merchant.documents.length > 0 && (
          <p className="mt-1 text-xs text-warning">No business registration among them.</p>
        )}
      </div>

      {merchant.reviewerNote && (
        <p className="rounded-md border border-line bg-cream p-3 text-sm text-ink-900">
          <span className="font-medium">Reviewer note:</span> {merchant.reviewerNote}
        </p>
      )}

      {merchant.status === 'pending' && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Button size="sm" onClick={() => setPanel(panel === 'approve' ? null : 'approve')}>
            Approve
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setPanel(panel === 'info' ? null : 'info')}>
            Request info
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setPanel(panel === 'reject' ? null : 'reject')}>
            Reject
          </Button>
        </div>
      )}

      {panel === 'approve' && (
        <ApproveForm
          merchantId={merchant.id}
          defaultCommission={defaultCommission}
          defaultShipping={defaultShipping}
          onDone={() => setPanel(null)}
        />
      )}
      {panel === 'reject' && <NoteForm merchantId={merchant.id} kind="reject" onDone={() => setPanel(null)} />}
      {panel === 'info' && <NoteForm merchantId={merchant.id} kind="info" onDone={() => setPanel(null)} />}
    </article>
  );
}

function ApproveForm({
  merchantId,
  defaultCommission,
  defaultShipping,
  onDone,
}: {
  merchantId: string;
  defaultCommission: number;
  defaultShipping: 'biocode' | 'merchant' | 'customer';
  onDone: () => void;
}) {
  const [state, action] = useActionState<MerchantState, FormData>(async (previous, formData) => {
    const result = await approveMerchant(previous, formData);
    if (result?.ok) onDone();
    return result;
  }, null);

  return (
    <form action={action} className="flex flex-col gap-4 rounded-md border border-forest-500/40 bg-forest-50/50 p-4">
      <input type="hidden" name="merchantId" value={merchantId} />

      <p className="text-sm text-ink-600">
        These are the commercial terms this merchant goes live on. Both are recorded on the merchant
        and used by every settlement from the first order onwards.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink-900">Commission %</span>
          <input
            type="number"
            name="commissionPct"
            step="0.5"
            min="0"
            max="100"
            defaultValue={defaultCommission}
            required
            className="h-10 rounded-md border border-line-strong bg-surface px-2.5 text-sm"
          />
          <span className="text-xs text-ink-600">
            Of the item subtotal, never of shipping. A €10 item at 10% pays the merchant €9.
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink-900">Shipping cost borne by</span>
          <select
            name="shippingBorneBy"
            defaultValue={defaultShipping}
            className="h-10 rounded-md border border-line-strong bg-surface px-2.5 text-sm"
          >
            <option value="biocode">BioCode — nothing deducted</option>
            <option value="merchant">Merchant — deducted at settlement</option>
            <option value="customer">Customer — covered by the delivery fee</option>
          </select>
          <span className="text-xs text-ink-600">
            Only &ldquo;Merchant&rdquo; changes what the merchant is paid.
          </span>
        </label>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="shipsOwn" value="true" defaultChecked className="size-4 accent-forest-700" />
          Ships its own parcels
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="collectsCash" value="true" className="size-4 accent-forest-700" />
          Collects the COD cash itself
        </label>
      </div>

      {state && !state.ok && (
        <p role="alert" className="text-sm text-error">
          {state.error === 'admin.errors.forbidden'
            ? 'Approving a merchant sets commercial terms — admin only.'
            : 'Could not approve. Check the commission value.'}
        </p>
      )}

      <div className="flex gap-2">
        <SubmitButton size="sm">Approve and set terms</SubmitButton>
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Reject and request-info differ by one action and one word, so they share a form. */
function NoteForm({
  merchantId,
  kind,
  onDone,
}: {
  merchantId: string;
  kind: 'reject' | 'info';
  onDone: () => void;
}) {
  const [state, action] = useActionState<MerchantState, FormData>(async (previous, formData) => {
    const result = kind === 'reject'
      ? await rejectMerchant(previous, formData)
      : await requestMerchantInfo(previous, formData);
    if (result?.ok) onDone();
    return result;
  }, null);

  return (
    <form action={action} className="flex flex-col gap-3 rounded-md border border-line-strong bg-cream p-4">
      <input type="hidden" name="merchantId" value={merchantId} />

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-ink-900">
          {kind === 'reject' ? 'Why this is rejected' : 'What is missing'}
        </span>
        <textarea
          name={kind === 'reject' ? 'reason' : 'note'}
          rows={3}
          required
          minLength={10}
          className="rounded-md border border-line-strong bg-surface p-2.5 text-sm"
        />
        <span className="text-xs text-ink-600">
          {kind === 'reject'
            ? 'The applicant sees this. A rejection with no reason is one they cannot act on.'
            : 'The application stays pending; the applicant sees this note in the portal.'}
        </span>
      </label>

      {state && !state.ok && (
        <p role="alert" className="text-sm text-error">
          Could not save. A note of at least ten characters is required.
        </p>
      )}

      <div className="flex gap-2">
        <SubmitButton size="sm" variant={kind === 'reject' ? 'destructive' : 'secondary'}>
          {kind === 'reject' ? 'Reject application' : 'Send request'}
        </SubmitButton>
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">{label}</dt>
      <dd className="text-ink-900">{children}</dd>
    </div>
  );
}

function StatusChip({ status }: { status: MerchantRow['status'] }) {
  const tone =
    status === 'approved'
      ? 'bg-success text-white'
      : status === 'pending'
        ? 'bg-warning text-white'
        : status === 'suspended'
          ? 'bg-ink-600 text-white'
          : 'bg-error text-white';

  return (
    <span className={cn('rounded-sm px-1.5 py-0.5 font-ui text-[11px] font-semibold', tone)}>
      {status}
    </span>
  );
}
