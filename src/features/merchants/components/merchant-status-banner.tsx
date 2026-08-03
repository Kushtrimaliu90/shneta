import { getTranslations } from 'next-intl/server';
import { Clock, MessageSquare, Pause } from 'lucide-react';
import type { MerchantStatus } from '@/features/merchants/queries';

/**
 * docs/16 §5 — why the portal is or is not open.
 *
 * A server component, because it renders once per page and has no state. It appears above the nav on
 * every screen: a merchant who cannot add an offer will ask why on whatever page they happen to be
 * looking at, and an explanation that lives only on the dashboard is one they have to go and find.
 *
 * `approved` renders **nothing**. A banner on every screen saying "you are approved" is noise that
 * teaches people to ignore the place real notices appear.
 *
 * The reviewer's note is shown verbatim when there is one. That column doubles as "what is still
 * missing" for a pending application (§4 — `request info` is a note, not a status), so the same
 * string is either the reason for a rejection or the thing to do next.
 */
export async function MerchantStatusBanner({
  status,
  reviewerNote,
  appliedAt,
}: {
  status: MerchantStatus;
  reviewerNote: string | null;
  appliedAt: string;
}) {
  if (status === 'approved') return null;

  const t = await getTranslations('merchant.portal.status');

  const tone =
    status === 'suspended'
      ? 'border-error/40 bg-error/5'
      : status === 'rejected'
        ? 'border-error/40 bg-error/5'
        : 'border-warning/40 bg-warning/5';

  const Icon = status === 'pending' ? Clock : Pause;

  return (
    <div className={`mt-6 flex flex-col gap-2 rounded-lg border p-4 ${tone}`} role="status">
      <p className="flex items-center gap-2 font-medium text-ink-900">
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        {status === 'pending' && t('pendingTitle')}
        {status === 'suspended' && t('suspendedTitle')}
        {status === 'rejected' && t('rejectedTitle')}
      </p>

      <p className="text-sm text-ink-600">
        {status === 'pending' && t('pendingBody', { date: appliedAt.slice(0, 10) })}
        {status === 'suspended' && t('suspendedBody')}
        {status === 'rejected' && t('rejectedBody')}
      </p>

      {reviewerNote && (
        <p className="flex items-start gap-2 rounded-md border border-line bg-surface p-3 text-sm text-ink-900">
          <MessageSquare className="mt-0.5 size-4 shrink-0 text-ink-500" aria-hidden="true" />
          <span>
            <span className="font-medium">{t('reviewerNote')}</span> {reviewerNote}
          </span>
        </p>
      )}
    </div>
  );
}
