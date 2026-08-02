import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ArticleEditor } from '@/features/content/components/article-editor';
import { getAdminArticle, getRelatedOptions } from '@/features/content/admin-queries';

export const metadata: Metadata = { title: 'Edit article' };

type Props = { params: Promise<{ id: string }> };

/** docs/06 §13 — one article. */
export default async function EditArticlePage({ params }: Props) {
  const { id } = await params;

  const [article, options] = await Promise.all([getAdminArticle(id), getRelatedOptions()]);
  if (!article) notFound();

  return (
    <section>
      <h2 className="mb-4 font-display text-lg font-semibold text-carbon-900">
        {article.title.sq || article.slug}
      </h2>
      <ArticleEditor article={article} options={options} />
    </section>
  );
}
