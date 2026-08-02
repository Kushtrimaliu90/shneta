import type { Metadata } from 'next';
import { FaqsEditor } from '@/features/content/components/simple-editors';
import { listAdminFaqs } from '@/features/content/admin-queries';

export const metadata: Metadata = { title: 'FAQs' };

/** docs/06 §13 — frequently asked questions, grouped and ordered. */
export default async function AdminFaqsPage() {
  const faqs = await listAdminFaqs();

  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-carbon-900">FAQs</h2>
      <p className="mt-0.5 mb-4 max-w-2xl text-sm text-ink-600">
        Shown on the FAQ page and published as structured data for search engines — so an answer
        here is an answer Google may quote. Order is by the number on each row.
      </p>
      <FaqsEditor faqs={faqs} />
    </section>
  );
}
