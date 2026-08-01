import type { Metadata } from 'next';
import { ArticleEditor } from '@/features/content/components/article-editor';
import { getRelatedOptions } from '@/features/content/admin-queries';

export const metadata: Metadata = { title: 'New article' };

/** docs/06 §13 — a blank article. The content layout has already checked the capability. */
export default async function NewArticlePage() {
  const options = await getRelatedOptions();

  return (
    <section>
      <h2 className="mb-4 font-display text-lg font-semibold text-forest-900">New article</h2>
      <ArticleEditor article={null} options={options} />
    </section>
  );
}
