import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { Inbox } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { formatAdminDateTime } from '@/features/admin/copy';
import { MarkRepliedButton } from '@/features/content/components/mark-replied';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Messages' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const STATUSES = ['new', 'replied'] as const;
const LABELS: Record<string, string> = { new: 'New', replied: 'Replied' };

interface Message {
  id: string;
  name: string;
  email: string;
  subject: string | null;
  body: string;
  status: string;
  createdAt: string;
  repliedAt: string | null;
}

/**
 * docs/05 §16 — the contact inbox.
 *
 * Not in docs/06's page list, which is an omission rather than a decision: the form writes to
 * `contact_messages`, the dashboard's action queues already include "new contact messages"
 * (docs/06 §1), and a queue that links nowhere is worse than no queue. This is where it links.
 *
 * Replies are sent from a real mail client, not from here. A shop this size answers a handful of
 * messages a day, an operator's own mailbox threads them properly, and building a send path
 * would mean a second outbound identity to keep off the spam lists. The button records that a
 * reply happened; the reply itself happens in email.
 */
export default async function AdminMessagesPage({ searchParams }: Props) {
  const [profile, params] = await Promise.all([getProfile(), searchParams]);

  // Support answers customers; docs/01 §3 gives them the customer-facing rows.
  if (!can(profile?.role, 'customers.view')) redirect('/admin');

  const raw = Array.isArray(params.status) ? params.status[0] : params.status;
  const status = raw === 'replied' ? 'replied' : 'new';

  const supabase = await createClient();
  const [{ data, error }, counts] = await Promise.all([
    supabase
      .from('contact_messages')
      .select('id, name, email, subject, body, status, created_at, replied_at')
      .eq('status', status)
      // Oldest first while new — it is a queue — and newest first once answered.
      .order('created_at', { ascending: status === 'new' })
      .limit(100),
    supabase.from('contact_messages').select('status'),
  ]);

  if (error) logger.error('AdminMessagesPage failed', { cause: error.message });

  const byStatus: Record<string, number> = {};
  for (const row of (counts.data ?? []) as { status: string }[]) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  }

  const messages: Message[] = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    subject: row.subject === null ? null : String(row.subject),
    body: String(row.body),
    status: String(row.status),
    createdAt: String(row.created_at),
    repliedAt: row.replied_at === null ? null : String(row.replied_at),
  }));

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl font-semibold text-forest-900">Messages</h1>
      <p className="mt-1 text-sm text-ink-600">
        Everything sent through the contact form. Reply from your own mail client and mark it here.
      </p>

      <nav aria-label="Filter by status" className="mt-6 flex flex-wrap gap-1.5">
        {STATUSES.map((value) => {
          const active = value === status;
          return (
            <Link
              key={value}
              href={`/admin/messages?status=${value}`}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-9 items-center gap-1.5 rounded-sm border px-3 text-sm transition-colors',
                active
                  ? 'border-forest-800 bg-forest-100 font-medium text-forest-900'
                  : 'border-line-strong text-ink-600 hover:bg-forest-50',
              )}
            >
              {LABELS[value]}
              <span className="font-ui text-xs text-ink-600" data-numeric>
                {byStatus[value] ?? 0}
              </span>
            </Link>
          );
        })}
      </nav>

      {messages.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center">
          <Inbox className="mx-auto size-6 text-ink-500" aria-hidden="true" />
          <p className="mt-2 font-medium text-forest-900">
            {status === 'new' ? 'Nothing waiting' : 'Nothing answered yet'}
          </p>
          <p className="mt-1.5 text-sm text-ink-600">Messages arrive here from the contact form.</p>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-4">
          {messages.map((message) => {
            const received = formatAdminDateTime(message.createdAt);
            return (
              <li key={message.id} className="rounded-lg border border-line bg-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-ink-900">
                    {message.name}{' '}
                    <a
                      href={`mailto:${message.email}?subject=${encodeURIComponent(
                        `Re: ${message.subject ?? 'Your message to SHNETA'}`,
                      )}`}
                      className="rounded-sm text-sm font-normal text-forest-800 underline underline-offset-4"
                    >
                      {message.email}
                    </a>
                  </p>
                  <time
                    dateTime={message.createdAt}
                    title={received.utc}
                    className="text-xs text-ink-500"
                    data-numeric
                  >
                    {received.display}
                  </time>
                </div>

                {message.subject && (
                  <p className="mt-1 text-sm font-medium text-forest-900">{message.subject}</p>
                )}
                <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap text-ink-600">
                  {message.body}
                </p>

                {message.status === 'new' ? (
                  <div className="mt-3">
                    <MarkRepliedButton messageId={message.id} />
                  </div>
                ) : (
                  message.repliedAt && (
                    <p className="mt-3 text-xs text-ink-500">
                      Replied {formatAdminDateTime(message.repliedAt).display}
                    </p>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
