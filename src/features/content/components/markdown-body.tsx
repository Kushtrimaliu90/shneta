import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { cn } from '@/lib/utils';

/**
 * docs/08 §3 — article and page bodies.
 *
 * Markdown, never HTML. `rehype-sanitize` runs over the parsed tree with an allowlist, so a
 * body that somehow contains `<script>` — pasted in by an editor, or arriving from a database
 * somebody else can write to — is dropped rather than executed. `dangerouslySetInnerHTML`
 * appears nowhere in this codebase and this is the component that keeps it that way.
 *
 * The schema starts from `rehype-sanitize`'s default (already conservative) and narrows it to
 * the tags docs/08 §3 lists. Narrowing rather than replacing matters: the default also strips
 * the attribute-level attacks — `javascript:` URLs, `on*` handlers, `style` — and re-deriving
 * that list by hand is how a sanitiser ends up sanitising less than it appears to.
 */
const SCHEMA = {
  ...defaultSchema,
  tagNames: [
    'h2',
    'h3',
    'h4',
    'p',
    'ul',
    'ol',
    'li',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'blockquote',
    'img',
    'a',
    'strong',
    'em',
    'code',
    'pre',
    'hr',
    'br',
  ],
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), 'target', 'rel'],
    img: [...(defaultSchema.attributes?.img ?? []), 'loading', 'width', 'height'],
  },
  /*
   * `h1` is deliberately absent from `tagNames`. The page already renders the article title as
   * its `<h1>`, and a body that opens with another one gives the page two — which is a
   * document-outline error a screen reader announces and a crawler penalises. A stray `#` in
   * the markdown is stripped to its text rather than promoted.
   */
} as typeof defaultSchema;

export function MarkdownBody({ markdown, className }: { markdown: string; className?: string }) {
  if (!markdown.trim()) return null;

  return (
    <div
      className={cn(
        // docs/04 §5 — prose styling lives here rather than in a plugin, so the rhythm matches
        // the rest of the site instead of Tailwind Typography's own scale.
        /*
         * The body inherits the wrapper's `ink-900`. Paragraphs, lists and table cells used to
         * override it to `ink-600`, which put entire articles — the thing the page exists for —
         * in the secondary-text token, with `strong` bolted back to `ink-900` to compensate.
         * `ink-600` is for text that supports a primary element (the blockquote keeps it, as an
         * aside by definition); an article's own sentences ARE the primary element.
         */
        'flex flex-col gap-4 text-ink-900',
        '[&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-forest-900',
        '[&_h3]:mt-6 [&_h3]:font-display [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:text-forest-900',
        '[&_h4]:mt-4 [&_h4]:font-medium [&_h4]:text-forest-900',
        '[&_p]:leading-relaxed',
        '[&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:pl-5',
        '[&_ol]:flex [&_ol]:list-decimal [&_ol]:flex-col [&_ol]:gap-1.5 [&_ol]:pl-5',
        '[&_a]:rounded-sm [&_a]:text-forest-800 [&_a]:underline [&_a]:underline-offset-4',
        '[&_strong]:font-semibold',
        '[&_blockquote]:border-l-2 [&_blockquote]:border-forest-800 [&_blockquote]:bg-forest-50 [&_blockquote]:px-4 [&_blockquote]:py-3 [&_blockquote]:text-ink-600',
        '[&_hr]:border-line',
        '[&_img]:rounded-lg [&_img]:border [&_img]:border-line',
        // Tables scroll rather than overflow the page on a 360 px screen (docs/04 §8).
        '[&_table]:block [&_table]:w-full [&_table]:border-collapse [&_table]:overflow-x-auto [&_table]:text-sm',
        '[&_th]:border-b [&_th]:border-line-strong [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold',
        '[&_td]:border-b [&_td]:border-line [&_td]:px-3 [&_td]:py-2',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, SCHEMA]]}
        components={{
          /*
           * docs/08 §3 — external links open in a new tab and carry `noopener nofollow`;
           * internal ones stay in place and pass link equity.
           *
           * Applied here rather than in the sanitiser because it is an editorial rule, not a
           * security one: the sanitiser has already removed anything dangerous, and this
           * decides how a safe link should behave.
           */
          a({ href, children, ...rest }) {
            const isExternal = /^https?:\/\//i.test(href ?? '');
            return (
              <a
                href={href}
                {...(isExternal ? { target: '_blank', rel: 'noopener nofollow' } : {})}
                {...rest}
              >
                {children}
              </a>
            );
          },
          img({ src, alt, ...rest }) {
            /*
             * A plain `<img>`, not `next/image`. Body images come from an editor's markdown
             * with no known dimensions, and `next/image` needs either those or `fill` with a
             * sized parent — neither of which a markdown author can supply. Lazy loading is
             * the part that actually matters here and costs one attribute.
             */
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={typeof src === 'string' ? src : ''}
                alt={alt ?? ''}
                loading="lazy"
                {...rest}
              />
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
