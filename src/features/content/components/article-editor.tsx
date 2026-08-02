'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { SubmitButton } from '@/components/ui/submit-button';
import { saveArticle, type ContentState } from '@/features/content/editor-actions';
import {
  BilingualField,
  Feedback,
  RelatedPicker,
  fieldError,
  inputClass,
  labelClass,
} from '@/features/content/components/content-fields';
import type { ArticleDetail, PickerOption } from '@/features/content/admin-queries';
import { ARTICLE_STATUSES, ARTICLE_TYPES } from '@/features/content/types';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  in_review: 'In review',
  published: 'Published',
  archived: 'Archived',
};

const TYPE_LABELS: Record<string, string> = {
  article: 'Article',
  guide: 'Guide',
  recipe: 'Recipe',
  research: 'Research',
  news: 'News',
};

/**
 * docs/06 §13 — the article editor.
 *
 * One form, one save, unlike the product editor's six tabs. An article is one document: splitting
 * it would mean "save" could leave the Albanian body updated and the English one not, which for
 * prose is worse than for a set of independent product attributes.
 *
 * **Not built:** the side-by-side rendered preview §13 asks for, and cover-image upload. The
 * preview needs the sanitising markdown pipeline (docs/13 §N3) running in the browser, which
 * means shipping rehype to the client for a screen only content managers open; the cover needs
 * `pnpm seed:images` first, since every article currently renders the type placeholder anyway.
 * Both are logged in docs/14 §13.
 */
export function ArticleEditor({
  article,
  options,
}: {
  article: ArticleDetail | null;
  options: { products: PickerOption[]; ingredients: PickerOption[]; goals: PickerOption[] };
}) {
  const [state, action] = useActionState<ContentState, FormData>(saveArticle, null);

  const isPublished = Boolean(article?.publishedAt);

  return (
    <form action={action} className="max-w-4xl">
      {article && <input type="hidden" name="id" value={article.id} />}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label htmlFor="slug" className={labelClass}>
            Address <span className="text-error">*</span>
          </label>
          <div className="mt-1 flex items-center gap-1 text-sm text-ink-500">
            <span className="shrink-0">/knowledge/</span>
            <input
              id="slug"
              name="slug"
              defaultValue={article?.slug ?? ''}
              required
              readOnly={isPublished}
              className={inputClass.replace('mt-1 ', '')}
            />
          </div>
          {isPublished && (
            <p className="mt-1 text-[11px] text-ink-500">
              Fixed once published — the address is in search results and in people&rsquo;s
              bookmarks.
            </p>
          )}
          {fieldError(state, 'slug') && (
            <p className="mt-1 text-[13px] text-error">{fieldError(state, 'slug')}</p>
          )}
        </div>

        <div>
          <label htmlFor="type" className={labelClass}>
            Kind
          </label>
          <select id="type" name="type" defaultValue={article?.type ?? 'article'} className={inputClass}>
            {ARTICLE_TYPES.map((value) => (
              <option key={value} value={value}>
                {TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <BilingualField
        name="title"
        label="Title"
        sq={article?.title.sq ?? ''}
        en={article?.title.en ?? ''}
        state={state}
        required
      />

      <BilingualField
        name="excerpt"
        label="Excerpt"
        sq={article?.excerpt.sq ?? ''}
        en={article?.excerpt.en ?? ''}
        state={state}
        multiline
        rows={2}
        hint="One or two sentences. Shown on the Knowledge Center list and as the search description."
      />

      <BilingualField
        name="body"
        label="Body"
        sq={article?.body.sq ?? ''}
        en={article?.body.en ?? ''}
        state={state}
        multiline
        rows={18}
        required
        hint="Markdown. Headings start at ## — the title above is the page's only h1."
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="tags" className={labelClass}>
            Tags
          </label>
          <input
            id="tags"
            name="tags"
            defaultValue={article?.tags.join(', ') ?? ''}
            placeholder="imuniteti, dimri"
            className={inputClass}
          />
          <p className="mt-1 text-[11px] text-ink-500">Comma separated.</p>
        </div>

        <div>
          <label htmlFor="status" className={labelClass}>
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={article?.status ?? 'draft'}
            className={inputClass}
          >
            {ARTICLE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-ink-500">
            Only published articles appear on the shop.
          </p>
        </div>
      </div>

      {/* docs/06 §13 — related products, ingredients and goals drive "Shop this article". */}
      <RelatedPicker
        name="productIds"
        label="Products mentioned"
        options={options.products}
        selected={article?.productIds ?? []}
      />
      <RelatedPicker
        name="ingredientIds"
        label="Ingredients mentioned"
        options={options.ingredients}
        selected={article?.ingredientIds ?? []}
      />
      <RelatedPicker
        name="goalIds"
        label="Health goals"
        options={options.goals}
        selected={article?.goalIds ?? []}
      />

      <div className="mt-6 flex items-center gap-3">
        <SubmitButton loadingLabel="Saving…">
          {article ? 'Save article' : 'Create article'}
        </SubmitButton>
        <Link
          href="/admin/content"
          className="text-sm text-carbon-800 underline underline-offset-4"
        >
          Back to articles
        </Link>
        {article && isPublished && (
          <a
            href={`/knowledge/${article.slug}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-carbon-800 underline underline-offset-4"
          >
            View on the shop
          </a>
        )}
      </div>

      <Feedback state={state} saved="Saved. The shop will show it on the next request." />
    </form>
  );
}
