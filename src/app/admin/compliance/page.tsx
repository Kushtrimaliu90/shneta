import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { ShieldCheck } from 'lucide-react';
import { pickLocale, type LocalizedField } from '@/lib/i18n';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { formatAdminDateTime } from '@/features/admin/copy';
import { listComplianceQueue } from '@/features/catalog/compliance-queries';
import { ComplianceReview } from '@/features/catalog/components/compliance-review';
import { CLAIMS_REMINDER } from '@/features/catalog/taxonomy-config';

export const metadata: Metadata = { title: 'Compliance' };

/**
 * docs/06 §14 — the compliance queue.
 *
 * A reviewer's job here is to read three fields in two languages and decide whether the wording
 * is lawful for a food supplement. So the page **is** those fields: everything waiting, expanded,
 * with the approve and reject controls under each one. No list of links to open one at a time.
 *
 * The claim-language checklist sits at the top rather than beside each product — it is the same
 * rule for every item, and repeating it eight times would train the reader to skip it.
 *
 * What is deliberately not here, from §14: the certifications registry and the lab-report
 * expiry view. Both are CRUD over tables nothing on the storefront reads yet; they are listed in
 * docs/14 and belong with the pages that display them.
 */
export default async function AdminCompliancePage() {
  const profile = await getProfile();
  if (!can(profile?.role, 'compliance.approve')) redirect('/admin');

  const queue = await listComplianceQueue();

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl font-semibold text-forest-900">Compliance</h1>
      <p className="mt-1 text-sm text-ink-600">
        {queue.length === 0
          ? 'Nothing is waiting for review.'
          : `${queue.length} product${queue.length === 1 ? '' : 's'} waiting, oldest first.`}
      </p>

      <div className="mt-4 rounded-lg border border-warning bg-warning/10 p-4 text-sm">
        <p className="font-medium text-ink-900">What you are checking</p>
        <p className="mt-1 text-ink-600">{CLAIMS_REMINDER.guidance}</p>
        <p className="mt-1 text-ink-600">
          Reject anything that says {CLAIMS_REMINDER.banned.slice(0, 4).join(', ')} — in either
          language. Check too that melatonin, iron and anything contraindicated in pregnancy carry
          their warning (docs/08 §7).
        </p>
      </div>

      {queue.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center">
          <ShieldCheck className="mx-auto size-6 text-success" aria-hidden="true" />
          <p className="mt-2 font-medium text-forest-900">The queue is empty</p>
          <p className="mt-1.5 text-sm text-ink-600">
            Products appear here when a product manager submits them for review.
          </p>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-5">
          {queue.map((item) => {
            const submitted = formatAdminDateTime(item.submittedAt);

            return (
              <li key={item.id} className="rounded-lg border border-line bg-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-display text-base font-semibold text-forest-900">
                    {pickLocale(item.name, 'en') || item.slug}
                  </h2>
                  <p className="text-xs text-ink-600">
                    {item.brandName} · submitted{' '}
                    <time dateTime={item.submittedAt} title={submitted.utc} data-numeric>
                      {submitted.display}
                    </time>
                  </p>
                </div>

                {item.previouslyApproved && (
                  <p className="mt-1 text-xs text-warning">
                    {/*
                      Not a formality. An approved product that comes back has been edited since,
                      and the edit is exactly what nobody has read.
                    */}
                    Approved before and changed since — this is a re-review.
                  </p>
                )}

                <p className="mt-2 text-xs text-ink-600">
                  <Link
                    href={`/admin/products/${item.id}`}
                    className="rounded-sm text-forest-800 underline underline-offset-4"
                  >
                    Open the full record
                  </Link>
                </p>

                <dl className="mt-3 flex flex-col gap-3 rounded-sm bg-forest-50/60 p-3 text-sm">
                  {(
                    [
                      ['Description', item.description],
                      ['How to use', item.howToUse],
                      ['Warnings', item.warnings],
                    ] as const
                  ).map(([label, field]) => (
                    <Claim key={label} label={label} field={field} />
                  ))}

                  <div>
                    <dt className="text-xs font-semibold tracking-wide text-ink-600 uppercase">
                      Label
                    </dt>
                    <dd className="mt-1 text-ink-900">
                      {item.ingredientNames.length === 0 ? (
                        <span className="text-ink-500">No ingredients listed</span>
                      ) : (
                        item.ingredientNames
                          .map((name) => pickLocale(name, 'en'))
                          .filter(Boolean)
                          .join(', ')
                      )}
                    </dd>
                  </div>

                  {item.certifications.length > 0 && (
                    <div>
                      <dt className="text-xs font-semibold tracking-wide text-ink-600 uppercase">
                        Certifications claimed
                      </dt>
                      <dd className="mt-1 text-ink-900">{item.certifications.join(', ')}</dd>
                    </div>
                  )}
                </dl>

                <ComplianceReview productId={item.id} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * One claim-bearing field, in both languages.
 *
 * The raw `en` key, not `pickLocale(field, 'en')` — the same correction as the product page's
 * read-only view. `pickLocale` falls back to Albanian when English is missing, which is right for
 * a customer and wrong here: it renders the same paragraph twice and implies a translation was
 * reviewed when none exists.
 */
function Claim({ label, field }: { label: string; field: LocalizedField }) {
  const english = (field as Record<string, string | undefined> | null)?.en?.trim();

  return (
    <div>
      <dt className="text-xs font-semibold tracking-wide text-ink-600 uppercase">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-ink-900">
        <span className="mr-1 text-xs text-ink-500">sq</span>
        {pickLocale(field, 'sq') || <span className="text-ink-500">—</span>}
      </dd>
      <dd className="mt-1 whitespace-pre-wrap text-ink-600">
        <span className="mr-1 text-xs text-ink-500">en</span>
        {english ?? <span className="text-ink-500">not translated</span>}
      </dd>
    </div>
  );
}
